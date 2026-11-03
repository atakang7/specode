# Resume a runner session

1. Find the ID in the terminal output or `specs/` directory.
2. Read `specs/<session-id>/session.json` to find the saved model.
3. Start Ollama with that model available.
4. From the repository root, run:

```sh
node runner/run.mjs --resume <session-id>
```

The runner checks Ollama before it reads the saved session. See [session files](../reference/session-files.md) for the required files.
