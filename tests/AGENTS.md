# tests — Integration Test Suite

**21 test files + 2 helpers** — Node built-in test runner suite covering compression, hooks, prompts, and state. No barrel.

## FILES
| File | Role |
|------|------|
| `compress-range.test.ts` (299L) | Range-mode compress tool: boundary resolution, placeholder injection, block allocation. |
| `compress-range-placeholders.test.ts` | Placeholder parsing and range validation. |
|| `compress-range-placeholders.test.ts` | Placeholder parsing and range validation. |
|| `compress-engine.test.ts` (675L) | compress/ engine: `withPruneTransaction` rollback, `applyCompressionState`, `parseBoundaryId`, `resolveBoundaryIds`, pipeline guards. |
|| `strategies.test.ts` | `deduplicate` + `purgeErrors` strategies: signatures, protected-tool skip, threshold behavior. |
|| `state-persistence.test.ts` (416L) | Save/load round-trip, `syncToolCache`, corrupt/missing file handling. |
|| `config.test.ts` (558L) | 3-layer merge, JSONC parsing, `validateConfigTypes`, `getInvalidConfigKeys`, `defaultConfig`. |
|| `messages-sync.test.ts` | `syncCompressionBlocks`: activate/deactivate, preserved deactivation, metadata. |
|| `inject-utils.test.ts` | `addAnchor`, `getNudgeFrequency`, `countMessagesAfterIndex`, `isContextOverLimits`. |
|| `commands.test.ts` (500L) | `/dcp context`, sweep, decompress, recompress — happy path + error + state mutation. |
| `compress-message.test.ts` (772L) | Message-mode compress tool: comprehensive message-level compression coverage. |
| `compression-groups.test.ts` | Compression grouping logic. |
| `compression-targets.test.ts` | Compression target identification. |
| `hooks-permission.test.ts` (699L) | Hook permission flows: compress permission, manual mode, subagent detection. |
| `host-permissions.test.ts` | Host permission snapshot tracking. |
| `message-ids.test.ts` | mNNNN ref assignment and tracking. |
| `message-priority.test.ts` (915L) | Compression priority map building. Largest test file. |
| `message-utils.test.ts` | Message utility functions. |
| `prompts.test.ts` | Prompt loading, rendering, custom overrides. |
| `token-counting.test.ts` | Token counting via `@anthropic-ai/tokenizer`. |
| `token-usage.test.ts` | Token usage tracking and stats. |
| `test-dcp-cache.sh` | Shell script for DCP cache testing. |

## KEY PATTERNS
- Pure Node built-ins: `node:test` runner, `node:assert/strict` assertions. No external frameworks.
- Flat `test("description", () => {...})` declarations. No `describe`/`it` nesting.
- Test helpers consolidated in `tests/helpers/index.ts` — `buildConfig`, `textPart`, `toolPart`, `repeatedWord`. Import from `"../tests/helpers/index.js"` (`.js` extension required).
- `tests/helpers/jsonc-loader-hook.mjs` — Node loader hook registered in `config.test.ts` to redirect the broken `jsonc-parser/lib/esm/main.js` specifier. Required because `jsonc-parser` ESM deep imports lack `.js` extensions.
- `XDG_DATA_HOME` and `XDG_CONFIG_HOME` set to `tmpdir()` per-process paths for isolation.
- `mkdirSync(testDataHome, { recursive: true })` at module level for test data setup.
- Direct imports from `../lib/` — use `.js` extension for all imports (ESM project).
- Integration-heavy: tests exercise real behavior, not mocks.

## ANTI-PATTERNS
- Don't add Jest, Vitest, Mocha, or any external test runner.
- Don't use `describe`/`it` blocks. Flat `test()` only.
- Don't hardcode XDG paths. Always use `tmpdir()` isolation.
- Don't share mutable state across tests. Each test gets fresh state.
- Don't skip `buildConfig()`. Always use the factory for `PluginConfig` construction.
- Don't import from `../dist/`. Tests run against source via tsx.
