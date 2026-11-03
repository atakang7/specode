# Runner session files

The runner writes session data under `specs/<session-id>/` relative to the working directory.

| File | Content | Update |
| --- | --- | --- |
| `tree.json` | Current spec tree | Replaced after a completed turn |
| `tree.vN.json` | Earlier tree snapshot | Written once before turn N |
| `conversation.jsonl` | AI and user entries with target IDs and mutations | Appended per turn |
| `session.json` | Intent, model, verbosity, turn count, coverage | Replaced after a completed turn |

`tree.json` and `session.json` use temporary files followed by rename. The runner requires `tree.json`, `session.json`, and `conversation.jsonl` to resume.
