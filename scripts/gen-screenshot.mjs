// Renders a static snapshot of the sidebar player panel and screenshots ONLY
// the panel (no VS Code window chrome) to media/screenshot.png.
//
// It loads the real media/player.css and the real BUILT_IN_STATIONS list, wraps
// them in a static HTML mirror of the panel markup from src/player.ts's
// Player.html() (same DOM ids/classes), applies stub VS Code DARK-theme CSS
// variables, and captures a narrow sidebar-width viewport with a headless
// chromium (playwright, launched with --no-sandbox: no display server, no
// nested sandbox). Run with `npm run screenshot`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "media", "player.css"), "utf8");

// Pull the built-in stations straight from source so the mock never drifts.
const stationsSrc = readFileSync(join(root, "src", "stations.ts"), "utf8");
const block = stationsSrc.slice(
  stationsSrc.indexOf("BUILT_IN_STATIONS"),
  stationsSrc.indexOf("isNonEmptyString"),
);
const names = [...block.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
const genres = [...block.matchAll(/genre:\s*"([^"]+)"/g)].map((m) => m[1]);
const stations = names.map((name, i) => ({ name, genre: genres[i] ?? "" }));

// Stub VS Code Dark+ theme variables so the panel renders on dark theme colors.
const theme = {
  "--vscode-foreground": "#cccccc",
  "--vscode-font-family": "-apple-system, 'Segoe UI', Ubuntu, sans-serif",
  "--vscode-focusBorder": "#007fd4",
  "--vscode-sideBar-background": "#252526",
  "--vscode-editorWidget-background": "#252526",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-button-background": "#0e639c",
  "--vscode-button-hoverBackground": "#1177bb",
  "--vscode-button-secondaryForeground": "#ffffff",
  "--vscode-button-secondaryBackground": "#313131",
  "--vscode-button-secondaryHoverBackground": "#3c3c3c",
  "--vscode-list-hoverBackground": "#2a2d2e",
  "--vscode-list-activeSelectionForeground": "#ffffff",
  "--vscode-list-activeSelectionBackground": "#04395e",
};
const themeVars = Object.entries(theme)
  .map(([k, v]) => `${k}: ${v};`)
  .join(" ");

// "Playing" now-playing state on the first station.
const now = stations[0];
const listItems = stations
  .map(
    (s, i) =>
      `<li class="${i === 0 ? "active" : ""}" title="${s.genre}">` +
      `<div class="st-name">${s.name}</div><div class="st-genre">${s.genre}</div></li>`,
  )
  .join("");

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root { ${themeVars} }
html, body { margin: 0; }
body { background: var(--vscode-sideBar-background); }
${css}
</style></head><body>
<div id="panel">
  <section class="now">
    <div class="now-label">Now playing</div>
    <div class="station" id="station">${now.name}</div>
    <div class="genre" id="genre">${now.genre}</div>
    <div class="status" id="status">Playing</div>
  </section>
  <section class="controls">
    <button id="prev" title="Previous station">⏮</button>
    <button id="toggle" class="primary" title="Play / Pause">⏸</button>
    <button id="next" title="Next station">⏭</button>
    <button id="mute" title="Mute / Unmute">🔊</button>
  </section>
  <label class="volume">Volume <input id="volume" type="range" min="0" max="1" step="0.01" value="0.7"></label>
  <ul class="stations" id="stations">${listItems}</ul>
</div>
</body></html>`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle" });
const panel = page.locator("#panel");
await panel.screenshot({ path: join(root, "media", "screenshot.png") });
await browser.close();
console.log("Wrote media/screenshot.png");
