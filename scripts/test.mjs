import { build } from "esbuild";
import { mkdir, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Bundle tests in isolation, so Worker-only bindings cannot accidentally hit a live service.
const output = path.resolve(".test-build");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const entries = (await readdir("tests")).filter((name) => name.endsWith(".test.ts")).sort();
if (!entries.length) throw new Error("No tests found");
await build({
  entryPoints: entries.map((name) => `tests/${name}`),
  outdir: output,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  define: { "import.meta.env.DEV": "false" },
  external: ["node:*"],
  alias: { "cloudflare:workers": path.resolve("tests/support/cloudflare.ts") },
  sourcemap: "inline",
  logLevel: "warning",
});
const result = spawnSync(
  process.execPath,
  ["--test", ...entries.map((name) => path.join(output, name.replace(/\.ts$/, ".js")))],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
