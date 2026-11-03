# Architecture

Specode contains a standalone Node runner and a separate TypeScript engine. They share the idea of a specification tree but do not share runtime code.

## Runner

`runner/run.mjs` runs with Node 22 and calls Ollama over HTTP. It creates eight root nodes from an initial intent, orders incomplete nodes by priority, and generates a question for the next node. A model response may update a node or add children. The runner uses 8-character ID prefixes when applying these updates.

The current tree lives in `specs/<session-id>/tree.json`. Earlier versions are saved in `tree.vN.json`; `conversation.jsonl` holds the conversation and mutation records. `session.json` holds the turn count and model settings. File writes for the current tree and metadata use a temporary file followed by rename.

Coverage is the weighted share of filled nodes. A `partial` node counts as half its weight, while `complete` and `n/a` count in full. Completion also requires no eligible incomplete nodes and no open questions. The runner records an assumption after three attempts on one node.

The runner checks Ollama before creating a session. A stalled request fails after `SPECODE_HTTP_TIMEOUT_MS` milliseconds without network activity. Invalid model output is retried at most twice.

## TypeScript packages

- `core/src/tree`: node operations, completeness scoring and shared-subtree handling.
- `core/src/llm`: Anthropic, OpenAI and Ollama adapters with request timeouts.
- `core/src/prompts`: question context and JSON response parsing.
- `core/src/index.ts`: event-based engine, used by `cli/` and referenced by `web/`.

The TypeScript engine is not the code used by `runner/run.mjs`. The core adapters use provider-specific HTTP APIs. The Anthropic adapter does not currently enforce structured output through tool use, so parsing can fail.

## Interfaces

The Ink CLI starts a new in-memory engine session. The Vite browser UI is a prototype with localStorage display state. It does not implement a secure provider backend and should not be published with API credentials.

See [README.md](README.md) for exact startup and check commands.
