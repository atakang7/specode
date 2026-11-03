Part of [specode](../README.md).

# web

Vite browser interface that imports the `core` engine from source.

## Run

From the repository root:

```sh
npm install
npm run dev --workspace=web
```

## Test

No test script is defined for this workspace.

## Config

| Var | Default | What |
| --- | --- | --- |
| URL query `intent` | `a web application` | Initial prompt for a new page load |
| Browser storage `specode:session` | Unset | Tree and conversation snapshot |

## Interfaces

| Input or output | Use |
| --- | --- |
| Vite dev server | Port `5173` by default |
| `/verbosity low`, `medium`, `high` | Change question detail |
| `/save` | Download the current tree as JSON |
| `/clear` | Clear conversation display |
| `/reset` | Delete browser snapshot and reload |

The browser entrypoint calls a Node environment provider factory, and stored sessions are not loaded back into `Engine`. See [architecture](../docs/explanation/architecture.md).
