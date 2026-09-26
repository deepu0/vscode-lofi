/**
 * Runs inside a real VS Code instance and answers the prototype questions:
 *  Q1. Can playback start from the status bar before the user has clicked inside the player?
 *      If not, does one real click unlock it so the status bar and commands work afterwards?
 *  Q2. Does audio keep playing when the sidebar switches to another view or is closed?
 *  Q3. Which built-in streams actually play in the webview?
 * "Playing" means the <audio> element's currentTime keeps advancing, as reported by webview ticks.
 */
import * as fs from "fs";
import * as vscode from "vscode";
import type { Player } from "../player";
import { BUILT_IN_STATIONS } from "../stations";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(250);
  }
  return pred();
}

/** Ask the launcher (run.ts) for a trusted mouse click on `selector` inside the webview. */
async function realClick(selector: string): Promise<string> {
  const file = process.env.LOFI_SIGNAL!;
  fs.rmSync(file + ".done", { force: true });
  fs.writeFileSync(file, selector);
  await waitFor(() => fs.existsSync(file + ".done"), 30_000);
  return fs.existsSync(file + ".done") ? fs.readFileSync(file + ".done", "utf8") : "timeout";
}

/** Seconds of audio that advanced over `ms` of wall time, from webview heartbeats. */
async function measureAdvance(player: Player, ms: number) {
  // Start from a fresh heartbeat so a tick from the previous stream can't skew the delta.
  const since = Date.now();
  await waitFor(() => (player.lastTick?.at ?? 0) > since, 3000);
  const before = player.lastTick;
  await sleep(ms);
  const after = player.lastTick;
  const advanced = before && after ? after.currentTime - before.currentTime : 0;
  return {
    advancedSeconds: Number(advanced.toFixed(2)),
    ticksStillArriving: !!after && Date.now() - after.at < 2500,
    paused: after?.paused,
    visibility: after?.visibility,
  };
}

const settled = (p: Player) => () => ["playing", "error", "needsClick"].includes(p.state.status);

export async function run(): Promise<void> {
  const results: Record<string, unknown> = { vscodeVersion: vscode.version };
  const save = () => fs.writeFileSync(process.env.LOFI_RESULTS!, JSON.stringify(results, null, 2));

  try {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "vscode-lofi")!;
    const { player } = (await ext.activate()) as { player: Player };
    await vscode.commands.executeCommand("workbench.view.explorer");
    await sleep(3000);

    // Q1a: status bar command before any click inside the player.
    const viewResolvedBefore = player.viewResolved;
    await vscode.commands.executeCommand("lofi.togglePlay");
    await waitFor(settled(player), 20_000);
    results.q1a_statusBarBeforeAnyClick = {
      viewResolvedBefore,
      viewRevealedAndResolved: player.viewResolved,
      status: player.state.status,
      error: player.state.error,
    };
    save();

    // Q1b: one real click on ▶ inside the sidebar player.
    await sleep(1500);
    const click = await realClick("#toggle");
    const t0 = Date.now();
    const playing = await waitFor(() => player.state.status === "playing", 20_000);
    results.q1b_afterOneRealClick = {
      click,
      unlocked: player.unlocked,
      status: player.state.status,
      error: player.state.error,
      secondsToPlaying: playing ? (Date.now() - t0) / 1000 : null,
      ...(playing ? await measureAdvance(player, 4000) : {}),
    };
    save();
    if (!playing) return;

    // Light check: toggleMute flips player.state.muted (no audio assertion; no sound card).
    const mutedBefore = player.state.muted;
    await player.toggleMute();
    const mutedAfter = player.state.muted;
    await player.toggleMute();
    results.muteToggle = {
      mutedBefore,
      mutedAfterToggle: mutedAfter,
      flipped: mutedAfter === !mutedBefore,
      restored: player.state.muted === mutedBefore,
    };
    save();

    // Light check: setStations reconciles the *current* station by id, not index.
    // (1) A reordered list must keep the same station selected. (2) A list that
    // drops the current station must stop playback (never auto-switch).
    const currentId = player.station.id;
    // Reorder: reverse the built-ins so the current station lands at a new index.
    const reordered = [...BUILT_IN_STATIONS].reverse();
    const expectedIndex = reordered.findIndex((s) => s.id === currentId);
    player.setStations(reordered);
    const afterReorder = {
      idPreserved: player.station.id === currentId,
      repointedToExpectedIndex: player.state.stationIndex === expectedIndex,
      status: player.state.status,
    };
    // Remove the current station entirely: playback must stop, never switch.
    const withoutCurrent = reordered.filter((s) => s.id !== currentId);
    player.setStations(withoutCurrent);
    const afterRemoval = {
      stopped: player.state.status === "paused" || player.state.status === "idle",
      didNotAutoSwitch: player.station?.id !== currentId,
      status: player.state.status,
    };
    // Restore the full built-in list and resume the original station for Q2/Q3.
    player.setStations(BUILT_IN_STATIONS);
    await player.play(BUILT_IN_STATIONS.findIndex((s) => s.id === currentId));
    await waitFor(() => player.state.status === "playing", 20_000);
    results.setStationsReconcile = { currentId, afterReorder, afterRemoval };
    save();

    // Q2: hide the view while playing.
    await vscode.commands.executeCommand("workbench.view.explorer");
    await sleep(1000);
    results.q2a_sidebarShowsExplorer = await measureAdvance(player, 6000);
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await sleep(1000);
    results.q2b_sidebarClosed = await measureAdvance(player, 6000);
    save();

    // Q1c: status bar pause / resume with the view hidden, no further clicks.
    await vscode.commands.executeCommand("lofi.togglePlay");
    await sleep(1500);
    const statusAfterPause = player.state.status;
    const tickPausedAfter = await measureAdvance(player, 2000);
    await vscode.commands.executeCommand("lofi.togglePlay");
    const resumed = await waitFor(settled(player), 20_000) && player.state.status === "playing";
    results.q1c_statusBarWhileHiddenAfterUnlock = {
      statusAfterPause,
      audioStoppedAfterPause: tickPausedAfter.advancedSeconds === 0,
      resumed,
      status: player.state.status,
      error: player.state.error,
      ...(resumed ? await measureAdvance(player, 4000) : {}),
    };
    save();

    // Q3: every built-in station, switched via commands with the sidebar still closed.
    const stations: Record<string, unknown>[] = [];
    for (let i = 0; i < BUILT_IN_STATIONS.length; i++) {
      const s = BUILT_IN_STATIONS[i];
      const start = Date.now();
      await player.play(i);
      await sleep(500);
      await waitFor(settled(player), 20_000);
      const ok = player.state.status === "playing";
      stations.push({
        station: s.name,
        playing: ok,
        secondsToPlaying: ok ? (Date.now() - start) / 1000 : null,
        status: player.state.status,
        error: player.state.error,
        ...(ok ? await measureAdvance(player, 5000) : {}),
      });
      results.q3_stations = stations;
      save();
    }
    await player.pause();
  } catch (err) {
    results.fatal = String(err instanceof Error ? err.stack : err);
  } finally {
    save();
  }
}
