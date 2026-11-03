# Spec tree

`core/src/types/index.ts` defines `SpecTree` and `SpecNode`. The standalone runner also constructs these objects.

## Tree fields

| Field | Type | Use |
| --- | --- | --- |
| `id` | string | Session UUID |
| `title` | string | Short form of initial intent |
| `nodes` | `SpecNode[]` | Root dimensions of the spec |
| `shared` | `SpecNode[]` | Reused subtrees |
| `completeness` | number | Weighted score from 0 to 100 |
| `verbosity` | `low / medium / high` | Question detail setting |
| `createdAt`, `updatedAt` | ISO strings | Tree timestamps |

## Node fields

| Field | Type | Use |
| --- | --- | --- |
| `id` | string | Node UUID |
| `label`, `kind` | string | Name and domain category |
| `status` | string | `empty`, `partial`, `complete`, or `n/a` |
| `value` | string or null | Captured requirement |
| `children` | `SpecNode[]` | Nested requirements |
| `dependsOn` | string[] | Node IDs needed before the question |
| `sharedRef` | string, optional | Referenced shared node |
| `openQuestions` | string[] | Unresolved details |
| `updatedAt` | ISO string | Node update time |

## Scoring

| Status | Weight credited |
| --- | --- |
| `empty` | 0% |
| `partial` | 50% |
| `complete`, `n/a` | 100% |

The score uses `KIND_PRIORITY` weights from `core/src/tree/index.ts`. Gap analysis reports completion at 85% or more with no eligible incomplete nodes or open questions.
