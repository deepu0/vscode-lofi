# Prototype findings: playback spike

Run in real VS Code **1.139.1** (Linux, Xvfb) by `npm run experiment`. "Playing" means the `<audio>` element's `currentTime` kept advancing, as reported by the webview's once-a-second heartbeat. The sandbox has no sound card, so this proves decoding and playback progress, not that anything was audible.

## Q1: Can the status bar start audio?

| Situation | Result |
|---|---|
| Status bar pressed before the user ever clicked inside the player | **Blocked**: `NotAllowedError: play() can only be initiated by a user gesture` |
| After **one real click** on ▶ inside the sidebar player | Plays in 0.25 s |
| After that click: pause/resume and station changes from the status bar or commands, with the sidebar closed | **Works**, no further clicks needed |

VS Code webviews enforce Chromium's "user gesture required" autoplay policy. Chromium unlocks a media element for good once `play()` runs during a real gesture. On the first `pointerdown` in the view, `media/player.js` "primes" the `<audio>` element with a silent WAV clip. From then on, the extension can drive playback freely.

**Design consequences**
- Starting from the status bar before that first click shows a `needsClick` state: the status bar icon changes to a hand, the tooltip explains, and the sidebar is revealed with "Click ▶ to start".
- The unlock lasts as long as the webview does. `retainContextWhenHidden` keeps it alive while hidden. A window reload, or VS Code disposing the view, means one more click.
- "Resume on startup" (Q13) cannot start audio by itself. At best it can reveal the player with the last station ready, waiting for one click.

## Q2: Does audio keep playing while hidden?

| Situation | Audio advanced |
|---|---|
| Sidebar switched to Explorer | 6 s in 6 s ✅ |
| Sidebar closed | 6 s in 6 s ✅ |

This works with `retainContextWhenHidden: true` on the webview view. `document.visibilityState` stays `visible`, so the webview script can't rely on it to detect that the view is hidden.

## Q3: Do the built-in stations play?

| Station | Time to start | Audio advanced in 5 s |
|---|---|---|
| SomaFM Fluid | 0.5 s | 5 s ✅ |
| laut.fm lofi | 1.3 s | 5 s ✅ |
| REYFM #lofi | 1.8 s | 5 s ✅ |
| I Love Chillhop | 1.0 s | 5 s ✅ |
| SomaFM Groove Salad | 0.5 s | 5 s ✅ |
| SomaFM Lush | 0.5 s | 5 s ✅ |

## How the experiment works

`src/experiment/run.ts` starts VS Code with `--remote-debugging-port` and runs `suite.ts` inside the editor. When the suite needs a user gesture, it asks the launcher, which sends a real mouse event through the Chrome DevTools Protocol (`Input.dispatchMouseEvent`). A scripted DOM `.click()` would not count as a gesture.
