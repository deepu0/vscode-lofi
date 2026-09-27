import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info",
};

const builds = [
  // Desktop (Node) extension host bundle.
  { ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js" },
  // Web extension host bundle (vscode.dev / github.dev). The shipping player uses
  // only the `vscode` API. The desktop-only YouTube-localhost spike pulls in Node
  // builtins (`http`/`net`); it is lazily required behind a `process.versions.node`
  // guard, so it never runs in the browser. Mark the Node builtins external here so
  // the browser bundle builds; the guarded code path is dead on the web.
  {
    ...common,
    platform: "browser",
    target: "es2020",
    entryPoints: ["src/extension.ts"],
    outfile: "dist/web/extension.js",
    external: ["vscode", "http", "net"],
  },
  // Prototype-only: headless VS Code experiment (launcher + in-editor test).
  {
    ...common,
    entryPoints: [
      "src/experiment/run.ts",
      "src/experiment/suite.ts",
      "src/experiment/yt-localhost-suite.ts",
    ],
    outdir: "dist/experiment",
    external: ["vscode", "@vscode/test-electron"],
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
