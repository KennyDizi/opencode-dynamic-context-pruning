# lib/strategies — Compression Strategies

**3 files · 217L total · barrel** — Pluggable pruning strategies invoked from the prune pipeline.

## FILES
| File | Role |
|------|------|
| `index.ts` (2L) | Barrel re-export of deduplication and purge-errors. |
| `deduplication.ts` (127L) | Signature-based dedup. `createToolSignature()` hashes normalized tool params, groups outputs by signature, keeps latest invocation only. Skips protected tools/files. |
| `purge-errors.ts` (88L) | Turn-threshold error purging. Filters `status=error` tool outputs older than `turnThreshold` from config. Skips protected tools/files. |

## KEY PATTERNS
- Shared interface: `(messages, config, state) -> messages`.
- Both strategies guard with `isProtectedTool()` and `isProtectedFile()` before pruning.
- Invoked from `lib/messages/prune.ts`.
- Barrel `index.ts` re-exports both for clean imports.
- Dedup signature normalizes JSON params, ignoring volatile fields.

## ANTI-PATTERNS
- Don't add a strategy without wiring it into the barrel and the prune pipeline.
- Don't bypass protected tool/file checks. They're safety guards.
- Don't assume tool params are stable. Always normalize via `createToolSignature()`.
