#!/usr/bin/env node
// Baton — an MCP relay baton so one AI agent continues exactly where another stopped.
// Zero dependencies. Speaks MCP over stdio: newline-delimited JSON-RPC 2.0.
// RULE: stdout carries protocol only. All logs go to stderr.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, symlinkSync, lstatSync, readlinkSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";

const SERVER_NAME = "baton";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2024-11-05";

// --- identity & root resolution -------------------------------------------
const AGENT = process.env.BATON_AGENT || "unknown-agent";
function projectRoot(args = {}) {
  const p = args.project || process.env.BATON_PROJECT || process.cwd();
  return resolve(p);
}
function batonDir(root) { return join(root, ".baton"); }
function statePath(root) { return join(batonDir(root), "baton.json"); }
function ledgerPath(root) { return join(batonDir(root), "ledger.jsonl"); }
function handoffPath(root) { return join(root, "HANDOFF.md"); }

const log = (...a) => process.stderr.write(`[baton] ${a.join(" ")}\n`);
const nowISO = () => new Date().toISOString();

// --- state io --------------------------------------------------------------
function ensureDir(root) { const d = batonDir(root); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function loadState(root) {
  const p = statePath(root);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { log("corrupt baton.json:", e.message); return null; }
}
function saveState(root, s) { ensureDir(root); writeFileSync(statePath(root), JSON.stringify(s, null, 2)); }
function appendLedger(root, entry) { ensureDir(root); appendFileSync(ledgerPath(root), JSON.stringify(entry) + "\n"); }
function readLedger(root, limit = 20) {
  const p = ledgerPath(root);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// --- HANDOFF.md human-readable mirror -------------------------------------
function renderHandoff(s) {
  const list = (arr) => (arr && arr.length ? arr.map(x => `- ${x}`).join("\n") : "_(none)_");
  return `# 🏃 HANDOFF — ${s.task || "untitled"}

> Auto-written by **Baton**. Any agent (Claude Code / Codex) reads this to continue where the last one stopped.
> **Do not hand-edit while an agent is mid-task** — call \`baton_pass\` instead.

| | |
|---|---|
| **Status** | ${s.status || "in_progress"} |
| **Last agent** | ${s.lastAgent || "?"} |
| **Updated** | ${s.updatedAt || "?"} |
| **Baton #** | ${s.passCount ?? 0} |

## 🎯 Goal
${s.goal || "_(not set)_"}

## 🛑 Where it stopped (read this first)
${s.handoffNote || "_(no note)_"}

## ✅ Done
${list(s.done)}

## ⏭️ Next steps (pick up here)
${list(s.next)}

## ❓ Open questions
${list(s.openQuestions)}

## ⚠️ Watch out (gotchas learned)
${list(s.watchOut)}

## 📂 Key files
${list(s.files)}

---
*Pick up the baton:* call \`baton_pick_up\` (MCP) or just read this file. *Pass it back:* \`baton_pass\`.
`;
}

// --- instruction-file bridge (CLAUDE.md <-> AGENTS.md) --------------------
// Both agents share ONE source of truth; the other name becomes a symlink.
function bridgeInstructions(root) {
  const claude = join(root, "CLAUDE.md");
  const agents = join(root, "AGENTS.md");
  const results = [];
  const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

  if (existsSync(claude) && !existsSync(agents)) {
    symlinkSync("CLAUDE.md", agents); results.push("AGENTS.md -> CLAUDE.md (symlink created)");
  } else if (existsSync(agents) && !existsSync(claude)) {
    symlinkSync("AGENTS.md", claude); results.push("CLAUDE.md -> AGENTS.md (symlink created)");
  } else if (!existsSync(claude) && !existsSync(agents)) {
    const stub = `# Project instructions (shared by Claude Code + Codex)\n\n> Baton-managed. This file is read by both agents. Its twin is a symlink.\n> Live handoff state is in ./HANDOFF.md and ./.baton/.\n`;
    writeFileSync(claude, stub); symlinkSync("CLAUDE.md", agents);
    results.push("created CLAUDE.md + AGENTS.md symlink");
  } else {
    if (isLink(agents)) results.push(`AGENTS.md already links -> ${readlinkSync(agents)}`);
    else if (isLink(claude)) results.push(`CLAUDE.md already links -> ${readlinkSync(claude)}`);
    else results.push("⚠️ both CLAUDE.md and AGENTS.md exist as real files — not merging automatically. Reconcile by hand, then delete one and re-run baton_init.");
  }
  return results;
}

// --- tools -----------------------------------------------------------------
const TOOLS = {
  baton_status: {
    description: "Check if a baton (handoff state) exists for this project and get a one-glance summary. Call this at session start.",
    inputSchema: { type: "object", properties: { project: { type: "string", description: "Project root path (default: cwd)" } } },
    handler(args) {
      const root = projectRoot(args); const s = loadState(root);
      if (!s) return text(`No baton yet for ${root}.\nStart one with baton_pass when you begin work, or baton_init to set up the shared folder.`);
      return text(`Baton for "${s.task}" — status=${s.status}, last handed off by ${s.lastAgent} at ${s.updatedAt} (pass #${s.passCount}).\nNext: ${(s.next||[]).slice(0,3).join(" | ") || "(none listed)"}\nCall baton_pick_up for the full picture.`);
    }
  },
  baton_pick_up: {
    description: "PICK UP THE BATON. Returns the full current handoff state + recent history so you continue exactly where the previous agent (or session) stopped. Call this before doing any work if a baton might exist.",
    inputSchema: { type: "object", properties: { project: { type: "string" } } },
    handler(args) {
      const root = projectRoot(args); const s = loadState(root);
      if (!s) return text(`No baton to pick up for ${root}. This is a fresh start — do the work, then baton_pass to record where you leave off.`);
      appendLedger(root, { t: nowISO(), agent: AGENT, event: "pick_up", pass: s.passCount });
      const hist = readLedger(root, 8).map(e => `  ${e.t} [${e.agent}] ${e.event}${e.note ? ": " + e.note : ""}`).join("\n");
      return text(`🏃 BATON PICKED UP by ${AGENT}.\n\n${renderHandoff(s)}\n\n---\nRecent ledger:\n${hist}`);
    }
  },
  baton_pass: {
    description: "PASS THE BATON. Record where you're stopping so the next agent/session continues seamlessly. Merges with existing state — pass only the fields you want to update. Rewrites HANDOFF.md.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        task: { type: "string", description: "Short title of the work" },
        goal: { type: "string", description: "The overall objective" },
        status: { type: "string", enum: ["in_progress", "blocked", "done"] },
        handoffNote: { type: "string", description: "CRITICAL: exactly where you stopped and why — the thing that dies with your context otherwise" },
        done: { type: "array", items: { type: "string" }, description: "Completed items (appended)" },
        next: { type: "array", items: { type: "string" }, description: "Concrete next steps (replaces)" },
        openQuestions: { type: "array", items: { type: "string" } },
        watchOut: { type: "array", items: { type: "string" }, description: "Gotchas learned (appended)" },
        files: { type: "array", items: { type: "string" }, description: "Key files as 'path — why it matters' (replaces)" }
      },
      required: ["handoffNote"]
    },
    handler(args) {
      const root = projectRoot(args);
      const prev = loadState(root) || { passCount: 0, done: [], watchOut: [] };
      const s = {
        task: args.task ?? prev.task ?? "untitled",
        goal: args.goal ?? prev.goal ?? "",
        status: args.status ?? prev.status ?? "in_progress",
        handoffNote: args.handoffNote,
        done: [...(prev.done || []), ...(args.done || [])],
        next: args.next ?? prev.next ?? [],
        openQuestions: args.openQuestions ?? prev.openQuestions ?? [],
        watchOut: [...(prev.watchOut || []), ...(args.watchOut || [])],
        files: args.files ?? prev.files ?? [],
        lastAgent: AGENT,
        updatedAt: nowISO(),
        passCount: (prev.passCount || 0) + 1
      };
      saveState(root, s);
      writeFileSync(handoffPath(root), renderHandoff(s));
      appendLedger(root, { t: s.updatedAt, agent: AGENT, event: "pass", pass: s.passCount, note: args.handoffNote });
      return text(`🏃 BATON PASSED by ${AGENT} (pass #${s.passCount}, status=${s.status}).\nHANDOFF.md + .baton/ updated. Next agent: call baton_pick_up.`);
    }
  },
  baton_log: {
    description: "Drop a lightweight progress breadcrumb into the ledger without a full baton pass. Use for mid-task milestones.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, note: { type: "string" } }, required: ["note"] },
    handler(args) {
      const root = projectRoot(args);
      appendLedger(root, { t: nowISO(), agent: AGENT, event: "log", note: args.note });
      return text(`Logged by ${AGENT}: ${args.note}`);
    }
  },
  baton_history: {
    description: "Read the recent handoff/progress ledger for this project.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, limit: { type: "number" } } },
    handler(args) {
      const root = projectRoot(args);
      const entries = readLedger(root, args.limit || 25);
      if (!entries.length) return text("Empty ledger.");
      return text(entries.map(e => `${e.t} [${e.agent}] ${e.event}${e.note ? ": " + e.note : ""}`).join("\n"));
    }
  },
  baton_init: {
    description: "Set up Baton for a project: create .baton/ and bridge CLAUDE.md <-> AGENTS.md (symlink) so both Claude Code and Codex read the same instructions.",
    inputSchema: { type: "object", properties: { project: { type: "string" } } },
    handler(args) {
      const root = projectRoot(args); ensureDir(root);
      const bridged = bridgeInstructions(root);
      appendLedger(root, { t: nowISO(), agent: AGENT, event: "init" });
      return text(`Baton initialized at ${root}\n- .baton/ ready\n- ${bridged.join("\n- ")}`);
    }
  }
};

function text(s) { return { content: [{ type: "text", text: s }] }; }

// --- JSON-RPC plumbing -----------------------------------------------------
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } });
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return; // no reply to notifications
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") {
    return reply(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === "tools/call") {
    const t = TOOLS[params?.name];
    if (!t) return replyErr(id, -32602, `Unknown tool: ${params?.name}`);
    try { return reply(id, t.handler(params.arguments || {})); }
    catch (e) { log("tool error:", e.stack || e.message); return reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true }); }
  }
  if (id !== undefined) replyErr(id, -32601, `Method not found: ${method}`);
}

// --- stdio line reader -----------------------------------------------------
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch (e) { log("bad json line:", e.message); }
  }
});
process.stdin.on("end", () => process.exit(0));
log(`baton ${SERVER_VERSION} up as agent="${AGENT}"`);
