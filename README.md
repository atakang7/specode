# specode

Specode uses a local Ollama model to turn application ideas into a JSON specification through follow-up questions.

```text
+----------+  input  +----------------+  HTTP  +--------+
| readline | ------> | runner/run.mjs | -----> | Ollama |
+----------+         +----------------+        +--------+
                            |
                          writes
                            v
                    +----------------------+
                    | specs/<id>/tree.json |
                    +----------------------+
```

## Run

Node 22.16.0 and Ollama are required; start `ollama serve` in another terminal if needed.

```bash
git clone https://github.com/atakang7/specode.git
cd specode
ollama pull gemma2:2b
node runner/run.mjs "a todo app in TypeScript"
```

Resume with `node runner/run.mjs --resume <session-id>`; type `/quit` to save and exit.

To load values from `.env.example`:

```bash
cp .env.example .env
node --env-file=.env runner/run.mjs "a todo app in TypeScript"
```

## Config

| Variable | Default | What |
| --- | --- | --- |
| `SPECODE_MODEL` | `gemma2:2b` | Ollama model |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama HTTP endpoint |
| `SPECODE_VERBOSITY` | `medium` | Question depth: `low`, `medium`, `high` |
| `SPECODE_HTTP_TIMEOUT_MS` | `120000` | Request inactivity timeout in milliseconds |

## CI

```text
+-----------+  triggers  +--------+  runs  +-------------+
| push / PR | ---------> | ci.yml | -----> | npm install |
+-----------+            +--------+        +-------------+
                                                |
                                              runs
                                                v
                                        +------------------+
                                        | check:runner     |
                                        +------------------+
                                                |
                                              runs
                                                v
                                          +----------+
                                          | npm test |
                                          +----------+
```

`npm test` builds the TypeScript workspaces and runs the runner, tree, engine and CLI tests.

## Limits

- The standalone runner supports Ollama only; the TypeScript adapters have separate provider settings.
- Sessions live in `specs/<session-id>/`, including `tree.json` and the conversation log.
- The browser prototype has no credential-protecting backend and is not intended for public deployment.
- Invalid model responses may stop a session; resume the saved session after fixing the issue.

[Architecture](ARCHITECTURE.md) | [Contributing](CONTRIBUTING.md) | [License](LICENSE)
