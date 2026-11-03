# Architecture

The repository has two implementations of the spec loop. `core/` is a TypeScript library shared by `cli/` and `web/`. `runner/run.mjs` keeps tree operations and prompting in one Node file so it can run without installing workspace dependencies.

A model response contains a question and optional node mutations. The tree code applies the mutations and recalculates the weighted completion score. `core` emits events for its consumers; `runner` controls terminal input and writes each completed turn to disk.

The two loops differ. The runner tracks attempts on each node and uses verbosity to control how deeply it asks follow-up questions. The core prompt treats verbosity as the amount of detail in the question. Changes to either loop need separate review because they share no runtime implementation.

The Ink CLI creates an in-memory `Engine` and writes JSON only after `/save`. The runner writes its tree, snapshots, conversation log, and metadata to `specs/`. File formats are listed in [runner session files](../reference/session-files.md).

The browser entrypoint imports `createProviderFromEnv()`, which reads Node `process.env`. Vite does not provide a server-side LLM transport here. The browser also renders a saved localStorage tree without restoring it into `Engine`, so input after reload uses a fresh engine state.
