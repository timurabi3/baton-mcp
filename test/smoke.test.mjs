// stdio smoke tests for the Baton MCP server. Zero dependencies — Node's built-in runner.
// Run: npm test   (Node >= 18)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));

/** Minimal newline-delimited JSON-RPC client over the server's stdio. */
function connect() {
  const proc = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let buf = "";
  let nextId = 0;

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, resolve);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  return { proc, rpc, close: () => proc.kill() };
}

test("initialize returns serverInfo", async () => {
  const c = connect();
  try {
    const res = await c.rpc("initialize", {});
    assert.equal(res.result.serverInfo.name, "baton");
    assert.ok(res.result.protocolVersion, "protocolVersion present");
  } finally {
    c.close();
  }
});

test("tools/list exposes exactly the six baton verbs", async () => {
  const c = connect();
  try {
    await c.rpc("initialize", {});
    const res = await c.rpc("tools/list", {});
    const names = res.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "baton_history",
      "baton_init",
      "baton_log",
      "baton_pass",
      "baton_pick_up",
      "baton_status",
    ]);
  } finally {
    c.close();
  }
});

test("baton_pass then baton_pick_up round-trips the handoff note", async () => {
  const dir = mkdtempSync(join(tmpdir(), "baton-smoke-"));
  const c = connect();
  try {
    await c.rpc("initialize", {});
    const note = "stopped after wiring the parser; next: hook up the CLI";

    const passed = await c.rpc("tools/call", {
      name: "baton_pass",
      arguments: { project: dir, task: "smoke", handoffNote: note, next: ["hook up the CLI"] },
    });
    assert.match(passed.result.content[0].text, /BATON PASSED/);
    assert.ok(existsSync(join(dir, "HANDOFF.md")), "HANDOFF.md written");
    assert.ok(existsSync(join(dir, ".baton", "baton.json")), "baton.json written");

    const picked = await c.rpc("tools/call", {
      name: "baton_pick_up",
      arguments: { project: dir },
    });
    assert.match(picked.result.content[0].text, /stopped after wiring the parser/);
    assert.match(picked.result.content[0].text, /hook up the CLI/);
  } finally {
    c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown tool is a clean JSON-RPC error", async () => {
  const c = connect();
  try {
    await c.rpc("initialize", {});
    const res = await c.rpc("tools/call", { name: "baton_nope", arguments: {} });
    assert.ok(res.error, "error field present");
    assert.match(res.error.message, /Unknown tool/);
  } finally {
    c.close();
  }
});
