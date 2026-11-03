# Contributing to SPECODE

SPECODE is an open source project. Contributions are welcome.

Before contributing, read [ARCHITECTURE.md](ARCHITECTURE.md) to understand the system design. The most important principle: **the tree is the spec, the conversation is just the editing interface.** Any contribution that blurs this distinction needs to be reconsidered.

---

## What makes a good contribution

SPECODE is about principled prompt engineering and making structure do the thinking so small models perform well. A good contribution:

- Makes the spec more complete (closer to "directly compilable")
- Makes the AI ask better questions (more precise, better prioritized)
- Makes the system work better with smaller/local models
- Improves persistence, resilience, or resumability
- Adds support for a new LLM provider

A bad contribution:
- Adds chatbot-style behavior to the conversation layer
- Adds sequential question flows (the whole point is non-sequential gap detection)
- Makes the tree depend on the conversation to be meaningful
- Adds complexity without clear benefit to spec quality

---

## Setup

```bash
git clone https://github.com/your-org/specode
cd specode
npm install          # installs workspace deps for core, cli, web
cp .env.example .env # configure your LLM provider
```

Run the runner (no build step):

```bash
node runner/run.mjs "a todo app in TypeScript"
```

Build the TypeScript packages:

```bash
npm run build        # builds core, cli, web
```

---

## Project structure

```
core/     Engine — types, tree operations, prompts, LLM adapters
cli/      Ink-based TUI
web/      Vanilla TS browser UI
runner/   Self-contained Node script (no build needed)
specs/    Generated session output (gitignored)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a full breakdown.

---

## Key files

| File | What it does | Impact of changes |
|------|-------------|-------------------|
| `core/src/prompts/index.ts` | System prompt, output contract, verbosity | Highest — affects every question asked |
| `core/src/tree/index.ts` | Gap analysis, hoisting, scoring | High — affects spec structure and completeness |
| `core/src/types/index.ts` | All type definitions | Medium — breaking changes require updates everywhere |
| `runner/run.mjs` | CLI runner, persistence, streaming | Medium — affects user experience |

---

## Adding a new LLM provider

1. Open [core/src/llm/index.ts](core/src/llm/index.ts)
2. Implement the `LLMProvider` interface:

```typescript
export class MyProvider implements LLMProvider {
  name = "myprovider";

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    // Call your API with structured output enforced (JSON schema)
    // Return { content: string } where content is valid JSON
    // matching the ParsedLLMResponse shape
  }
}
```

3. Add it to the `createProviderFromEnv()` factory
4. Document the required environment variables in `.env.example`

**Important:** Structured output must be enforced at the API level — not just asked for in the prompt. Grammar-constrained generation (like Ollama's `format` parameter or OpenAI's `response_format`) is required. This guarantees `JSON.parse()` never fails.

---

## Improving the prompt layer

The system prompt in `buildSystemPrompt()` is the most important piece of the project. When modifying it:

- The output contract (JSON shape) must stay consistent with `ParsedLLMResponse`
- The completeness rules ("complete = specific enough to implement") must stay precise
- Verbosity instructions affect UX significantly — test all three levels
- `/no_think` at the start disables chain-of-thought in qwen3 models — keep this for speed

Test prompt changes with a small model (qwen3.5:0.8b) first. If a small model can produce correct structured output, the prompt is good.

---

## Pull request guidelines

- Keep PRs focused — one change per PR
- Include a test session in `specs/` showing the change in action (add it to the PR description, not the repo)
- Update [ARCHITECTURE.md](ARCHITECTURE.md) if you change the data model or engine loop
- Update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]`

---

## Reporting issues

Please include:
- The session ID (from `specs/<session-id>/`) if the issue occurred during a session
- The `session.json` and relevant `tree.vN.json` snapshots
- The model and provider being used
- What you expected vs. what happened

The session artifacts make it possible to reproduce spec-quality issues exactly.

---

## Code style

- TypeScript everywhere in `core/`, `cli/`, `web/`
- Plain ES modules (`.mjs`) in `runner/`
- No unnecessary abstractions — if something is used once, write it inline
- Comments explain *why*, not *what* — the code explains what
- Every public function in `core/` should have a JSDoc comment explaining its role in the system
