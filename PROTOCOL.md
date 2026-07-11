# The Baton Protocol v0.1

An open, agent-neutral convention for handing off in-progress work between AI coding agents (and between sessions of the same agent). Transport is MCP; the substance is a small on-disk contract any tool can read.

## Principles
1. **Intent must outlive the context window.** The moment work stops, the "why/where/next" must already be on disk.
2. **Agent-neutral.** No format is private to one vendor. Plain JSON + Markdown.
3. **Human-legible.** A person can read `HANDOFF.md` and know the state without any tool.
4. **Crash-resilient.** An append-only ledger means a mid-task crash still leaves a trail.
5. **Honest state.** Distinguish done vs next vs open-questions vs gotchas — never blur them.

## On-disk layout (per project root)
```
<root>/
  HANDOFF.md            # human/agent-readable mirror of current baton
  CLAUDE.md  ⇄ AGENTS.md# one real file, one symlink (shared instructions)
  .baton/
    baton.json          # structured current state (the live baton)
    ledger.jsonl        # append-only event history
```

## `baton.json` schema
| field | type | meaning |
|---|---|---|
| `task` | string | short title |
| `goal` | string | overall objective |
| `status` | `in_progress\|blocked\|done` | current state |
| `handoffNote` | string | **where it stopped and why** (the load-bearing field) |
| `done` | string[] | completed items (append-only across passes) |
| `next` | string[] | concrete next steps (replaced each pass) |
| `openQuestions` | string[] | decisions still pending |
| `watchOut` | string[] | gotchas learned (append-only) |
| `files` | string[] | key files as `path — why it matters` |
| `lastAgent` | string | who passed last (`BATON_AGENT`) |
| `updatedAt` | ISO 8601 | last pass time |
| `passCount` | int | number of passes (relay legs) |

## `ledger.jsonl` entry
```json
{"t":"2026-07-11T14:02:00Z","agent":"claude-code","event":"pass","pass":3,"note":"..."}
```
`event` ∈ `init | pick_up | log | pass`.

## Verbs (MCP tools)
- `baton_status` → summary or "no baton".
- `baton_pick_up` → full state + ledger tail; logs a `pick_up`. **The "continue where you left off" call.**
- `baton_pass(handoffNote, …)` → merge-update state, rewrite `HANDOFF.md`, log a `pass`.
- `baton_log(note)` → breadcrumb.
- `baton_history(limit)` → ledger tail.
- `baton_init` → create `.baton/`, bridge instruction files.

## Merge semantics
`done` and `watchOut` **append** across passes (cumulative memory). `next`, `openQuestions`, `files` **replace** (current snapshot). This keeps a growing memory of what happened while the forward-looking view stays clean.

## Conformance
A conformant client: (1) calls `baton_pick_up` (or reads `HANDOFF.md`) before acting when a baton exists; (2) calls `baton_pass` with a non-empty `handoffNote` before ending a work session; (3) tags itself via `BATON_AGENT`.
