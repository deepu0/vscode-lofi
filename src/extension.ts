import * as vscode from "vscode";
import { Player, PlayerState } from "./player";
import { BUILT_IN_STATIONS } from "./stations";

export function activate(context: vscode.ExtensionContext) {
  const player = new Player(context.extensionUri, BUILT_IN_STATIONS, context.globalState);

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = "lofi.togglePlay";
  const render = (s: PlayerState) => {
    const icon = {
      idle: "$(play)",
      paused: "$(play)",
      loading: "$(loading~spin)",
      playing: "$(debug-pause)",
      error: "$(warning)",
      needsClick: "$(hand)",
    }[s.status];
    statusItem.text = `${icon} ${player.station.name}`;
    statusItem.tooltip =
      s.status === "error"
        ? `Lofi Radio: ${s.error ?? "playback failed"}`
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
  );

  // Exposed for the prototype experiment (src/experiment).
  return { player };
}

export function deactivate() {}
