# Specode

Specode asks questions about an application and saves the answers as a JSON specification tree. The standalone runner talks to a local Ollama model and keeps each session on disk.

## Quick start

Use Node 22.16.0 and a running Ollama service. No npm install is needed for the runner.

```bash
git clone https://github.com/atakang7/specode.git
cd specode
ollama pull gemma2:2b
node runner/run.mjs "a todo app in TypeScript"
```

Start Ollama separately if it is not running (`ollama serve`). A session ID appears in the terminal header.

```bash
node runner/run.mjs --resume <session-id>
```

Type `/verbosity low`, `/verbosity medium` or `/verbosity high` to change how far the model follows up on a topic. Type `/quit` to stop.

## Configuration

The runner reads environment variables. To use the included example on Node 22:

```bash
cp .env.example .env
node --env-file=.env runner/run.mjs "a todo app in TypeScript"
```

| Variable | Default | Used by |
| --- | --- | --- |
| `SPECODE_MODEL` | `gemma2:2b` | Runner |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Runner and core Ollama adapter |
| `SPECODE_VERBOSITY` | `medium` | Runner and Ink CLI |
| `SPECODE_HTTP_TIMEOUT_MS` | `120000` | Runner and core adapters |

The standalone runner only supports Ollama. `SPECODE_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_URL` and `OPENAI_API_URL` belong to the separate TypeScript provider adapters. If you use those adapters, set a model suited to that provider. A `.env` file is not loaded unless you pass `--env-file` or export its values yourself.

## How it works

The runner starts with eight top-level nodes, including platform and features. It selects an incomplete node, asks a question and applies the next model response to the tree. It marks unanswered nodes with an explicit assumption after three attempts. Coverage is weighted by node type.

Session files are written to `specs/<session-id>/`: `tree.json` is the current specification, `tree.vN.json` stores snapshots, `conversation.jsonl` records turns, and `session.json` holds metadata. The `specs/` directory is ignored by Git.

## Development and usage

```bash
npm install
npm run check:runner
npm test
npm run build
```

For browser development, copy `web/.env.example` to `web/.env` and run `npm run dev:web`. The browser UI connects to local Ollama; it has no hosted-provider credential flow.

`core/` contains the TypeScript tree engine and provider adapters. `cli/` contains an Ink interface, while `web/` contains a Vite browser prototype. The runner uses its own tree and Ollama code, so changes to `core/` do not automatically change runner behavior. See [ARCHITECTURE.md](ARCHITECTURE.md) for the differences.

Use `specs/<session-id>/tree.json` as input to another tool. Specode has no hosted service or deployment command. Run the CLI locally; the browser prototype is not suitable for public deployment with API credentials.

## Limitations

- A local Ollama service and downloaded model are needed for the runner.
- Model output can be invalid. The runner stops after three failed parse attempts and leaves the saved session available to resume.
- The TypeScript engine, Ink CLI and browser prototype are separate from the runner. Their session behavior and provider support differ.
- The browser prototype has no backend for protecting provider API keys; do not place keys in client-side builds.

MIT license. See [LICENSE](LICENSE).
