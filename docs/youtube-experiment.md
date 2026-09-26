# YouTube experiment (spike)

**Question (Q22):** does YouTube's official embedded player work inside a VS Code webview — load, play audio, and accept play/pause from the extension while the panel is hidden?

**Verdict: No.** The embed loads but refuses to play. Not viable as a music source for the extension.

## What was tested

A hidden command, `Lofi Radio: YouTube Experiment (spike)` (`lofi.youtubeExperiment`), opens its own webview panel and loads the official [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) with the canonical always-on lofi live stream (`jfKfPfyJRdk`, "lofi hip hop radio"). The spike is fully isolated: it is not wired into the shipping player and shares none of its code.

`npm run build && LOFI_SUITE=youtube node dist/experiment/run.js` runs it in real VS Code (1.139.1) and records what the player reports. The harness even sends a trusted mouse click into the panel, in case autoplay needed a user gesture.

## Result (reproduced across runs)

| Signal | Value |
|---|---|
| IFrame API loaded (`onYouTubeIframeAPIReady`) | ✅ yes |
| Player object created (`onReady`) | ✅ yes |
| Playback state changed to *playing* | ❌ never (no `onStateChange` fired) |
| `getCurrentTime()` advanced | ❌ no (stuck at 0) |
| `onError` code | **153** |

The script, the API, and the player object all load fine from `https://www.youtube.com`. The failure is at playback: YouTube fires **error 153** and never enters a playing state.

## Why

Error 153 is an embedding/playback-permission rejection. VS Code webviews run on a `vscode-webview://…` origin and sandbox their iframes; YouTube evaluates the embedding context (origin / referrer / frame ancestry) and declines to play. This is the risk called out during the design interview (Q2): official embeds frequently refuse to play inside VS Code webviews, independent of our code. Because playback never starts, the part-(b) checks (extension-driven play/pause, surviving the panel being hidden) could not be exercised.

## Consequence

- **YouTube stays out of the extension.** The shipping player continues to use internet radio streams (v1) and will add local files (v1.1).
- Extracting audio from YouTube with tools like `yt-dlp` was already rejected in the design interview (Q2): it violates YouTube's Terms of Service and would get the extension removed from the Marketplace. This spike does not revisit that.
- This branch (`experiment/youtube`) is a **throwaway record of the finding**. It is intentionally not merged into the shipping line. The isolated command and harness remain here so the result can be re-checked if VS Code's or YouTube's behavior changes.

## Reproduce

```sh
npm install && npm run build
Xvfb :99 -screen 0 1280x800x24 &   # headless only
DISPLAY=:99 LOFI_SUITE=youtube node dist/experiment/run.js
cat experiment-results.json
```

Or interactively: press F5, then run **Lofi Radio: YouTube Experiment (spike)** from the Command Palette and watch the panel's on-screen log.
