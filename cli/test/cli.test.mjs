import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("compiled CLI starts and prints usage without an intent", () => {
  const file = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Usage: specode/);
});
