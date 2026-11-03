# Check a runner change

1. Use Node 22 from [`.nvmrc`](../../.nvmrc).
2. Run the same checks as [CI](../../.github/workflows/ci.yml) from the repository root:

```sh
node --check runner/run.mjs
node runner/run.mjs --help
```

3. With Ollama running and `gemma2:2b` installed, start a session and answer a question:

```sh
node runner/run.mjs "a todo app"
```
