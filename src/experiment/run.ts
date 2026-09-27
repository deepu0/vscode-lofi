/**
 * Prototype experiment launcher. Starts real VS Code with the extension and
 * suite.ts, plus a Chrome DevTools Protocol (CDP) port so we can perform
 * *trusted* mouse clicks inside the webview when the suite asks for one. A
 * synthetic DOM click would not count as a user gesture for the autoplay policy.
 *
 * Usage: npm run experiment   (needs a display; headless: Xvfb + DISPLAY)
 */
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { spawn } from "child_process";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";

const CDP_PORT = 9333;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/** Minimal CDP client over Node's built-in WebSocket. */
async function connect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map<number, (m: any) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    pending.get(m.id)?.(m);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression: string) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
  return { send, evaluate, close: () => ws.close() };
}

/**
 * VS Code webviews are out-of-process iframes: workbench page -> iframe
 * (vscode-webview://<id>/index.html) -> same-origin #active-frame (our HTML).
 * Work out the element's position in page coordinates, then dispatch real
 * mouse input to the page target so Chromium hit-tests it into the webview.
 */
async function trustedClick(selector: string): Promise<void> {
  const targets = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json())) as Target[];
  const page = targets.find((t) => t.type === "page" && t.url.includes("workbench.html"));
  const webviews = targets.filter((t) => t.type === "iframe" && t.url.startsWith("vscode-webview://"));
  if (!page) throw new Error("workbench page target not found");

  for (const wv of webviews) {
    const frame = await connect(wv.webSocketDebuggerUrl);
    const inner = await frame.evaluate(`(() => {
      const f = document.getElementById("active-frame");
      const el = f && f.contentDocument && f.contentDocument.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const a = f.getBoundingClientRect(), r = el.getBoundingClientRect();
      return { x: a.left + r.left + r.width / 2, y: a.top + r.top + r.height / 2 };
    })()`);
    frame.close();
    if (!inner) continue;

    const host = new URL(wv.url).host;
    const pageClient = await connect(page.webSocketDebuggerUrl);
    const outer = await pageClient.evaluate(`(() => {
      const f = [...document.querySelectorAll("iframe")].find((i) => i.src.includes(${JSON.stringify(host)}));
      if (!f) return null;
      const r = f.getBoundingClientRect();
      return { x: r.left, y: r.top };
    })()`);
    if (!outer) {
      pageClient.close();
      throw new Error("webview iframe element not found in workbench");
    }
    const x = outer.x + inner.x;
    const y = outer.y + inner.y;
    await pageClient.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await pageClient.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await pageClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    pageClient.close();
    return;
  }
  throw new Error(`no webview contains ${selector} (webview targets: ${webviews.length})`);
}

async function serveClicks(signalFile: string, isDone: () => boolean) {
  while (!isDone()) {
    await sleep(300);
    if (!fs.existsSync(signalFile)) continue;
    const selector = fs.readFileSync(signalFile, "utf8").trim();
    let outcome = "ok";
    try {
      await trustedClick(selector);
    } catch (err) {
      outcome = `failed: ${err instanceof Error ? err.message : err}`;
    }
    fs.rmSync(signalFile, { force: true });
    fs.writeFileSync(signalFile + ".done", outcome);
  }
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lofi-exp-"));
  const workspace = path.join(tmp, "ws");
  fs.mkdirSync(workspace);
  const env = {
    ...process.env,
    LOFI_RESULTS: path.join(root, "experiment-results.json"),
    LOFI_SIGNAL: path.join(tmp, "click-request"),
  };
  fs.rmSync(env.LOFI_RESULTS, { force: true });

  const exe = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION ?? "stable");
  const log = fs.openSync(path.join(root, ".vscode-test", "experiment.log"), "w");
  const child = spawn(
    exe,
    [
      workspace,
      `--extensionDevelopmentPath=${root}`,
      `--extensionTestsPath=${path.join(__dirname, process.env.LOFI_SUITE === "yt-localhost" ? "yt-localhost-suite.js" : "suite.js")}`,
      `--user-data-dir=${path.join(tmp, "user-data")}`,
      `--extensions-dir=${path.join(tmp, "extensions")}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--no-sandbox",
      "--disable-gpu",
    ],
    { env, stdio: ["ignore", log, log] },
  );

  let exited = false;
  const exit = new Promise<void>((resolve) =>
    child.on("exit", () => {
      exited = true;
      resolve();
    }),
  );
  await Promise.all([serveClicks(env.LOFI_SIGNAL, () => exited), exit]);
  if (!fs.existsSync(env.LOFI_RESULTS)) throw new Error("VS Code exited without results; see .vscode-test/experiment.log");
  console.log(fs.readFileSync(env.LOFI_RESULTS, "utf8"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
