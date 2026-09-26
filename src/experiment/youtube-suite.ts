/**
 * Runs inside real VS Code to answer the YouTube spike (Q22):
 *  (a) Does an official YouTube embed load and play audio in a VS Code webview?
 *  (b) Can we drive play/pause from the extension, and does it survive the panel being hidden?
 * "Playing" = the YouTube player reports state 1 AND getCurrentTime() advances.
 * Writes findings to $LOFI_RESULTS.
 */
import * as fs from "fs";
import * as vscode from "vscode";
import type { youtube as YT } from "./youtube";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(250);
  }
  return pred();
}

export async function run(): Promise<void> {
  const results: Record<string, unknown> = { vscodeVersion: vscode.version };
  const save = () => fs.writeFileSync(process.env.LOFI_RESULTS!, JSON.stringify(results, null, 2));

  try {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "vscode-lofi")!;
    const api = (await ext.activate()) as { youtube: typeof YT };
    const yt = api.youtube;

    await vscode.commands.executeCommand("lofi.youtubeExperiment");
    await waitFor(() => yt.hasPanel(), 5000);

    // Give the IFrame API up to 25s to load and start.
    const apiReady = await waitFor(() => yt.probe.apiReady, 25_000);
    const playerReady = await waitFor(() => yt.probe.playerReady, 15_000);
    // A trusted click on the panel unlocks autoplay if YouTube requires a gesture.
    if (!yt.probe.advanced) {
      const file = process.env.LOFI_SIGNAL!;
      fs.rmSync(file + ".done", { force: true });
      fs.writeFileSync(file, "#player");
      await waitFor(() => fs.existsSync(file + ".done"), 15_000);
    }
    const played = await waitFor(() => yt.probe.advanced, 20_000);

    results.load = {
      apiReady,
      playerReady,
      played,
      states: yt.probe.states,
      firstTime: yt.probe.times[0],
      lastTime: yt.probe.times[yt.probe.times.length - 1],
      error: yt.probe.error ?? null,
    };
    save();

    // (b) extension-driven pause/play + survive hidden.
    if (played) {
      yt.command("pause");
      await sleep(2500);
      const tPaused = yt.probe.times[yt.probe.times.length - 1];
      await sleep(2500);
      const stillPaused = yt.probe.times[yt.probe.times.length - 1] === tPaused;
      yt.command("play");
      const resumed = await waitFor(() => yt.probe.times[yt.probe.times.length - 1] > (tPaused ?? 0), 10_000);
      // Hide the panel by opening another editor group / closing focus.
      await vscode.commands.executeCommand("workbench.action.focusSideBar");
      const beforeHidden = yt.probe.times[yt.probe.times.length - 1];
      await sleep(6000);
      const afterHidden = yt.probe.times[yt.probe.times.length - 1];
      results.control = {
        pausedByExtension: stillPaused,
        resumedByExtension: resumed,
        advancedWhileHidden: Number(((afterHidden ?? 0) - (beforeHidden ?? 0)).toFixed(2)),
      };
      save();
    }
  } catch (err) {
    results.fatal = String(err instanceof Error ? err.stack : err);
  } finally {
    save();
  }
}
