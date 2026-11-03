import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runner = fileURLToPath(new URL("../run.mjs", import.meta.url));

function execute(args, env = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "specode-test-"));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 6000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      rmSync(cwd, { recursive: true, force: true });
      resolve({ code, signal, output });
    });
  });
}

async function withOllama(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("help does not need a provider", async () => {
  const result = await execute(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.output, /--resume/);
});

test("resume rejects invalid session paths before contacting Ollama", async () => {
  const result = await execute(["--resume", "../../outside"]);
  assert.equal(result.code, 1);
  assert.match(result.output, /Invalid session ID/);
});

test("malformed Ollama stream ends with an error", async () => {
  await withOllama((req, res) => {
    if (req.url === "/api/show") return void res.end("{}");
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end("not-json\\n");
  }, async (url) => {
    const result = await execute(["a small task tracker"], { OLLAMA_BASE_URL: url });
    assert.equal(result.code, 1);
    assert.match(result.output, /LLM error:/);
  });
});

test("stalled Ollama stream times out", async () => {
  await withOllama((req, res) => {
    if (req.url === "/api/show") return void res.end("{}");
    res.writeHead(200);
    res.write(" ");
  }, async (url) => {
    const result = await execute(["a small task tracker"], {
      OLLAMA_BASE_URL: url,
      SPECODE_HTTP_TIMEOUT_MS: "1000",
    });
    assert.equal(result.code, 1);
    assert.match(result.output, /timed out/);
  });
});
