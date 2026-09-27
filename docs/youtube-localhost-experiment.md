# YouTube experiment, take 2: the localhost-origin fix

**Question (Q28b):** the first spike failed because a YouTube embed in a VS Code webview has origin `vscode-webview://…`, which YouTube rejects (error 153). The creative fix: serve the embed from a local HTTP server and load it in an `<iframe>`, so the iframe's origin is `http://127.0.0.1:<port>` — a normal http origin, like a real website. Does YouTube then play inside VS Code?

**Verdict: the origin fix worked, but YouTube still won't play in this environment — and the real blocker turns out to be the network, not the origin.** YouTube stays out of the shipping extension. What follows is exactly what was measured, including a result that undercuts the original theory.

## What was built

A hidden command `lofi.youtubeLocalhostExperiment` (desktop-only; needs a Node server) starts an `http.Server` on `127.0.0.1:<port>` that serves the YouTube IFrame Player API page, and opens a webview whose `<iframe src>` points at that localhost URL. Messages relay between the extension, the webview shell, and the localhost iframe. `LOFI_SUITE=yt-localhost node dist/experiment/run.js` drives it in real VS Code 1.139.1 and records per-video results.

## Step 1 — the origin fix is real

The iframe reported its own location back to the extension:

```
origin:   http://127.0.0.1:43511
href:     http://127.0.0.1:43511/embed
referrer: (empty)
```

So the embed genuinely ran on a `http://127.0.0.1` origin, **not** `vscode-webview://`. The origin swap succeeded, and the error changed from **153** (the vscode-webview origin rejection) to **150**. Different error, real progress — but still no playback.

## Step 2 — isolating error 150

Error 150 is "the video can't be played in an embedded player." It's usually read as per-video embedding policy, so the spike tried several videos: the canonical lofi live streams (`jfKfPfyJRdk`, `5qap5aO4i9A`, `DWcJFNfaw9c`, …). All returned 150.

To rule out our code and VS Code entirely, the same localhost embed page was then loaded in a **plain, full Chromium** (Playwright's bundled Chrome, real media codecs, autoplay allowed) — no VS Code involved. Same result: **every video, error 150.**

The decisive test: **`M7lc1UVf-VE`, YouTube's own official IFrame-API demo video** (the one in Google's embedding docs, embeddable everywhere) — also **error 150** here.

| Video | Where | Origin | Result |
|---|---|---|---|
| lofi live streams (several) | VS Code webview + localhost iframe | `http://127.0.0.1` | error 150 |
| lofi live streams (several) | plain Chromium + localhost | `http://127.0.0.1` | error 150 |
| YouTube's own demo `M7lc1UVf-VE` | plain Chromium + localhost | `http://127.0.0.1` | error 150 |

## What error 150 actually means here

If YouTube's own demo video won't embed, it isn't per-video policy and it isn't our origin. The common cause that fits every data point is that **this sandbox runs on a datacenter/cloud IP, and YouTube blocks embedded playback from such IPs** (a widely reported YouTube behavior). So in this environment YouTube embedding cannot work regardless of technique.

## Honest consequence

- The localhost-origin fix is a genuine, working technique: it moved us past the `vscode-webview://` rejection (153 → 150). **On a normal residential/office network, a localhost-served embed of an embeddable video very likely would play** — which is exactly how sites like lofi.cafe work.
- **But it cannot be verified from this environment**, and shipping a feature whose core cannot be tested here would be irresponsible. It also adds a local HTTP server and is desktop-only.
- Therefore **YouTube stays out of the shipping extension.** The player continues to use internet radio (reliable, cross-platform, verified playing in VS Code) and will add local files in v1.1.
- Audio extraction via `yt-dlp` remains rejected (Q2: violates YouTube ToS, Marketplace removal risk). Not revisited.
- This branch (`experiment/youtube-localhost`) is a documented record, not intended to merge.

## Reproduce

```sh
npm install && npm run build
Xvfb :99 -screen 0 1280x800x24 &            # headless only
DISPLAY=:99 LOFI_SUITE=yt-localhost node dist/experiment/run.js
cat experiment-results.json                  # look at perVideo[].error and diag.origin
```

Interactively (on a normal network, to see whether it plays there): press F5, run **Lofi Radio: YouTube (localhost) Experiment (spike)**.
