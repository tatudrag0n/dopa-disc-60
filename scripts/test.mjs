/**
 * テスト実行スクリプト。
 *
 * テストは TypeScript のまま（test/*.test.ts）書いているが、Node はそのままでは
 * TypeScript を読めない（src 側の import は拡張子なしなので、型ストリップだけでも
 * 解決できない）。そこで esbuild でテストごとにバンドルしてから、
 * Node の組込みテストランナーに渡す。
 *
 *   npm test
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const testDir = "test";
const entries = (await readdir(testDir))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => path.join(testDir, file));

if (entries.length === 0) {
  console.error("テストファイルが見つかりません（test/*.test.ts）");
  process.exit(1);
}

const outdir = await mkdtemp(path.join(tmpdir(), "dopa-tests-"));

try {
  await build({
    entryPoints: entries,
    outdir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outExtension: { ".js": ".mjs" },
    logLevel: "warning",
  });

  const bundles = (await readdir(outdir))
    .filter((file) => file.endsWith(".mjs"))
    .sort()
    .map((file) => path.join(outdir, file));

  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", ...bundles], { stdio: "inherit" });
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  process.exitCode = code;
} finally {
  await rm(outdir, { recursive: true, force: true });
}
