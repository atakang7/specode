Part of [specode](../README.md).

# runner

Standalone Node program that queries Ollama and persists the spec after each answer.

## Run

From the repository root, with Ollama running:

```sh
ollama pull gemma2:2b
node runner/run.mjs "a todo app"
```

## Test

```sh
node --check runner/run.mjs
node runner/run.mjs --help
```

## Config

| Var | Default | What |
| --- | --- | --- |
| `SPECODE_MODEL` | `gemma2:2b` | Ollama model |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `SPECODE_VERBOSITY` | `medium` | Initial question depth |

## Interfaces

| Input or output | Use |
| --- | --- |
| `node runner/run.mjs "<intent>"` | New session |
| `--resume <session-id>` | Resume a saved session |
| `--help` | Print usage |
| `/verbosity low`, `medium`, `high` | Change depth |
| `/quit`, `/exit` | Save and exit |
| `POST /api/show`, `POST /api/chat` | Requests sent to Ollama |
| `specs/<session-id>/` | [Session files](../docs/reference/session-files.md) |

The runner does not read `SPECODE_PROVIDER`; it connects to Ollama.
