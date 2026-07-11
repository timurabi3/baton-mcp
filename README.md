# 🏃 Baton

**Continues where you left off.**

Baton is a tiny, zero-dependency [MCP](https://modelcontextprotocol.io) server that gives your AI coding agents a **shared relay baton**. When one agent (or one session) runs out of context and stops, the next one — even a *different* agent — picks up exactly where the last left off.

Works with **Claude Code**, **Codex**, and any MCP-capable client. One `.baton/` folder per project is the shared brain.

---

## The problem

Two agents on the same repo still can't hand off work:

- **Instructions are siloed.** Claude Code auto-reads `CLAUDE.md`; Codex auto-reads `AGENTS.md`. Point both at one folder and one of them starts blind.
- **Session state is private and lossy.** Claude stores transcripts in `~/.claude/…`, Codex in `~/.codex/…`. Neither reads the other's, and replaying a raw transcript is expensive and lossy. The *intent* — which step you're on, what you just learned, why you stopped — lives in the context window and **dies when the session ends.**

So "let Codex continue what Claude started" fails: the second agent sees the files but not the plan.

## The fix

Baton writes the **intent to disk** in an agent-neutral format both sides read:

- `HANDOFF.md` — human- and agent-readable "where we stopped / what's next."
- `.baton/baton.json` — structured live state (done, next, open questions, gotchas, key files).
- `.baton/ledger.jsonl` — append-only history (crash-resilient: breadcrumbs survive even if an agent dies mid-task).
- `baton_init` bridges `CLAUDE.md` ↔ `AGENTS.md` with a symlink so both agents load the same instructions.

## Install

```bash
# no install needed — runs via npx
npx baton-mcp
```

### Claude Code
```bash
claude mcp add baton -- npx -y baton-mcp
# identify this agent in handoffs:
claude mcp add baton -e BATON_AGENT=claude-code -- npx -y baton-mcp
```

### Codex — `~/.codex/config.toml`
```toml
[mcp_servers.baton]
command = "npx"
args = ["-y", "baton-mcp"]
env = { BATON_AGENT = "codex" }
```

Then add one line to your instructions (`CLAUDE.md` / `AGENTS.md`):
> **At session start, call `baton_pick_up`. Before you stop, call `baton_pass`.**

## Tools

| Tool | When |
|---|---|
| `baton_status` | Session start — is there a baton here? |
| `baton_pick_up` | **Continue where the last agent left off.** Returns full handoff + recent ledger. |
| `baton_pass` | Stopping — record where you left off (merges; rewrites `HANDOFF.md`). |
| `baton_log` | Mid-task progress breadcrumb. |
| `baton_history` | Read the recent ledger. |
| `baton_init` | Create `.baton/` + bridge `CLAUDE.md` ↔ `AGENTS.md`. |

## The relay in practice

```
Claude Code  ──(hits context limit)──►  baton_pass { handoffNote, next, watchOut }
                                              │  writes .baton/ + HANDOFF.md
Codex        ──(fresh session)────────►  baton_pick_up  ◄── reads it, continues
```

`BATON_AGENT` env tags each pass, so the ledger reads like a relay log:
```
14:02 [claude-code] pass: moved 25 project folders; venvs for ayra-caller/cashclaw need rebuild
14:05 [codex]       pick_up
14:31 [codex]       pass: rebuilt venvs, wired both agents
```

## Design notes

- **Zero dependencies.** MCP stdio is newline-delimited JSON-RPC 2.0 — implemented directly, so `npx` works offline and the whole thing is auditable in one file.
- **stdout is protocol-only**; all logs go to stderr.
- Storage is per-project (`.baton/` under the project root, override with `BATON_PROJECT`).

## License
MIT © Timur Oral
