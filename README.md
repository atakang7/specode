# specode

Spec tree elicitation for developers turning application intent into structured requirements with language models.

```text
+------+  calls  +------+  HTTP  +-----------+
| cli  | ------> | core | -----> | providers |
+------+         +------+        +-----------+
                    ^
+------+  imports    |
| web  | ------------+
+------+

+--------+  HTTP  +--------+
| runner | ------> | Ollama |
+--------+         +--------+
```

## Quick start

From the repository root, with Ollama running at `http://localhost:11434`:

```sh
ollama pull gemma2:2b
node runner/run.mjs "a todo app"
```

## Layout

| Path | What it is |
| --- | --- |
| [`core/`](core/README.md) | Tree, prompts, model adapters |
| [`cli/`](cli/README.md) | Ink terminal interface |
| [`runner/`](runner/README.md) | Standalone Ollama program with disk sessions |
| [`web/`](web/README.md) | Vite browser interface |

## Docs

[Documentation index](docs/README.md), [architecture](docs/explanation/architecture.md), and [session file reference](docs/reference/session-files.md).

## Limits

- The standalone runner supports Ollama only.
- The browser has no working provider configuration or engine state restore path.
- The TypeScript workspaces have no automated test scripts.
