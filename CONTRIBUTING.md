# Contributing

Use Node 22.16.0 and check the runner separately from the TypeScript engine.

## Verify

```bash
npm install
npm run check:runner
npm test
```

`npm test` builds all three TypeScript workspaces and runs the Node test files without an Ollama model.

## Changes

- Check both runner and core when changing question flow or tree state.
- Keep `specs/` and credentials out of commits.
- Document any new environment variable in `.env.example`.
- Include verification commands and untested model behavior in the PR.
