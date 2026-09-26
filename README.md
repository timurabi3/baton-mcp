<!-- banner -->
<p align="center">
  <img src="assets/banner.svg" alt="Baton — continues where you left off" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-a78bfa.svg?style=flat-square"></a>
  <img alt="Node >= 18" src="https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg?style=flat-square&logo=node.js&logoColor=white">
  <img alt="Dependencies: zero" src="https://img.shields.io/badge/dependencies-0-22d3ee.svg?style=flat-square">
  <img alt="Protocol: MCP" src="https://img.shields.io/badge/protocol-MCP-818cf8.svg?style=flat-square">
  <img alt="Works with Claude Code and Codex" src="https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-c4b5fd.svg?style=flat-square">
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square">
</p>

<h1 align="center">🏃 Baton</h1>
<p align="center"><b>The relay baton for your AI coding agents.</b><br>
When one agent runs out of context and stops, the next one picks up exactly where it left off — even if it's a different agent.</p>

<p align="center">
  <img width="850" alt="Baton in action" src="https://github.com/user-attachments/assets/f07193a3-701a-4698-80f4-eeb23be7ea3e">
</p>

---

Baton is a tiny, **zero-dependency** [MCP](https://modelcontextprotocol.io) server that gives your agents a shared, on-disk **handoff baton**. One `.baton/` folder per project becomes the shared brain that survives the death of any single session.

Works with **Claude Code**, **Codex**, and any MCP-capable client.

## The problem

Two agents on the same repo still can't hand off work:

- **Instructions are siloed.** Claude Code auto-reads `CLAUDE.md`; Codex auto-reads `AGENTS.md`. Point both at one folder and one of them starts blind.
- **Session state is private and lossy.** Claude stores transcripts in `~/.claude/…`, Codex in `~/.codex/…`. Neither reads the other's, and replaying a raw transcript is expensive and lossy. The *intent* — which step you're on, what you just learned, why you stopped — lives in the context window and **dies when the session ends.**

So "let Codex continue what Claude started" fails: the second agent sees the files, but not the plan.

## The fix

Baton writes the **intent to disk** in a format both sides read:

| File | What it holds |
|---|---|
| `HANDOFF.md` | Human- and agent-readable "where we stopped / what's next." |
| `.baton/baton.json` | Structured live state — done, next, open questions, gotchas, key files. |
| `.baton/ledger.jsonl` | Append-only history. Crash-resilient: breadcrumbs survive even if an agent dies mid-task. |

`baton_init` also bridges `CLAUDE.md` ⇄ `AGENTS.md` with a symlink, so both agents load the *same* instructions instead of one starting blind.

## Install

No install step — it runs straight from GitHub via `npx`:

```bash
npx -y github:timurabi3/baton-mcp
```

<details>
<summary><b>Claude Code</b></summary>

```bash
# BATON_AGENT tags this agent in every handoff
claude mcp add baton -e BATON_AGENT=claude-code -- npx -y github:timurabi3/baton-mcp
```
</details>

<details>
<summary><b>Codex</b> — <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.baton]
command = "npx"
args = ["-y", "github:timurabi3/baton-mcp"]
env = { BATON_AGENT = "codex" }
```
</details>

Then add one line to your instructions (`CLAUDE.md` / `AGENTS.md`):

> **At session start, call `baton_pick_up`. Before you stop, call `baton_pass`.**

## The relay in practice

```text
Claude Code ──(hits context limit)──▶ baton_pass { handoffNote, next, watchOut }
                                          │  writes .baton/ + HANDOFF.md
Codex       ──(fresh session)────────▶ baton_pick_up  ◀── reads it, continues
```

`BATON_AGENT` tags each pass, so the ledger reads like a relay log:

```text
14:02 [claude-code] pass: moved 25 project folders; venvs for ayra-caller/cashclaw need rebuild
14:05 [codex]       pick_up
14:31 [codex]       pass: rebuilt venvs, wired both agents
```

## Tools

| Tool | When to call it |
|---|---|
| `baton_status` | Session start — is there a baton here? |
| `baton_pick_up` | **Continue where the last agent left off.** Returns the full handoff + recent ledger. |
| `baton_pass` | Stopping — record where you left off (merges state, rewrites `HANDOFF.md`). |
| `baton_log` | Drop a mid-task progress breadcrumb. |
| `baton_history` | Read the recent ledger. |
| `baton_init` | Create `.baton/` and bridge `CLAUDE.md` ⇄ `AGENTS.md`. |

## Design notes

- **Zero dependencies.** MCP stdio is newline-delimited JSON-RPC 2.0 — implemented directly, so `npx` works offline and the whole server is auditable in a single file.
- **stdout is protocol-only**; all logs go to stderr.
- Storage is per-project (`.baton/` under the project root; override with `BATON_PROJECT`).
- The full on-disk contract lives in [`PROTOCOL.md`](PROTOCOL.md) — an open, agent-neutral convention, not something private to one vendor.

## Good to know

- The baton is **shared, plain-text state** — read and edit `.baton/` by hand any time; there's no database and no lock-in.
- An unrelated package named `baton-mcp` exists on npm. Install from GitHub as shown above.

## License

MIT © [Timur Oral](https://github.com/timurabi3)
