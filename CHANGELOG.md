# Changelog

## Unreleased

- Bound Ollama and TypeScript provider requests with configurable timeouts.
- Fail visibly on invalid Ollama stream data and stop after repeated invalid responses.
- Check session IDs before resuming to keep file reads inside the session directory.
- Pin Node 22, run existing builds and add runner tests in CI.
- Correct setup instructions and describe the limits of the browser prototype.

## 0.1.0 (2026-04-12)

Initial repository with the standalone Ollama runner, TypeScript tree engine and terminal and browser interfaces.
