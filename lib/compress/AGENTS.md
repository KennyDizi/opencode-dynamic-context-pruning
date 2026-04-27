# lib/compress — Core Compression Engine

**11 files · 1859 lines** — Core compression engine. Two modes share pipeline scaffolding.

## FILES

| File                  | Role                                                                |
| --------------------- | ------------------------------------------------------------------- |
| index.ts              | Barrel: createCompressRangeTool, createCompressMessageTool          |
| types.ts              | All shared types (ToolContext, entries, boundaries, resolutions)    |
| range.ts              | Range-mode tool: contiguous span compression                        |
| message.ts            | Message-mode tool: per-message compression                          |
| pipeline.ts           | prepareSession + finalize (shared scaffolding for both modes)       |
| search.ts             | Boundary ID resolution (mNNNN/bN → actual messages)                 |
| state.ts              | allocateBlockId, allocateRunId, applyCompression (mutates state)    |
| timing.ts             | Compression timing tracking (start/complete events)                 |
| protected-content.ts  | Appends protected tool outputs to summaries                         |
| range-utils.ts        | Range validation, placeholder parsing, block injection into text    |
| message-utils.ts      | Message-mode validation + entry resolution                          |

## COMPRESSION FLOW

1. Tool invoked → `pipeline.prepareSession(ctx)` validates session/permissions
2. `range.ts` or `message.ts` parses entries (CompressRangeEntry / CompressMessageEntry)
3. `search.ts` resolves each `startId`/`endId` → SelectionResolution
4. `range-utils.ts` / `message-utils.ts` build ResolvedRange/MessageCompression
5. `state.allocateRunId` + `allocateBlockId` per entry, then `applyCompression(CompressionStateInput)` → AppliedCompressionResult
6. `protected-content.ts` re-attaches protected tool outputs to summary
7. `pipeline.finalize` returns notification payload, updates timing

## KEY TYPES (non-obvious)

- **BoundaryReference** — `{ kind: "message" | "block", id }`, parsed from raw mNNNN/bN strings
- **SearchContext** — index built once per tool call (messageId→message, blockId→block) for O(1) boundary lookups
- **SelectionResolution** — resolved boundary pair + included messages + nested blocks consumed
- **CompressionStateInput** — payload to `applyCompression`: entries + run metadata + effective message IDs
- **AppliedCompressionResult** — newly created blocks + deactivated blocks + updated prune state
- **ParsedBlockPlaceholder** — `(bN)` token parsed out of text during range injection

## GUARD CONDITIONS (checked in pipeline.ts)

- `config.compress.permission === "deny"` → abort
- `state.isSubAgent && !config.experimental.allowSubAgents` → abort
- `state.manualMode === "active"` and not triggered via `/dcp compress` → abort
- Entry's resolved blockIds intersect any `consumedBlockIds` → skip entry (cannot re-compress)
- Missing/unknown boundary ID → skip entry, push issue (never throw)

## WHERE TO LOOK

| Task                                  | File                 |
| ------------------------------------- | -------------------- |
| Add boundary kind / resolution rule   | search.ts            |
| Change block allocation / state apply | state.ts             |
| Add protected-output preservation     | protected-content.ts |
| Tweak `(bN)` placeholder handling     | range-utils.ts       |
| Add guard / permission check          | pipeline.ts          |
| Add new entry field                   | types.ts + utils     |
| Wire timing instrumentation           | timing.ts            |

## ANTI-PATTERNS

- NEVER re-compress a block whose ID appears in `consumedBlockIds`
- NEVER create a block without `allocateBlockId` + `allocateRunId` (breaks bN refs)
- Boundary resolution errors → skip entry + log issue, NEVER throw (would kill the whole tool call)
- NEVER mutate `SessionState.prune` outside `state.applyCompression`
- NEVER reference compressed spans as `mNNNN` in summaries; always `(bN)`
- Both modes MUST go through `pipeline.prepareSession` / `pipeline.finalize` (don't shortcut)
