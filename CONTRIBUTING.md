# Contributing

Changes to the Node runner and TypeScript engine need separate checks because the runner does not import the engine.

## Setup

```bash
git clone https://github.com/atakang7/specode.git
cd specode
npm install
npm run check:runner
npm test
npm run build
```

Tests under `runner/test/` use a local HTTP server to verify failure paths without an installed model. For an interactive check, start Ollama, pull `gemma2:2b` and run `node runner/run.mjs "a todo app in TypeScript"`.

Keep changes narrow. If you change the session JSON format or question flow, check that a saved session can still be resumed. Document new environment variables in `.env.example` and user-visible behavior in the README.

Do not commit files from `specs/` or API keys. Include the commands you ran and any untested model behavior in pull requests.
