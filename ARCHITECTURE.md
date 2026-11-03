# SPECODE — Architecture

## The core idea

Most spec tools give you a form. SPECODE is a **spec compiler**.

You describe intent. The system asks precisely the right questions to fill a structured tree. When the tree is complete, it contains enough information that an LLM can generate the full application without asking anything further.

The key insight: **the tree is the spec, not the conversation.** The conversation is just the editing interface. It exists to fill nodes. When it's done, it's irrelevant.

---

## Data model

```
SpecTree
├── id              Session identifier
├── title           Derived from the user's intent
├── nodes[]         The spec — a recursive tree of SpecNode
├── shared[]        Shared subtrees — defined once, referenced everywhere
├── completeness    0–100 coverage score
└── verbosity       Controls how the AI communicates

SpecNode
├── id              UUID
├── label           Human-readable name ("Authentication", "User Roles")
├── kind            What type of spec atom this is (see below)
├── status          empty → partial → complete | n/a
├── value           The actual spec content — null until filled
├── children[]      Sub-specs implied by this node
├── dependsOn[]     IDs of nodes that must be at least partial before this is asked
├── sharedRef       If set, this node is a pointer to a shared subtree
└── openQuestions[] Ambiguities remaining even after a value is set
```

**Node kinds:**
| Kind | What it represents |
|------|--------------------|
| `intent` | What the application does — the highest-level purpose |
| `platform` | Deployment target: web, desktop, mobile, embedded, CLI |
| `user-role` | A type of user who interacts with the system |
| `feature` | A discrete capability the app provides |
| `data-model` | A data entity or schema |
| `integration` | External service, API, or third-party dependency |
| `constraint` | Non-functional requirement: performance, security, compliance |
| `tech-stack` | Language, framework, runtime choices |
| `flow` | A sequence of interactions or operations |
| `shared` | A pattern hoisted from multiple feature subtrees |

---

## The engine loop

```
User intent
    │
    ▼
initTree()
  Creates the top-level skeleton with dependency relationships.
  Features depend on Intent + Platform. Data models depend on Features.
    │
    ▼
analyzeGaps()
  Finds the highest-priority incomplete node whose dependencies are met.
  Priority is determined by KIND_PRIORITY weights (intent=100, constraint=40).
  Ambiguous nodes (complete but with openQuestions) re-enter the queue.
    │
    ▼
buildMessages()
  Injects the full tree state + conversation history into the prompt.
  The LLM sees: every node's ID, label, kind, status, value, open questions.
  The system prompt encodes the output contract as a strict JSON schema.
    │
    ▼
LLMProvider.complete() / ollamaStream()
  Provider-agnostic call. Structured output enforced at the grammar level
  (Ollama format:schema, OpenAI response_format:json_schema).
    │
    ▼
parseLLMResponse()
  Validates the JSON. Hard throws on invalid responses — never silently
  degrades. The caller retries the turn rather than corrupting tree state.
    │
    ▼
applyMutations()
  Updates nodes, adds children, hoists shared patterns.
  Every mutation is recorded in conversation.jsonl.
    │
    ▼
hoistSharedSubtrees()
  Scans feature subtrees for repeated concepts. Moves them to tree.shared.
  Replaces duplicates with sharedRef pointers (defined once, used many).
    │
    ▼
Persist to disk (runner) / localStorage (web)
  tree.json       — live spec, always current
  tree.vN.json    — immutable snapshot before each turn
  conversation.jsonl — append-only mutation log
  session.json    — metadata
    │
    └─ repeat until completeness ≥ 85% and no openQuestions remain
```

---

## Completeness scoring

Each node is weighted by its `KIND_PRIORITY`. A missing `intent` node (weight 100) hurts far more than a missing `constraint` node (weight 40).

```
score = Σ(filled_weight) / Σ(total_weight) × 100

where:
  complete → full weight
  partial  → 0.5 × weight
  n/a      → full weight (intentionally skipped = counts as resolved)
  empty    → 0
```

Threshold for "complete": **85%** with zero incomplete nodes and zero open questions.

A complete tree is **directly compilable** — hand it to any code-generation LLM with no additional context.

---

## Shared subtree hoisting

When the same concept appears as a child of multiple feature nodes (e.g. "Authentication" under both "User Login" and "API Access"), the engine:

1. Creates a single `SpecNode` in `tree.shared` with `kind: "shared"`
2. Replaces all duplicate children with lightweight reference nodes (`sharedRef: <shared-node-id>`)
3. The shared node gets filled once and the reference is considered complete

This prevents the spec from asking about authentication multiple times and ensures the definition stays consistent across all features that depend on it.

---

## LLM provider abstraction

The engine calls one interface:

```typescript
interface LLMProvider {
  name: string;
  complete(messages: LLMMessage[]): Promise<LLMResponse>;
}
```

Structured output is enforced at the API level per provider:
- **Ollama**: `format: <json-schema>` — grammar-constrained generation
- **OpenAI**: `response_format: { type: "json_schema" }`
- **Claude**: tool-use with schema (planned)

The runner uses Ollama's streaming API (`stream: true`) so tokens appear live as the model generates them. The parsed structured response is extracted from the accumulated stream.

---

## Persistence model (runner)

Everything is written to disk after every turn. Nothing is transient.

```
specs/<session-id>/
  tree.json          Live spec — rewritten atomically after each turn
  tree.v0.json       Snapshot before turn 0 (immutable, never overwritten)
  tree.v1.json       Snapshot before turn 1
  ...
  conversation.jsonl Append-only log — one JSON line per turn
  session.json       Metadata — turn count, model, verbosity, coverage
```

Writes use atomic rename (`write tmp → rename`) to prevent partial writes from corrupting state. If the process is killed between turns, the last completed turn's state is intact.

**Resume**: `node runner/run.mjs --resume <session-id>` reconstructs full conversation history from `conversation.jsonl` and resumes from the last tree state.

---

## Verbosity levels

The verbosity level affects only how the AI communicates — not what it asks or what it stores.

| Level | Style | Use when |
|-------|-------|----------|
| `low` | Keywords + bracket choices | Expert users, fast iteration |
| `medium` | Brief explanation per option | Default — most users |
| `high` | Full context, tradeoffs, downstream impact | New domain, need to understand implications |

Change mid-session: `/verbosity low`

---

## Adding a new LLM provider

1. Implement `LLMProvider` in [core/src/llm/index.ts](core/src/llm/index.ts)
2. Add it to `createProviderFromEnv()`
3. Ensure structured output is enforced (JSON schema at the API level)
4. The engine, prompts, and UIs need no changes

---

## Where to contribute

**Highest leverage:**

1. [core/src/prompts/index.ts](core/src/prompts/index.ts) — The system prompt and output contract. Better prompts = better questions = better specs. This is the most important file.

2. [core/src/tree/index.ts](core/src/tree/index.ts) — The `KIND_PRIORITY` weights and `SHARED_PATTERNS` list encode domain expertise. Adding more patterns improves hoisting quality.

3. New node kinds — The current set covers most applications. Domain-specific kinds (e.g. `ml-model`, `embedded-protocol`, `game-mechanic`) would make the system more useful for specialized domains.

4. New LLM providers — Any provider that supports structured JSON output can be added in ~30 lines.
