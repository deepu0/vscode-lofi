import * as vscode from "vscode";

/**
 * Isolated YouTube spike. This is NOT wired into the shipping player. It is
 * activated only by the hidden `lofi.youtubeExperiment` command and opens its
 * own panel that embeds the YouTube IFrame Player API. Its whole job is to
 * answer: does an official YouTube embed load and play audio inside a VS Code
 * webview, and can we drive play/pause from the extension?
 *
 * See docs/youtube-experiment.md for the finding.
 */

// "lofi hip hop radio 📚 beats to relax/study to" — the canonical always-on lofi live stream.
const DEFAULT_VIDEO = "jfKfPfyJRdk";

export interface YouTubeProbe {
  /** Player states seen, mapped from YT.PlayerState (-1 unstarted,0 ended,1 playing,2 paused,3 buffering,5 cued). */
  states: number[];
  /** currentTime samples (seconds) so we can tell playback actually advanced. */
  times: number[];
  apiReady: boolean;
  playerReady: boolean;
  error?: number | string;
  advanced: boolean;
}

let panel: vscode.WebviewPanel | undefined;
let latest: YouTubeProbe = { states: [], times: [], apiReady: false, playerReady: false, advanced: false };
const listeners = new Set<(p: YouTubeProbe) => void>();

/** Exposed to the experiment harness via the extension's activate() return. */
export const youtube = {
  get probe() {
    return latest;
  },
  onUpdate(fn: (p: YouTubeProbe) => void) {
    listeners.add(fn);
    return { dispose: () => listeners.delete(fn) };
  },
  command(cmd: "play" | "pause") {
    panel?.webview.postMessage({ type: cmd });
  },
  hasPanel() {
    return panel !== undefined;
  },
};

export function registerYouTubeExperiment(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("lofi.youtubeExperiment", (videoId?: string) => open(videoId ?? DEFAULT_VIDEO)),
  );
}

function open(videoId: string) {
  latest = { states: [], times: [], apiReady: false, playerReady: false, advanced: false };
  panel = vscode.window.createWebviewPanel("lofiYouTube", "Lofi Radio: YouTube Experiment", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.onDidDispose(() => (panel = undefined));
  panel.webview.onDidReceiveMessage((m: Partial<YouTubeProbe> & { type: string }) => {
    if (m.type === "apiReady") latest = { ...latest, apiReady: true };
    if (m.type === "playerReady") latest = { ...latest, playerReady: true };
    if (m.type === "state" && typeof m.states === "undefined") return;
    if (m.type === "probe") {
      latest = { ...latest, ...m };
    }
    listeners.forEach((fn) => fn(latest));
  });
  panel.webview.html = html(videoId);
}

/**
 * The YouTube IFrame API must load from https://www.youtube.com. VS Code
 * webviews send Origin: vscode-webview://..., which YouTube may reject for
 * embedding; that rejection is exactly what this spike measures.
 */
function html(videoId: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  html,body { margin:0; height:100%; background:#1e1e1e; color:#ccc; font-family:sans-serif; }
  #player { width:100%; height:70vh; }
  #log { padding:8px; font-size:12px; white-space:pre-wrap; }
</style>
</head>
<body>
<div id="player"></div>
<div id="log">Loading YouTube IFrame API…</div>
<script>
  const vscode = acquireVsCodeApi();
  const log = (m) => { document.getElementById("log").textContent += "\\n" + m; };
  const probe = { states: [], times: [], apiReady: false, playerReady: false, advanced: false };
  const push = () => vscode.postMessage({ type: "probe", ...probe });

  let player;
  window.onYouTubeIframeAPIReady = function () {
    probe.apiReady = true;
    vscode.postMessage({ type: "apiReady" });
    log("API ready; creating player");
    player = new YT.Player("player", {
      videoId: ${JSON.stringify(videoId)},
      playerVars: { autoplay: 1, playsinline: 1, origin: location.origin },
      events: {
        onReady: (e) => { probe.playerReady = true; vscode.postMessage({ type: "playerReady" }); log("player ready"); e.target.playVideo(); },
        onStateChange: (e) => {
          probe.states.push(e.data);
          try { probe.times.push(Number(player.getCurrentTime().toFixed(2))); } catch {}
          if (probe.times.length >= 2 && probe.times[probe.times.length-1] > probe.times[0]) probe.advanced = true;
          log("state " + e.data);
          push();
        },
        onError: (e) => { probe.error = e.data; log("error " + e.data); push(); },
      },
    });
  };

  window.addEventListener("message", (ev) => {
    if (!player) return;
    if (ev.data.type === "play") player.playVideo();
    if (ev.data.type === "pause") player.pauseVideo();
  });

  setInterval(() => {
    if (!player || !player.getCurrentTime) return;
    const t = Number(player.getCurrentTime().toFixed(2));
    probe.times.push(t);
    if (t > (probe.times[0] || 0)) probe.advanced = true;
    push();
  }, 1000);

  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  s.onerror = () => { probe.error = "iframe_api script failed to load"; log("iframe_api load error"); push(); };
  document.head.appendChild(s);
</script>
</body>
</html>`;
}
