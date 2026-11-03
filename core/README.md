Part of [specode](../README.md).

# core

TypeScript tree engine and model adapters used by the Ink CLI and browser entrypoint.

## Run

From the repository root:

```sh
npm install
npm run build --workspace=core
```

## Test

No test script is defined for this workspace.

## Config

| Var | Default | What |
| --- | --- | --- |
| `SPECODE_PROVIDER` | `claude` | Selects `claude`, `openai`, or `ollama` |
| `SPECODE_MODEL` | Provider default | Model name override |
| `ANTHROPIC_API_KEY` | Unset | Required for Claude |
| `OPENAI_API_KEY` | Unset | Required for OpenAI |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API URL |

Provider defaults: `claude-sonnet-4-6`, `gpt-4o`, and `qwen3.5:0.8b`.

## Interfaces

| Interface | Use |
| --- | --- |
| `Engine.start(intent)` | Initialize a tree and request the first question |
| `Engine.answer(text)` | Submit an answer to the current session |
| `Engine.setVerbosity(level)` | Set `low`, `medium`, or `high` |
| `tree:updated`, `question:ready` | UI events |
| `spec:complete`, `error` | Completion and failure events |
| `createProviderFromEnv()` | Create the selected LLM adapter |

Tree fields are in [tree reference](../docs/reference/tree.md).
