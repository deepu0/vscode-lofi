# Decisions

Outcome of the design interview (grilling session), September 2026.

| # | Decision | Choice |
|---|---|---|
| Q1 | Audience | Published on the VS Code Marketplace |
| Q2 | Music source | Internet radio (v1) + local files (v1.1); YouTube official embed as a later experiment. No `ytdl`/`yt-dlp` audio extraction (violates YouTube ToS) |
| Q3 | Playback | Audio plays inside a webview (`<audio>`), no external player |
| Q4/Q5 | Repo | `deepu0/vscode-lofi`, public, MIT |
| Q6 | Station list | Curated built-in list + user custom stations via settings (v1); Radio Browser search later |
| Q7 | UI | Sidebar webview player + status bar item + Command Palette commands |
| Q8 | Local files | v1.1; keep music sources behind a swappable interface |
| Q9 | YouTube | After radio works, time-boxed spike on its own branch |
| Q10 | Name / publisher | Display name "Lofi Radio"; publisher in `package.json` is a placeholder until a Marketplace publisher is created |
| Q11 | Stack | TypeScript, esbuild, npm, `@vscode/test-cli` |
| Q12 | Angle | v1 = polished minimal player; v1.1 headline = Pomodoro (fade out on breaks) |
| Q13 | Startup | Silent until play is pressed; optional "resume on startup" setting (off by default). Remember last station + volume |
| Q14 | Controls | Play/pause, next/previous, Quick Pick station picker, volume + mute. One default keybinding (play/pause) |
| Q15 | Dropped stream | Retry with backoff, then "station offline" notice; never auto-switch stations |
| Q16 | Web (vscode.dev) | Yes if it's only an extra build target — **added in v1** (see note below) |
| Q17 | Now playing | Station name only in v1; ICY track titles in v1.1 |
| Q18 | Built-in stations | SomaFM Fluid, Groove Salad, Lush + laut.fm lofi, REYFM #lofi, I Love Chillhop. Credit + homepage link for each; remove on operator request |

## Station sources

- **SomaFM** permits direct stream links using its official URLs (see [link to us](https://somafm.com/linktous/)). Listener-supported, so we link to their donate page.
- **laut.fm, REYFM, I Love Music**: public streams listed in the Radio Browser directory; no explicit third-party player policy found. Kept on the list with attribution, and removed if an operator asks.

## Web / vscode.dev target (Q16) — resolved in v1

Adding a browser build turned out to be genuinely cheap, so it was done in v1 rather than deferred:

- The extension source (`extension.ts`, `player.ts`, `stations.ts`) imports only the `vscode` API and relative modules. No Node-only APIs (`fs`, `path`, `child_process`, `Buffer`, `process`, `require`) are used; audio is owned by the webview's `<audio>` element in `media/player.js`. The only Node-dependent code is the dev-only experiment harness (`src/experiment/**`), which is excluded from the shipped bundle and from the web build.
- Implementation: a second `esbuild` build with `platform: "browser"` emits `dist/web/extension.js`, referenced by the top-level `"browser"` field in `package.json`. No source changes were required.
- Caveat for v1.1: web-host playback depends on the browser and on stream CORS policy; the desktop host stays the primary, fully experiment-tested target. Local-file sources (Q8) will remain desktop-only until a web-compatible source is designed.
