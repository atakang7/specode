# SPECODE

**A spec elicitation engine.** You describe what you want to build. SPECODE asks precisely the right questions to fill a structured spec tree. When complete, the tree contains enough information to generate the full application without further questions.

```bash
node runner/run.mjs "a task management app in TypeScript"
```

```
SPECODE  session: a1b2c3d4  coverage: 0%
────────────────────────────────────────────────────────────────────
Intent: a task management app in TypeScript

AI: target platform? [web / desktop / mobile / embedded / cli]
   (Platform must be known before features can be meaningfully specified)

You: web

AI: What tech stack? React = component-based, large ecosystem. Vue = simpler.
    Next.js = full-stack with SSR built in. Svelte = minimal runtime.

You: Next.js with Prisma and PostgreSQL
────────────────────────────────────────────────────────────────────
✓ Intent: a task management app in TypeScript
~ Platform: web
~ Tech Stack: Next.js, Prisma, PostgreSQL
○ User Roles
○ Features
○ Data Models
○ Integrations
○ Constraints
────────────────────────────────────────────────────────────────────
```

---

## What makes this different

**The tree is the spec.** Not the conversation.

The conversation is just the editing interface — its only output is mutations to the tree. When the conversation ends, the tree contains the full spec. It exists independently of any conversation and can be handed directly to a code-generation LLM.

**Gap detection, not question sequences.** The AI looks at the current tree, finds the highest-priority unknown, and asks about it. Your answer reshapes what gets asked next. There is no fixed question order. You can answer anything in any order — the engine adapts.

**Structure does the thinking.** The prompt engineering layer encodes domain expertise in the tree schema and question priorities. Small local models (qwen3.5:0.8b, llama3.2) perform well because the structure pre-reasons for them. The LLM fills slots — it doesn't design the spec.

**Shared subtree hoisting.** When the same concept (authentication, notifications, search) appears in multiple features, the engine detects it and hoists it into a shared subtree — defined once, referenced everywhere. The spec stays DRY.

**Fully stateful.** Every turn is persisted to disk. Kill the process — the tree is intact. Resume any session. Every snapshot is saved. The full mutation history is preserved.

---

## Architecture

```
specode/
├── core/               Engine — LLM-agnostic, UI-agnostic
│   └── src/
│       ├── types/      All TypeScript types (SpecTree, SpecNode, LLMProvider...)
│       ├── tree/       Tree operations: init, update, gap analysis, shared hoisting
│       ├── llm/        Provider adapters: Claude, OpenAI, Ollama
│       ├── prompts/    Prompt engineering: system prompt, context injection, verbosity
│       └── index.ts    Engine class + event emitter
│
├── cli/                Ink TUI (keyboard-driven terminal interface)
├── web/                Vanilla TS browser UI (terminal aesthetic)
└── runner/             Self-contained Node script — no build step needed
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown of the engine loop, data model, completeness scoring, and shared subtree hoisting.

---

## Quickstart

**Requirements:** Node 10+, Ollama running locally

```bash
# 1. Clone
git clone https://github.com/your-org/specode
cd specode

# 2. Start a session (no install needed for the runner)
node runner/run.mjs "a todo app in TypeScript"

# 3. Answer questions. Kill anytime — your progress is saved.
# 4. Resume where you left off
node runner/run.mjs --resume <session-id>
```

The session is saved to `specs/<session-id>/`. The live spec is always at `specs/<session-id>/tree.json`.

---

## Providers

SPECODE works with any LLM provider. Set `SPECODE_PROVIDER` in your environment:

### Ollama (local, default)

```bash
# Install a model
ollama pull qwen3.5:0.8b

# Run
SPECODE_MODEL=qwen3.5:0.8b node runner/run.mjs "your intent"
```

### Claude

```bash
SPECODE_PROVIDER=claude \
ANTHROPIC_API_KEY=sk-ant-... \
node runner/run.mjs "your intent"
```

### OpenAI

```bash
SPECODE_PROVIDER=openai \
OPENAI_API_KEY=sk-... \
node runner/run.mjs "your intent"
```

Copy `.env.example` to `.env` for persistent configuration.

---

## Session output

Every session writes to `specs/<session-id>/`:

| File | Contents |
|------|----------|
| `tree.json` | Live spec — updated atomically after every turn |
| `tree.vN.json` | Immutable snapshot before turn N |
| `conversation.jsonl` | Append-only log: every turn + tree mutations caused |
| `session.json` | Metadata: model, verbosity, turn count, coverage |

The tree is the artifact. It's a self-contained JSON document that can be used as input to code generation, documentation generation, or any other downstream tool.

---

## Verbosity

Three levels control **specification depth** — how many sub-questions are asked before a node is marked complete.

| Level | Depth | Behaviour |
|-------|-------|-----------|
| `low` | Flat | One answer per node, move on immediately. "web" = Platform complete. Fast, broad strokes. |
| `medium` | One follow-up | One clarifying question if the answer is too broad. "web" → "which framework?" → done. |
| `high` | Full drill | Keeps asking until every node is a direct code-generation instruction. "web" → framework → version → routing → deployment → env config. No assumptions. |

At every level: if the same node is asked **3 times** with no usable answer, the AI declares an explicit assumption with reasoning and moves on. Nothing is silently inferred.

Change mid-session: type `/verbosity low`

---

## Spec completeness

A spec is **complete** when every node has a value specific enough to implement without clarification.

```
COMPLETE:  "PostgreSQL 16, hosted on Railway, Prisma ORM, migrations via prisma migrate"
PARTIAL:   "PostgreSQL"

COMPLETE:  "JWT, 7-day expiry, stored in httpOnly cookies, refresh token rotation"
PARTIAL:   "JWT auth"
```

Coverage score is weighted by node kind — a missing `intent` node (weight 100) hurts more than a missing `constraint` node (weight 40). Threshold for completion: **85%** with no incomplete nodes and no open questions.

---

## Commands

| Command | Effect |
|---------|--------|
| `/verbosity low\|medium\|high` | Change verbosity mid-session |
| `/quit` | Exit (session is saved) |

Web UI only:
| `/save` | Download spec as JSON |
| `/clear` | Clear conversation view |
| `/reset` | Clear localStorage and start fresh |

---

## Development

```bash
npm install        # workspace deps
npm run build      # build core, cli, web
npm run dev:cli    # run CLI in watch mode
npm run dev:web    # run web UI dev server
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [ARCHITECTURE.md](ARCHITECTURE.md) for system design.

---

## License

MIT — see [LICENSE](LICENSE)
