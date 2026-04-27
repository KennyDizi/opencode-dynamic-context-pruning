# lib/subagents — Subagent Result Handling

**1 file · 74L total · no barrel** — Expands subagent conversation results into parent tool output for compression-aware merging.

## FILES
| File | Role |
|------|------|
| `subagent-results.ts` (74L) | Identifies subagent sessions via `getSubAgentId()`, builds result text via `buildSubagentResultText()` (last text part, or last 2 if penultimate ran compress), merges into `<task_result>` blocks via `mergeSubagentResult()`. Helpers: `getLastTextPart()` (reverse-iterates parts), `assistantMessageHasCompressTool()` (detects completed compress calls). |

## KEY PATTERNS
- No barrel, single file imported directly by `lib/messages/inject/subagent-results.ts`.
- Result expansion: fetch subagent conversation, extract relevant text, merge into parent tool output.
- Compress-aware: if the subagent itself ran compression, preserve context by including 2 messages instead of 1.
- Gated by `config.experimental.allowSubAgents`, callers check before invoking.

## ANTI-PATTERNS
- Don't fetch subagent results without the `allowSubAgents` config check.
- Don't assume only 1 text part, always use `getLastTextPart()` which reverse-iterates.
- Don't add more files here without strong justification, subagent handling is intentionally concentrated.
