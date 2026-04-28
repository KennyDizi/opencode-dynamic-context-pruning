# lib/state — Session State

**6 files · ~1000L** — Single mutable instance per session. Core hub: imported by 50+ files.

## FILES
| File | Role |
|------|------|
| `index.ts` | Barrel: `export *` from persistence, types, state, tool-cache |
| `types.ts` (111L) | All types: WithParts, ToolStatus, ToolParameterEntry, SessionStats, PrunedMessageEntry, CompressionMode, CompressionBlock, PruneMessagesState, Prune, PendingManualTrigger, MessageIdState, Nudges, SessionState |
| `state.ts` (188L) | `createSessionState()` factory. Reads manualMode config, awaits `isSubAgentSession()` |
| `persistence.ts` (256L) | Disk save/load under XDG_DATA_HOME. Map/Set ↔ array conversion |
| `tool-cache.ts` | `syncToolCache()` rebuilds `state.toolParameters` from messages; `resolveToolParameters()` reads cache |
| `utils.ts` (345L) | Block lookups, token stats, compaction detection (see WHERE TO LOOK) |

## PRUNE STATE STRUCTURE
`PruneMessagesState` has 5 lookup structures, each serving a distinct access pattern:

| Field | Type | Purpose |
|-------|------|---------|
| `byMessageId` | `Map<string, PrunedMessageEntry>` | mNNNN ref → pruned entry (covered messages) |
| `blocksById` | `Map<number, CompressionBlock>` | bN → full block record (active + inactive) |
| `activeBlockIds` | `Set<number>` | Currently-applied blocks only (for fast "is active" check) |
| `activeByAnchorMessageId` | `Map<string, number>` | Anchor message → block placeholder lives there |
| `nextBlockId` / `nextRunId` | counters | Allocated via `allocateBlockId` / `allocateRunId` |

All five must stay in sync. Mutations go through `compress/state.ts` helpers, never direct.

## KEY DISTINCTIONS
- **`includedBlockIds` vs `consumedBlockIds`** on `CompressionBlock`:
  - `includedBlockIds` — prior blocks whose summaries got nested into THIS block's summary text (LLM saw and merged them)
  - `consumedBlockIds` — prior blocks whose message ranges are now covered/superseded by this block's range (deactivation list)
  - A block can include without consuming, or consume without including. Don't conflate.
- **`manualMode`** is `false | "active" | "compress-pending"`, not boolean. `"compress-pending"` means user fired `/dcp compress` and next turn should trigger.
- **`lastCompaction`** tracks OpenCode's native compaction sequence. Used to detect external compactions and reset state, not DCP's own work.
- **`toolIdList`** is ephemeral, rebuilt every turn by `buildToolIdList()` in `lib/messages`. Don't persist.
- **`subAgentResultCache`** — caches task/skill tool outputs for later subagent expansion (`messages/inject/subagent-results.ts`).

## PERSISTENCE
- Path: `${XDG_DATA_HOME}/opencode-dcp/sessions/<sessionId>.json`
- Maps serialize as `[...map.entries()]`, restored via `new Map(entries)`
- Sets serialize as `[...set]`, restored via `new Set(arr)`
- Save: triggered after each successful compress run + on session checkpoint
- Load: `checkSession` hook restores state when sessionId reappears
- `isSubAgent` is recomputed on load (async via `isSubAgentSession()`), not trusted from disk

## WHERE TO LOOK
| Task | File |
|------|------|
| Add a new SessionState field | `types.ts` + initialize in `state.ts` + persist in `persistence.ts` |
| Block lookup by id / anchor | `utils.ts` → `findBlockById`, `findBlockByAnchorMessageId` |
| Active block enumeration | `utils.ts` → `getActiveCompressionBlocks`, `getActiveBlocksWithStats` |
| Token math for a message | `utils.ts` → `getEffectiveTokenCountForMessage` |
| Did OpenCode compact? | `utils.ts` → `isMessageCompacted` |
| Tool param cache miss | `tool-cache.ts` → `syncToolCache` ordering |
| Subagent detection wrong | `state.ts` → `isSubAgentSession()` call site |

## ANTI-PATTERNS
- Mutating `blocksById` / `activeBlockIds` / `activeByAnchorMessageId` independently — use `compress/state.ts` helpers, all five structures must update atomically
- Persisting `toolIdList` — it's per-turn ephemeral
- Treating `manualMode` as boolean — it's a tri-state string union
- Calling `createSessionState()` synchronously — it awaits subagent detection
- Forgetting Map/Set conversion when adding persisted fields — JSON drops them silently
