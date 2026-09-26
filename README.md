# Lofi Radio for VS Code

Chill internet radio in your VS Code sidebar and status bar.

> **Status: prototype.** Playback works; the v1 features are next. See [docs/decisions.md](docs/decisions.md) for the plan and [docs/prototype-findings.md](docs/prototype-findings.md) for what the playback spike found.

## Try it

```sh
npm install
npm run build
```

Open this folder in VS Code and press <kbd>F5</kbd>. In the new window, open the **Lofi Radio** view (headphones icon in the Activity Bar) and click ▶. VS Code requires one click inside the player before audio can play; after that, the status bar item and the `Lofi Radio:` commands work even with the sidebar closed.

## Stations

| Station | Source |
|---|---|
| SomaFM Fluid, Groove Salad, Lush | [SomaFM](https://somafm.com/). Listener-supported; please [support them](https://somafm.com/support/) |
| laut.fm lofi | [laut.fm](https://laut.fm/lofi) |
| REYFM #lofi | [REYFM](https://www.reyfm.de/) |
| I Love Chillhop | [I Love Music](https://www.ilovemusic.de/ilovechillhop/) |

Streams belong to their operators. Station operators who want to be removed can open an issue.

## Playback experiment

`npm run experiment` runs the prototype checks inside a real VS Code instance. It needs a display; on Linux without one, run `Xvfb :99 &` and set `DISPLAY=:99` first.

## License

MIT
