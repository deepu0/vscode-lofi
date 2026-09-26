import * as vscode from "vscode";
import { Station } from "./stations";

/**
 * `needsClick`: VS Code blocked playback until the user clicks inside the player once.
 * `reconnecting`: a live stream dropped and the Player is retrying the same station with backoff.
 */
export type PlaybackStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "reconnecting"
  | "error"
  | "needsClick";

export interface PlayerState {
  stationIndex: number;
  status: PlaybackStatus;
  volume: number;
  muted: boolean;
  error?: string;
}

/** Heartbeat sent by the webview about once a second. */
export interface Tick {
  at: number;
  currentTime: number;
  paused: boolean;
  readyState: number;
  visibility: string;
}

/** `dropped` is reported by the webview when a live stream errors/stalls/ends. */
type WebviewStatus = PlaybackStatus | "dropped";

type FromWebview =
  | { type: "ready" }
  | { type: "unlocked" }
  | { type: "status"; status: WebviewStatus; error?: string }
  | ({ type: "tick" } & Omit<Tick, "at">)
  | { type: "command"; command: "toggle" | "next" | "previous" | "select" | "mute"; index?: number }
  | { type: "volume"; value: number };

const VIEW_ID = "lofi.player";
const READY_TIMEOUT_MS = 10_000;

/** Exponential-backoff schedule for reconnecting a dropped stream (never auto-switches). */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length;

/**
 * Owns playback state. The audio element lives in the sidebar webview; this
 * class is the single source of truth and drives the webview by messages.
 */
