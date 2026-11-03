# Changelog

All notable changes to SPECODE are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

---

## [0.1.0] — 2026-04-12

Initial release.

### Core engine
- Spec tree data model with 10 node kinds: `intent`, `platform`, `user-role`, `tech-stack`, `feature`, `flow`, `data-model`, `integration`, `constraint`, `shared`
- Stateful gap detection — non-sequential conversation driven by node priority weights, not fixed question order
- Dependency-aware gap analysis — never asks about a node whose dependencies are empty
- Shared subtree hoisting — detects duplicate concepts across feature subtrees and promotes them to `tree.shared` with reference pointers
- Circular dependency detection with DFS cycle check
- Weighted completeness scoring (0–100) by node kind priority
- Ambiguous node re-queuing — complete nodes with `openQuestions` re-enter the question queue

### LLM providers
- Anthropic Claude adapter (claude-sonnet-4-6 default)
- OpenAI adapter (gpt-4o default, JSON mode enforced)
- Ollama adapter (qwen3.5:0.8b default, schema-constrained structured output)
- Provider-agnostic factory via `SPECODE_PROVIDER` environment variable

### Prompt engineering
- Structured output enforced at grammar level — no prompt-level JSON requests, actual schema constraints
- `/no_think` directive disables chain-of-thought in qwen3 models for faster responses
- Three verbosity levels: `low` (keywords), `medium` (brief context), `high` (full detail)
- Strict output contract validation — hard throws on invalid JSON, retries at call site

### Runner (CLI)
- Self-contained — no build step, runs directly with Node 18+
- Live token streaming — model output appears in terminal as it generates
- Full session persistence to `specs/<session-id>/`
  - `tree.json` — live spec, atomically rewritten after every turn
  - `tree.vN.json` — immutable snapshots before each turn
  - `conversation.jsonl` — append-only mutation log with full context
  - `session.json` — metadata with cross-validation on resume
- Session resume: `node runner/run.mjs --resume <session-id>`
- Ollama health check before session starts
- Atomic file writes via tmp→rename to prevent corruption on crash
- Conversation history integrity check on resume

### Web UI
- Vanilla TypeScript + Vite (zero framework overhead)
- Terminal-aesthetic — monospace, dark, functional colors, no decoration
- Split layout: spec tree panel + conversation panel
- localStorage persistence — sessions survive page reloads
- `/save` — exports spec as downloadable JSON
- XSS-safe innerHTML rendering throughout
- Double-submit race condition prevention

### CLI (TUI)
- Ink-based React terminal UI
- Split layout: tree panel | conversation panel | status bar | input
- Live tree updates with status icons (✓ ~ ○ -)
- Verbosity switching mid-session
