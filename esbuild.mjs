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
  // Web extension host bundle (vscode.dev / github.dev). The extension source uses
  // only the `vscode` API — no Node-only APIs — so the browser target is just a
  // second bundle with platform:"browser" and no source changes. Matches the
  // `browser` field in package.json.
  {
    ...common,
    platform: "browser",
    target: "es2020",
    entryPoints: ["src/extension.ts"],
    outfile: "dist/web/extension.js",
  },
  // Prototype-only: headless VS Code experiment (launcher + in-editor test).
  {
    ...common,
    entryPoints: [
      "src/experiment/run.ts",
      "src/experiment/suite.ts",
      "src/experiment/youtube-suite.ts",
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
