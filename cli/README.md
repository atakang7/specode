Part of [specode](../README.md).

# cli

Ink terminal interface that runs the `core` engine.

## Run

From the repository root:

```sh
npm install
npm run build --workspace=core
npm run dev --workspace=cli -- "a todo app"
```

## Test

No test script is defined for this workspace.

## Config

| Var | Default | What |
| --- | --- | --- |
| `SPECODE_VERBOSITY` | `medium` | Initial question detail |
| Provider variables | [core config](../core/README.md#config) | Passed to `createProviderFromEnv()` |

## Interfaces

| Input or output | Use |
| --- | --- |
| First CLI argument | Application intent |
| `/verbosity low`, `medium`, `high` | Change detail during a session |
| `/save` | Write `specs/<tree-id>.json` from the current working directory |
| `/quit`, `/exit` | End the process |

The CLI saves a tree only when `/save` is entered.
