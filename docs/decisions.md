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
| Q16 | Web (vscode.dev) | Yes if it's only an extra build target |
| Q17 | Now playing | Station name only in v1; ICY track titles in v1.1 |
| Q18 | Built-in stations | SomaFM Fluid, Groove Salad, Lush + laut.fm lofi, REYFM #lofi, I Love Chillhop. Credit + homepage link for each; remove on operator request |

## Station sources

- **SomaFM** permits direct stream links using its official URLs (see [link to us](https://somafm.com/linktous/)). Listener-supported, so we link to their donate page.
- **laut.fm, REYFM, I Love Music**: public streams listed in the Radio Browser directory; no explicit third-party player policy found. Kept on the list with attribution, and removed if an operator asks.