export class Player implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = VIEW_ID;

  private view?: vscode.WebviewView;
  private readyWaiters: Array<() => void> = [];
  private isReady = false;
  private readonly changeEmitter = new vscode.EventEmitter<PlayerState>();
  readonly onDidChangeState = this.changeEmitter.event;

  state: PlayerState;
  lastTick?: Tick;
  /** True once the user has clicked inside the webview (audio element unlocked). */
  unlocked = false;

  /** Backoff state for reconnecting a dropped stream. Reset on manual play/pause/switch. */
  private retryAttempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  /**
   * The station *id* that the current retry sequence belongs to. Keyed on id
   * (not numeric index) so reordering the station list via `setStations` cannot
   * silently repoint an in-flight reconnect at a different station.
   */
  private retryStationId?: string;

  private stations: readonly Station[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    stations: readonly Station[],
    private readonly memento: vscode.Memento,
  ) {
    this.stations = stations;
    this.state = {
      stationIndex: Math.min(Math.max(memento.get("stationIndex", 0), 0), stations.length - 1),
      status: "idle",
      volume: memento.get("volume", 0.7),
      muted: memento.get("muted", false),
    };
  }

  /**
   * Replace the station list (e.g. after the `lofiRadio.customStations` setting
   * changed at runtime). Reconciles the *currently selected* station by its
   * stable `id` rather than by numeric index, because reordering, inserting, or
   * removing entries would otherwise silently repoint the same index at a
   * different station and leave audio and UI describing different things.
   *
   * Semantics:
   *  - If the active station's id still exists in the new list, keep it selected
   *    (its index is updated to wherever it now lives). Any in-flight reconnect
   *    is keyed on the station id, so its pending retry stays aimed at the same
   *    station the user is listening to even after the index shifts.
   *  - If the active station's id is gone, we never auto-switch to a different
   *    station (a core invariant). Instead we STOP: cancel any reconnect, drop
   *    the audio connection, and fall back to an idle/paused state. The picker
   *    is reset to a valid index so the UI stays consistent.
   *  - Always resets/re-evaluates backoff so a settings change mid-reconnect can
   *    never strand the player in `reconnecting` with no pending timer.
   * The webview gets the refreshed list so its picker stays in sync.
   */
  setStations(stations: readonly Station[]): void {
    const activeId = this.stations[this.state.stationIndex]?.id;
    const wasActive =
      this.state.status === "playing" ||
      this.state.status === "loading" ||
      this.state.status === "reconnecting";
    this.stations = stations;

    // Where did the previously selected station move to (if it survived)?
    const newIndex = activeId !== undefined ? stations.findIndex((s) => s.id === activeId) : -1;

    if (newIndex === -1) {
      // The selected station is gone. Never auto-switch: stop playback and reset
      // to a valid, idle selection so audio and UI agree.
      this.resetBackoff();
      const fallback = Math.min(Math.max(this.state.stationIndex, 0), Math.max(stations.length - 1, 0));
      if (wasActive) {
        this.setState({ stationIndex: fallback, status: "paused", error: undefined });
        this.post({ type: "pause" });
      } else {
        this.setState({ stationIndex: fallback });
      }
      void this.memento.update("stationIndex", fallback);
      this.post({ type: "init", stations: this.stations, state: this.state });
      return;
    }

    // The selected station survived. Keep it selected at its new index. Any
    // in-flight reconnect is keyed on the station id, so a pending retry timer
    // still targets the right station after the index shift (no re-pointing
    // needed). The persisted index is refreshed so a reload restores this station.
    this.setState({ stationIndex: newIndex });
    void this.memento.update("stationIndex", newIndex);
    this.post({ type: "init", stations: this.stations, state: this.state });

    // Safety net: if we are somehow `reconnecting` with no pending timer (e.g. a
    // prior edit cancelled it), re-arm the backoff so we can never strand the
    // player in `reconnecting` with no way forward.
    if (this.state.status === "reconnecting" && this.retryTimer === undefined) {
      // handleDrop only re-arms from playing/loading, so nudge through loading.
      this.setState({ status: "loading", error: undefined });
      this.handleDrop("station list changed");
    }
  }

  get station(): Station {
    return this.stations[this.state.stationIndex];
  }

  get viewResolved(): boolean {
    return this.view !== undefined;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.isReady = false;
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
    view.webview.html = this.html(view.webview, mediaUri);
    view.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m));
    view.onDidDispose(() => {
      this.view = undefined;
      this.isReady = false;
      this.unlocked = false;
      this.resetBackoff();
      if (this.state.status === "playing" || this.state.status === "loading" || this.state.status === "reconnecting") {
        this.setState({ status: "paused" });
      }
    });
  }

  /**
   * Reveal the player view with the last remembered station selected, without
   * starting playback. Used by `lofiRadio.resumeOnStartup`: VS Code blocks
   * autoplay without a user gesture, so we only get the player ready for the
   * one click that unlocks audio (confirmed prototype finding).
   */
  async reveal(): Promise<void> {
    await this.ensureView();
  }

  async toggle(): Promise<void> {
    if (this.state.status === "playing" || this.state.status === "loading") {
      await this.pause();
    } else {
      await this.play();
    }
  }

  async play(index = this.state.stationIndex): Promise<void> {
    // A user-initiated (or programmatic) play always starts a fresh session.
    this.resetBackoff();
    this.lastTick = undefined;
    this.setState({ stationIndex: index, status: "loading", error: undefined });
    await this.memento.update("stationIndex", index);
    await this.ensureView();
    this.post({ type: "play", url: this.station.streamUrl, volume: this.state.volume });
  }

  async pause(): Promise<void> {
    // A manual pause cancels any pending reconnect so we don't fight the user.
    this.resetBackoff();
    this.setState({ status: "paused" });
    this.post({ type: "pause" });
  }

  next(): Promise<void> {
    return this.play((this.state.stationIndex + 1) % this.stations.length);
  }

  previous(): Promise<void> {
    const n = this.stations.length;
    return this.play((this.state.stationIndex - 1 + n) % n);
  }

  async pickStation(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      this.stations.map((s, i) => ({
        label: s.name,
        description: s.genre,
        detail: i === this.state.stationIndex ? "Current station" : undefined,
        index: i,
      })),
      { placeHolder: "Pick a station" },
    );
    if (picked) await this.play(picked.index);
  }

  async setVolume(value: number): Promise<void> {
    this.setState({ volume: Math.max(0, Math.min(1, value)) });
    await this.memento.update("volume", this.state.volume);
    this.post({ type: "volume", value: this.state.volume });
  }

  async toggleMute(): Promise<void> {
    const muted = !this.state.muted;
    this.setState({ muted });
    await this.memento.update("muted", muted);
    this.post({ type: "mute", value: muted });
  }

  /**
   * A live stream dropped. Retry the SAME station with exponential backoff.
   * Never changes stationIndex and never auto-switches. After the last attempt
   * fails, sets status `error` ("Station offline") and warns the user.
   */
  private handleDrop(error?: string): void {
    // Only retry a stream that was actually playing/loading (not idle/paused/needsClick).
    if (this.state.status !== "playing" && this.state.status !== "loading") return;

    const stationId = this.station?.id;
    if (stationId === undefined) return;
    // A drop for a different station than the one we were retrying starts over.
    if (this.retryStationId !== stationId) {
      this.retryAttempt = 0;
      this.retryStationId = stationId;
    }

    if (this.retryAttempt >= MAX_RETRY_ATTEMPTS) {
      const name = this.station?.name ?? "This station";
      this.resetBackoff();
      this.setState({ status: "error", error: `Station offline: ${error ?? "stream unavailable"}` });
      void vscode.window.showWarningMessage(`Lofi Radio: "${name}" appears to be offline.`);
      return;
    }

    const delay = RETRY_DELAYS_MS[this.retryAttempt];
    this.retryAttempt += 1;
    this.setState({ status: "reconnecting", error: undefined });
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.retryPlay(stationId);
    }, delay);
  }

  /**
   * Re-issue a play for the retrying station without resetting backoff state.
   * Keyed on station id: if the list was reordered mid-reconnect the station is
   * found at its new index; if it was removed entirely the retry is abandoned.
   */
  private async retryPlay(stationId: string): Promise<void> {
    // Bail if the user changed things while we were waiting.
    if (this.state.status !== "reconnecting" || this.station?.id !== stationId) return;
    this.lastTick = undefined;
    this.setState({ status: "loading", error: undefined });
    try {
      await this.ensureView();
    } catch {
      // View could not load; treat as another failed attempt.
      this.handleDrop("player view unavailable");
      return;
    }
    // Only send the play if the user hasn't changed things while the view resolved.
    const current: PlayerState = this.state;
    if (this.station?.id === stationId && current.status === "loading") {
      this.post({ type: "play", url: this.station.streamUrl, volume: this.state.volume });
    }
  }

  /** Cancel any pending retry and clear backoff bookkeeping. */
  private resetBackoff(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.retryAttempt = 0;
    this.retryStationId = undefined;
  }

  /**
   * The webview only exists once the sidebar view has been shown. When play is
   * triggered from the status bar before that, reveal the view so VS Code
   * resolves it, then wait for the webview script to report ready.
   */
  private async ensureView(): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`, { preserveFocus: true });
    }
    if (this.isReady) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Player view did not load")), READY_TIMEOUT_MS);
      this.readyWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private onMessage(m: FromWebview): void {
    switch (m.type) {
      case "ready":
        this.isReady = true;
        this.post({ type: "init", stations: this.stations, state: this.state });
        this.readyWaiters.splice(0).forEach((w) => w());
        break;
      case "unlocked":
        this.unlocked = true;
        break;
      case "status":
        // Ignore late media events after the user paused.
        if (this.state.status === "paused" && m.status !== "error") return;
        if (m.status === "dropped") {
          // A live stream fell over. Retry the SAME station with backoff instead
          // of surfacing a terminal error. Ignore drops while reconnecting (a
          // failed retry attempt is handled by scheduleRetry's own timer).
          if (this.state.status === "reconnecting") return;
          this.handleDrop(m.error);
          return;
        }
        // A real playback signal ends any reconnect sequence.
        if (m.status === "playing") this.resetBackoff();
        this.setState({ status: m.status, error: m.error });
        if (m.status === "needsClick") {
          // Show the player so the user can give the one click VS Code requires.
          void vscode.commands.executeCommand(`${VIEW_ID}.focus`);
        }
        break;
      case "tick":
        this.lastTick = { ...m, at: Date.now() };
        break;
      case "command":
        if (m.command === "toggle") void this.toggle();
        if (m.command === "next") void this.next();
        if (m.command === "previous") void this.previous();
        if (m.command === "select" && m.index !== undefined) void this.play(m.index);
        if (m.command === "mute") void this.toggleMute();
        break;
      case "volume":
        void this.setVolume(m.value);
        break;
    }
  }

  private setState(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    this.post({ type: "state", state: this.state });
    this.changeEmitter.fire(this.state);
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, "player.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, "player.css"));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      "media-src https: blob:",
    ].join("; ");
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${style}">
</head>
<body>
  <section class="now">
    <div class="now-label">Now playing</div>
    <div class="station" id="station">—</div>
    <div class="genre" id="genre"></div>
    <div class="status" id="status">Idle</div>
  </section>
  <section class="controls">
    <button id="prev" title="Previous station">⏮</button>
    <button id="toggle" class="primary" title="Play / Pause">▶</button>
    <button id="next" title="Next station">⏭</button>
    <button id="mute" title="Mute / Unmute">🔊</button>
  </section>
  <label class="volume">Volume <input id="volume" type="range" min="0" max="1" step="0.01"></label>
  <ul class="stations" id="stations"></ul>
  <audio id="audio" preload="none"></audio>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.resetBackoff();
    this.changeEmitter.dispose();
  }
}
