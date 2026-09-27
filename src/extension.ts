import * as vscode from "vscode";
import { Player, PlayerState } from "./player";
import { resolveStations } from "./stations";

function loadStations(): { stations: ReturnType<typeof resolveStations>["stations"]; problems: string[] } {
  const customStations = vscode.workspace.getConfiguration("lofiRadio").get("customStations");
  return resolveStations({ customStations });
}

function reportProblems(problems: string[]): void {
  if (problems.length > 0) {
    void vscode.window.showWarningMessage(`Lofi Radio: some custom stations were skipped. ${problems.join(" ")}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const initial = loadStations();
  reportProblems(initial.problems);
  const player = new Player(context.extensionUri, initial.stations, context.globalState);

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = "lofi.togglePlay";
  const render = (s: PlayerState) => {
    const icon = {
      idle: "$(play)",
      paused: "$(play)",
      loading: "$(loading~spin)",
      playing: "$(debug-pause)",
      reconnecting: "$(sync~spin)",
      error: "$(warning)",
      needsClick: "$(hand)",
    }[s.status];
    const muteIndicator = s.muted ? " $(mute)" : "";
    statusItem.text = `${icon} ${player.station.name}${muteIndicator}`;
    statusItem.tooltip =
      s.status === "error"
        ? `Lofi Radio: ${s.error ?? "playback failed"}`
        : s.status === "reconnecting"
          ? `Lofi Radio: reconnecting to "${player.station.name}"…`
          : s.status === "needsClick"
            ? "Lofi Radio: click ▶ in the Lofi Radio sidebar once to allow audio"
            : "Lofi Radio: play / pause";
  };
  render(player.state);
  statusItem.show();

  context.subscriptions.push(
    player,
    statusItem,
    player.onDidChangeState(render),
    vscode.window.registerWebviewViewProvider(Player.viewId, player, {
      // Keep the <audio> element alive while the sidebar shows another view or is closed.
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("lofi.togglePlay", () => player.toggle()),
    vscode.commands.registerCommand("lofi.next", () => player.next()),
    vscode.commands.registerCommand("lofi.previous", () => player.previous()),
    vscode.commands.registerCommand("lofi.pickStation", () => player.pickStation()),
    vscode.commands.registerCommand("lofi.toggleMute", () => player.toggleMute()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("lofiRadio.customStations")) {
        const next = loadStations();
        reportProblems(next.problems);
        player.setStations(next.stations);
      }
    }),
  );

  // Resume on startup: reveal the player with the last remembered station ready,
  // waiting for one click. VS Code blocks autoplay without a user gesture, so we
  // never call play() here (confirmed prototype finding).
  if (vscode.workspace.getConfiguration("lofiRadio").get("resumeOnStartup", false)) {
    void player.reveal();
  }

  // Hidden, isolated YouTube-via-localhost spike — desktop only (needs a Node
  // http server), so require it lazily to keep the web bundle free of `http`/`net`.
  let ytLocalhost: unknown;
  if (typeof process !== "undefined" && process.versions?.node) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./experiment/yt-localhost") as typeof import("./experiment/yt-localhost");
    mod.registerYtLocalhostExperiment(context);
    ytLocalhost = mod.ytLocalhost;
  }

  // Exposed for the prototype experiment (src/experiment).
  return { player, ytLocalhost };
}

export function deactivate() {}
