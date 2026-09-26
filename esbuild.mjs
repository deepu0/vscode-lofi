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
  { ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js" },
  // Prototype-only: headless VS Code experiment (launcher + in-editor test).
  {
    ...common,
    entryPoints: ["src/experiment/run.ts", "src/experiment/suite.ts"],
    outdir: "dist/experiment",
    external: ["vscode", "@vscode/test-electron"],
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
