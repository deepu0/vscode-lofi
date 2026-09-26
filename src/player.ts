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
  /** The station index that the current retry sequence belongs to. */
  private retryStationIndex?: number;

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
   * changed). Clamps the current index into range and re-renders. The webview
   * gets the refreshed list so its picker stays in sync.
   */
  setStations(stations: readonly Station[]): void {
    this.stations = stations;
    const clamped = Math.min(Math.max(this.state.stationIndex, 0), Math.max(stations.length - 1, 0));
    this.setState({ stationIndex: clamped });
    this.post({ type: "init", stations: this.stations, state: this.state });
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

    const stationIndex = this.state.stationIndex;
    // A drop for a different station than the one we were retrying starts over.
    if (this.retryStationIndex !== stationIndex) {
      this.retryAttempt = 0;
      this.retryStationIndex = stationIndex;
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
      void this.retryPlay(stationIndex);
    }, delay);
  }

  /** Re-issue a play for the retrying station without resetting backoff state. */
  private async retryPlay(stationIndex: number): Promise<void> {
    // Bail if the user changed things while we were waiting.
    if (this.state.status !== "reconnecting" || this.state.stationIndex !== stationIndex) return;
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
    if (current.stationIndex === stationIndex && current.status === "loading") {
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
    this.retryStationIndex = undefined;
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
    <div class="station" id="station">—</div>
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
