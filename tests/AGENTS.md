# tests — Integration Test Suite

**14 files** — Node built-in test runner suite covering compression, hooks, prompts, and state. No barrel.

## FILES
| File | Role |
|------|------|
| `compress-range.test.ts` (299L) | Range-mode compress tool: boundary resolution, placeholder injection, block allocation. |
| `compress-range-placeholders.test.ts` | Placeholder parsing and range validation. |
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
- `buildConfig()` factory returns a complete `PluginConfig` with sensible defaults per test.
- `XDG_DATA_HOME` and `XDG_CONFIG_HOME` set to `tmpdir()` per-process paths for isolation.
- `mkdirSync(testDataHome, { recursive: true })` at module level for test data setup.
- Direct imports from `../lib/` — no test utils directory or re-export shims.
- Integration-heavy: tests exercise real behavior, not mocks.

## ANTI-PATTERNS
- Don't add Jest, Vitest, Mocha, or any external test runner.
- Don't use `describe`/`it` blocks. Flat `test()` only.
- Don't hardcode XDG paths. Always use `tmpdir()` isolation.
- Don't share mutable state across tests. Each test gets fresh state.
- Don't skip `buildConfig()`. Always use the factory for `PluginConfig` construction.
- Don't import from `../dist/`. Tests run against source via tsx.
