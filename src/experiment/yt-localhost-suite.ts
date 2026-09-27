/**
 * Runs inside real VS Code to test the creative YouTube fix (Q28b):
 * does a YouTube embed served from http://127.0.0.1 (loaded in an iframe inside
 * the webview) actually PLAY, where the direct vscode-webview:// embed failed
 * with error 153?
 * "Playing" = YouTube reports state 1 AND getCurrentTime() advances.
 * Also checks extension-driven pause/play and survival while the tab is hidden.
 * Writes findings to $LOFI_RESULTS.
 */
import * as fs from "fs";
import * as vscode from "vscode";
import type { ytLocalhost as YT } from "./yt-localhost";

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
    const api = (await ext.activate()) as { ytLocalhost?: typeof YT };
    const yt = api.ytLocalhost;
    if (!yt) throw new Error("ytLocalhost not exposed (web build?)");

    // Try several lofi videos: the canonical live streams (often embed-locked) plus
    // known-embeddable uploads. If ANY plays, the localhost-origin fix works and the
    // block on the others is per-video embedding policy, not our origin.
    const videos = (process.env.LOFI_YT_VIDEOS ?? "jfKfPfyJRdk,5qap5aO4i9A,DWcJFNfaw9c,lTRiuFIWV54,rUxyKA_-grg").split(",");
    const perVideo: Record<string, unknown>[] = [];
    let firstWorking: string | undefined;

    for (const videoId of videos) {
      await vscode.commands.executeCommand("lofi.youtubeLocalhostExperiment", videoId);
      await waitFor(() => yt.hasPanel(), 5000);
      const iframeLoaded = await waitFor(() => yt.probe.iframeLoaded, 15_000);
      const apiReady = await waitFor(() => yt.probe.apiReady, 25_000);
      const playerReady = await waitFor(() => yt.probe.playerReady, 15_000);
      const played = await waitFor(() => yt.probe.advanced, 20_000);
      perVideo.push({
        videoId,
        diag: (yt.probe as any).diag,
        serverOrigin: yt.probe.serverOrigin,
        iframeLoaded,
        apiReady,
        playerReady,
        played,
        states: yt.probe.states,
        error: yt.probe.error ?? null,
      });
      results.perVideo = perVideo;
      save();
      if (played && !firstWorking) {
        firstWorking = videoId;
        break; // keep this panel open for the control checks below
      }
      await yt.dispose();
      await sleep(500);
    }

    results.originFixWorks = firstWorking !== undefined;
    results.firstWorkingVideo = firstWorking ?? null;
    save();
    if (!firstWorking) return;

    {
      yt.command("pause");
      await sleep(3000);
      const tPaused = yt.probe.times[yt.probe.times.length - 1];
      await sleep(2500);
      const stayedPaused = yt.probe.times[yt.probe.times.length - 1] === tPaused;
      yt.command("play");
      const resumed = await waitFor(() => yt.probe.times[yt.probe.times.length - 1] > (tPaused ?? 0), 12_000);

      await vscode.commands.executeCommand("workbench.action.focusSideBar");
      const beforeHidden = yt.probe.times[yt.probe.times.length - 1];
      await sleep(6000);
      const afterHidden = yt.probe.times[yt.probe.times.length - 1];
      results.control = {
        pausedByExtension: stayedPaused,
        resumedByExtension: resumed,
        advancedWhileHidden: Number(((afterHidden ?? 0) - (beforeHidden ?? 0)).toFixed(2)),
      };
      save();
    }

    await yt.dispose();
  } catch (err) {
    results.fatal = String(err instanceof Error ? err.stack : err);
  } finally {
    save();
  }
}
