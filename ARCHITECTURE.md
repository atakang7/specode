# Architecture

The standalone Node runner and TypeScript engine use separate implementations of the specification tree.

```text
+-----------------+  calls  +-------------------+  calls  +-----------------------+
| cli/src/cli.tsx | ------> | core/src/index.ts | -----> | core/src/llm/index.ts |
+-----------------+         +-------------------+        +-----------------------+
                                    |
                                  calls
                                    v
                            +-------------------+
                            | core/src/tree     |
                            +-------------------+
```

## Runner

`runner/run.mjs` calls Ollama over HTTP and saves live state to `specs/<id>/tree.json`, turn history to `conversation.jsonl` and snapshots to `tree.vN.json`.

## TypeScript engine

`core/src/index.ts` coordinates prompts, provider calls and tree mutations; `core/src/tree` handles node priorities and completeness.

## Browser

`web/src/main.ts` uses the TypeScript engine with a local Ollama endpoint and stores the current session in localStorage, without a server-side credential boundary.

## Completion

A tree finishes when coverage reaches 85%, no eligible incomplete nodes remain and no open questions are left.
