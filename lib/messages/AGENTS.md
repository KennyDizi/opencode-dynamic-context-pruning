# lib/messages — Message Transform Pipeline

**8 files · 814L + inject/ (3 files · 671L)** — Per-turn message transforms. Stateless functions that mutate `messages: WithParts[]` in-place.

## FILES
| File | Role |
|------|------|
| `index.ts` | Barrel exports |
| `prune.ts` (233L) | Main prune entry. Replaces compressible parts with placeholder strings |
| `query.ts` | Classification: `isIgnorable`, `isCompressible`, `getLastUserMessage` |
| `shape.ts` | `filterMessagesInPlace` shape validation (gate before any processing) |
| `sync.ts` | `syncCompressionBlocks` populates `state.prune.messages` from conversation |
| `priority.ts` | `buildPriorityMap` ranks compression candidates |
| `utils.ts` (185L) | Tool ID listing, hallucination stripping, `createSyntheticUserMessage`, `replaceBlockIdsWithBlocked` |
| `reasoning-strip.ts` | Strip stale reasoning metadata |

## PRUNE PIPELINE ORDER (prune.ts)
1. `filterCompressedRanges` — resolve which ranges are active
2. `pruneToolOutputs` — replace with `[Output removed to save context...]`
3. `pruneToolInputs` — replace with `[input removed due to failed tool call]`
4. `pruneToolErrors` — replace with `[questions removed - see output for user's answers]`
5. `pruneFullTool` — **COMMENTED OUT, intentional, do not re-enable blindly**

## inject/ SUBDIR
| File | Role |
|------|------|
| `inject.ts` (215L) | Compress nudges + mNNNN ref injection into message stream |
| `subagent-results.ts` | Expand subagent task tool results inline |
| `utils.ts` (374L) | Shared injection utilities (anchor lookup, part insertion) |

## KEY PATTERNS
- Standard signature: `(state, logger, config, messages)` — stateless, mutates `messages`
- Pruning = placeholder string replacement inside `parts`, never array splicing
- Hallucination strip removes fake `compress` tool outputs LLM fabricated in prior turns
- `replaceBlockIdsWithBlocked` neutralizes `(bN)` placeholder refs that must not expand
- Sync runs BEFORE prune — `state.prune.messages` is the prune contract

## ANTI-PATTERNS
- DO NOT delete entries from `messages` array — placeholder replacement only
- DO NOT skip `filterMessagesInPlace` — downstream assumes validated shape
- DO NOT re-enable `pruneFullTool` call without tracing tool-result dependents
- DO NOT call prune before sync — empty `state.prune.messages` = silent no-op
- DO NOT add stateful caches here — these transforms must remain idempotent per turn
