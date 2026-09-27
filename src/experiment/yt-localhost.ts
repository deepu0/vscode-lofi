import * as http from "http";
import * as vscode from "vscode";
import { AddressInfo } from "net";

/**
 * Creative YouTube spike (localhost-origin variant).
 *
 * The earlier spike embedded the YouTube IFrame API directly in a VS Code
 * webview, whose document origin is `vscode-webview://…`. YouTube rejected it
 * with error 153 (embedding not allowed from that origin).
 *
 * This variant serves the YouTube embed from a local HTTP server
 * (`http://127.0.0.1:<port>`) and loads THAT page in an <iframe> inside the
 * webview. The inner iframe's origin is `http://127.0.0.1:<port>` — a normal
 * http origin, the same kind of origin a website like lofi.cafe has. The bet:
 * YouTube accepts a localhost origin and plays.
 *
 * Not wired into the shipping player; reachable only via the hidden
 * `lofi.youtubeLocalhostExperiment` command. Desktop-only (needs a Node server).
 */

const DEFAULT_VIDEO = "jfKfPfyJRdk"; // "lofi hip hop radio"

export interface YtLocalhostProbe {
  serverOrigin?: string;
  iframeLoaded: boolean;
  apiReady: boolean;
  playerReady: boolean;
  states: number[];
  times: number[];
  advanced: boolean;
  error?: number | string;
}

let server: http.Server | undefined;
let panel: vscode.WebviewPanel | undefined;
let latest: YtLocalhostProbe = { iframeLoaded: false, apiReady: false, playerReady: false, states: [], times: [], advanced: false };
const listeners = new Set<(p: YtLocalhostProbe) => void>();

export const ytLocalhost = {
  get probe() {
    return latest;
  },
  onUpdate(fn: (p: YtLocalhostProbe) => void) {
    listeners.add(fn);
    return { dispose: () => listeners.delete(fn) };
  },
  command(cmd: "play" | "pause") {
    // Tell the webview shell to relay this down into the localhost iframe.
    panel?.webview.postMessage({ type: "relay", cmd });
  },
  hasPanel() {
    return panel !== undefined;
  },
  async dispose() {
    panel?.dispose();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = undefined;
  },
};

export function registerYtLocalhostExperiment(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("lofi.youtubeLocalhostExperiment", (videoId?: string) => open(context, videoId ?? DEFAULT_VIDEO)),
  );
}

/** The page served over http://127.0.0.1 — this is where the YouTube iframe API runs, at a localhost origin. */
function embedHtml(videoId: string): string {
  return /* html */ `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}#p{width:100%;height:100%}</style></head>
<body><div id="p"></div><script>
  const post = (m) => parent.postMessage(JSON.stringify(m), "*");
  let player;
  post({ type: "diag", origin: location.origin, href: location.href, referrer: document.referrer });
  window.onYouTubeIframeAPIReady = function () {
    post({ type: "apiReady" });
    player = new YT.Player("p", {
      videoId: ${JSON.stringify(videoId)},
      playerVars: { autoplay: 1, playsinline: 1 },
      events: {
        onReady: (e) => { post({ type: "playerReady" }); e.target.playVideo(); },
        onStateChange: (e) => { post({ type: "state", state: e.data, time: player.getCurrentTime() }); },
        onError: (e) => { post({ type: "error", code: e.data }); },
      },
    });
  };
  window.addEventListener("message", (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (!player) return;
    if (m.type === "play") player.playVideo();
    if (m.type === "pause") player.pauseVideo();
  });
  setInterval(() => { if (player && player.getCurrentTime) post({ type: "tick", time: player.getCurrentTime() }); }, 1000);
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  s.onerror = () => post({ type: "error", code: "iframe_api load failed" });
  document.head.appendChild(s);
</script></body></html>`;
}

async function open(context: vscode.ExtensionContext, videoId: string) {
  latest = { iframeLoaded: false, apiReady: false, playerReady: false, states: [], times: [], advanced: false };

  server = http.createServer((req, res) => {
    if (req.url?.startsWith("/embed")) {
      res.writeHead(200, { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" });
      res.end(embedHtml(videoId));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server!.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  latest.serverOrigin = origin;

  panel = vscode.window.createWebviewPanel("lofiYtLocalhost", "YouTube (localhost) Experiment", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.onDidDispose(() => {
    panel = undefined;
    server?.close();
    server = undefined;
  });
  const origin_ = origin;
  panel.webview.onDidReceiveMessage((m: any) => {
    if (m.type === "iframeLoaded") latest.iframeLoaded = true;
    if (m.type === "apiReady") latest.apiReady = true;
    if (m.type === "playerReady") latest.playerReady = true;
    if (m.type === "state") {
      latest.states.push(m.state);
      if (typeof m.time === "number") latest.times.push(Number(m.time.toFixed(2)));
    }
    if (m.type === "tick" && typeof m.time === "number") {
      latest.times.push(Number(m.time.toFixed(2)));
      if (latest.times.length >= 2 && latest.times[latest.times.length - 1] > latest.times[0]) latest.advanced = true;
    }
    if (m.type === "error") latest.error = m.code;
    if (m.type === "diag") (latest as any).diag = { origin: m.origin, href: m.href, referrer: m.referrer };
    listeners.forEach((fn) => fn(latest));
  });

  // The webview shell: it hosts an iframe whose src is the localhost embed, and
  // relays postMessages between that iframe and the extension.
  panel.webview.html = /* html */ `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin_}; script-src 'unsafe-inline';">
<style>html,body{margin:0;height:100%;background:#111}iframe{border:0;width:100%;height:100vh}</style></head>
<body>
<iframe id="f" src="${origin_}/embed" allow="autoplay; encrypted-media"></iframe>
<script>
  const vscode = acquireVsCodeApi();
  const f = document.getElementById("f");
  f.addEventListener("load", () => vscode.postMessage({ type: "iframeLoaded" }));
  window.addEventListener("message", (ev) => {
    // Messages coming up from the localhost iframe -> forward to the extension.
    if (typeof ev.data === "string") {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      vscode.postMessage(m);
      return;
    }
    // Messages coming down from the extension (relay) -> forward into the iframe.
    if (ev.data && ev.data.type === "relay") {
      f.contentWindow.postMessage(JSON.stringify({ type: ev.data.cmd }), "${origin_}");
    }
  });
</script>
</body></html>`;
}
