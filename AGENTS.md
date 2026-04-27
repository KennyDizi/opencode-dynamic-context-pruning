# AGENTS.md — opencode-dynamic-context-pruning

> AI agent knowledge base for `@tarquinen/opencode-dcp` v3.1.10

## Project Overview

OpenCode plugin that optimizes token usage by pruning obsolete tool outputs from conversation context. It intercepts chat message transforms, identifies compressible spans, and replaces them with concise summaries — preserving intent while reducing token cost.

**Stack**: TypeScript, ESM (`"type": "module"`), tsup build, Node test runner, Prettier-only formatting.
**License**: AGPL-3.0-or-later
**Repository**: https://github.com/Tarquinen/opencode-dynamic-context-pruning

## Build & Run Commands

```bash
npm run build          # rm -rf dist && tsup && tsc --emitDeclarationOnly
npm run typecheck      # tsc --noEmit
npm run test           # node --import tsx --test tests/*.test.ts
npm run format:check   # prettier --check .
npm run format         # prettier --write .
npm run dev            # opencode plugin dev
npm run check:package  # build + verify package contents
```

## Code Style

**Prettier config** (no ESLint):

- No semicolons
- Double quotes
- 4-space indentation (spaces, not tabs)
- Trailing commas everywhere (`"all"`)
- Print width: 100
- Arrow parens: always
- Bracket spacing: true

**TypeScript**: strict mode, ES2022 target, ESNext modules, bundler resolution.

## Architecture

### Entry Point

`index.ts` — Exports a single `Plugin` function (`server`). On init:

1. Loads config via `getConfig(ctx)` — returns early if `!config.enabled`
2. Creates `Logger`, `SessionState`, `PromptStore`
3. Configures client auth if secure mode detected
4. Registers hooks: system prompt transform, chat message transform, command execute, text complete, event handler
5. Registers `compress` tool (range or message mode based on config)
6. Configures OpenCode: registers `/dcp` command, sets tool permissions

### Module Map

```
index.ts                          → Plugin entry, hook registration
lib/
├── config.ts                     → Config loading, 3-layer merge (global→custom→project), Zod validation
├── hooks.ts                      → Hook factories for all Plugin lifecycle hooks
├── auth.ts                       → Client auth for secure mode
├── logger.ts                     → Logging (debug mode via config)
├── message-ids.ts                → Assigns stable refs (mNNNN) to messages
├── token-utils.ts                → Token counting (@anthropic-ai/tokenizer)
├── compress-permission.ts        → Compress tool permission logic
├── host-permissions.ts           → Permission snapshot tracking
├── protected-patterns.ts         → Glob matching for protected files/tools
│
├── compress/                     → Core compression engine
│   ├── index.ts                  → Barrel: exports createCompressMessageTool, createCompressRangeTool
│   ├── types.ts                  → ToolContext, CompressRangeEntry, CompressMessageEntry, boundary types
│   ├── range.ts                  → Range-mode compress tool (contiguous spans)
│   ├── message.ts                → Message-mode compress tool (individual messages)
│   ├── pipeline.ts               → Session prep, finalization, notification flow
│   ├── search.ts                 → Boundary resolution, message/tool ID lookup
│   ├── state.ts                  → Block allocation, compression state application
│   ├── timing.ts                 → Compression timing tracking
│   ├── protected-content.ts      → Protected tool output appending
│   ├── range-utils.ts            → Range validation, placeholder parsing, block injection
│   └── message-utils.ts          → Message-mode utilities
│
├── messages/                     → Message transform pipeline
│   ├── index.ts                  → Barrel exports
│   ├── prune.ts                  → Main prune logic (replaces compressed spans with placeholders)
│   ├── query.ts                  → Message classification (ignorable, compressible)
│   ├── shape.ts                  → Message filtering/validation
│   ├── sync.ts                   → Sync compression blocks from conversation state
│   ├── priority.ts               → Build compression priority map
│   ├── reasoning-strip.ts        → Strip stale metadata from messages
│   ├── utils.ts                  → Tool ID listing, hallucination stripping
│   └── inject/                   → Injection of synthetic content
│       ├── inject.ts             → Compress nudges + message ID injection
│       └── subagent-results.ts   → Subagent result expansion
│
├── prompts/                      → All prompt templates
│   ├── index.ts                  → renderSystemPrompt helper
│   ├── store.ts                  → PromptStore (loads from files or defaults, hot-reload)
│   ├── system.ts                 → Base system prompt
│   ├── compress-range.ts         → Range compress tool prompt
│   ├── compress-message.ts       → Message compress tool prompt
│   ├── context-limit-nudge.ts    → Nudge when approaching context limit
│   ├── turn-nudge.ts             → Per-turn compression suggestion
│   ├── iteration-nudge.ts        → Iteration nudge prompt
│   └── extensions/               → Prompt extensions
│       ├── system.ts             → Protected tools extension
│       ├── tool.ts               → Range format extension
│       └── manual.ts             → Manual mode extension
│
├── state/                        → Session state management
│   ├── index.ts                  → Barrel re-exports
│   ├── types.ts                  → SessionState, CompressionBlock, Prune, WithParts
│   ├── state.ts                  → createSessionState factory
│   ├── persistence.ts            → Session save/load
│   ├── tool-cache.ts             → Tool parameter caching
│   └── utils.ts                  → State utilities
│
├── commands/                     → /dcp slash commands
│   ├── index.ts                  → Barrel exports
│   ├── help.ts                   → /dcp help
│   ├── context.ts                → /dcp context
│   ├── stats.ts                  → /dcp stats
│   ├── sweep.ts                  → /dcp sweep
│   ├── manual.ts                 → /dcp manual (toggle/trigger)
│   ├── compress.ts               → (handled in hooks.ts inline)
│   ├── decompress.ts             → /dcp decompress
│   └── recompress.ts             → /dcp recompress
│
├── strategies/                   → Compression strategies
│   ├── deduplication.ts          → Deduplicate tool outputs
│   └── purge-errors.ts           → Purge error tool outputs
│
├── subagents/
│   └── subagent-results.ts       → Subagent result handling
│
└── ui/
    ├── notification.ts           → User notifications
    └── utils.ts                  → UI utilities (token caching)
```

### Key Types

```typescript
// lib/state/types.ts
interface SessionState {
    sessionId: string | null
    isSubAgent: boolean
    manualMode: false | "active" | "compress-pending"
    compressPermission: "ask" | "allow" | "deny" | undefined
    prune: Prune                    // Compression state: blocks, messages, tools
    nudges: Nudges                  // Injected nudge anchors
    stats: SessionStats             // Token savings counters
    compressionTiming: CompressionTimingState
    toolParameters: Map<string, ToolParameterEntry>
    messageIds: MessageIdState      // mNNNN ref assignments
    modelContextLimit: number | undefined
    currentTurn: number
}

interface CompressionBlock {
    blockId: number                 // Unique block ID (bN form)
    runId: number                   // Compression run
    active: boolean                 // Whether block is still active
    mode?: "range" | "message"
    topic: string
    startId / endId: string         // Boundary IDs (mNNNN or bN)
    summary: string                 // The compressed summary text
    includedBlockIds: number[]      // Nested blocks consumed
    consumedBlockIds: number[]
    effectiveMessageIds: string[]   // All messages covered
    // ... timing, deactivation metadata
}

// lib/compress/types.ts
interface ToolContext {
    client: any
    state: SessionState
    logger: Logger
    config: PluginConfig
    prompts: PromptStore
}

interface CompressRangeEntry {
    startId: string                 // "m0001" or "b2"
    endId: string
    summary: string
}
```

### Data Flow

1. **System Prompt Hook** — Injects DCP instructions + protected tools list into system prompt
2. **Chat Message Transform Hook** (main pipeline, per turn):
    - `filterMessagesInPlace` → validate shape
    - `checkSession` → init/restore session
    - `syncCompressPermissionState` → check if compress is allowed
    - `stripHallucinations` → remove fake compress tool outputs from prior turns
    - `assignMessageRefs` → assign mNNNN refs
    - `syncCompressionBlocks` → detect blocks from conversation
    - `syncToolCache` → update tool parameter cache
    - `buildToolIdList` → enumerate tool invocations
    - `prune` → **core**: replace compressible spans with `(bN)` placeholders
    - `injectExtendedSubAgentResults` → expand subagent results
    - `buildPriorityMap` → calculate compression priorities
    - `injectCompressNudges` → suggest compression to the LLM
    - `injectMessageIds` → inject mNNNN refs for tool visibility
    - `stripStaleMetadata` → clean stale metadata
3. **Compress Tool** — LLM calls this to compress; validates args, resolves boundaries, applies compression
4. **Event Handler** — Tracks compression timing (start/complete events)
5. **Command Handler** — Routes `/dcp` subcommands

## Conventions

### File Organization

- Barrel exports via `index.ts` in every subdirectory
- Each module has a single responsibility
- Types live alongside implementation (no separate `types/` dir except within modules)
- Config is centralized in `lib/config.ts`

### Naming

- Functions: camelCase (`createSessionState`, `buildPriorityMap`)
- Types/Interfaces: PascalCase (`SessionState`, `CompressionBlock`)
- Constants: UPPER_SNAKE (`COMPRESSED_BLOCK_HEADER`, `INTERNAL_AGENT_SIGNATURES`)
- Files: kebab-case (`compress-range.ts`, `host-permissions.ts`)

### Patterns

- Factory pattern for hooks: `createSystemPromptHandler(state, logger, ...)`
- Plugin `tool()` for compress tools with schema validation
- State is mutable singleton per session (created once in index.ts)
- Prompts are hot-reloadable via `PromptStore.reload()`
- Error handling: throw `__DCP_*_HANDLED__` errors to short-circuit command execution
- `as any` is used minimally for OpenCode SDK type mismatches (line 69, 106 in hooks.ts)

### Testing

- Node built-in test runner (`node:test`)
- Assertions: `node:assert/strict`
- Test files: `tests/*.test.ts`
- Run: `node --import tsx --test tests/*.test.ts`
- Pattern: `test("description", () => { ... })` with `assert.equal`/`assert.deepEqual`
- Test helpers build mock messages via `buildMessage(role, parts)` factory

### Config System

- 3-layer merge: global defaults → custom config → project config
- JSONC support (comments allowed) via `jsonc-parser`
- Schema: `dcp.schema.json`
- Validation: Zod v4 (`zod@^4.3.6`)
- Custom prompts via `config.experimental.customPrompts` directory

## Rules & Anti-Patterns

### MUST

- Follow Prettier formatting exactly (no semicolons, 4-space indent, double quotes)
- Use ESM imports (`import`/`export`, no `require()`)
- Assign mNNNN refs to messages before referencing them
- Validate compress tool args before processing
- Track compression blocks via `allocateBlockId`/`allocateRunId`
- Keep session state in sync with conversation state via sync functions
- Use `(bN)` placeholder form for compressed block references (never `mNNNN`)
- Preserve protected tool outputs in compression summaries

### MUST NOT

- Compress if conditions not met (check `compressPermission`, manual mode, subagent status)
- Launch multiple compress tools in parallel
- Re-compress prior compression results (check `consumedBlockIds`)
- Compress away active instructions or protected tool outputs
- Modify session history directly (pruning happens via placeholder replacement only)
- Use `as any` to suppress type errors (existing uses are for SDK type mismatches only)
- Add new ESLint config (Prettier only)
- Skip barrel export when adding new modules

### Guard Rails

- `INTERNAL_AGENT_SIGNATURES` — DCP skips internal agents (title generator, summarizer)
- Compress tool denied if `config.compress.permission === "deny"`
- Subagent compression only if `config.experimental.allowSubAgents === true`
- Manual mode requires explicit `/dcp compress` trigger
- Protected tools/files patterns prevent compressing critical outputs

## Common Tasks

### Adding a new /dcp command

1. Create `lib/commands/new-command.ts` with `export handleNewCommand(ctx) {}`
2. Export from `lib/commands/index.ts`
3. Add routing in `createCommandExecuteHandler` (lib/hooks.ts)
4. Throw `__DCP_NEW_COMMAND_HANDLED__` to short-circuit

### Adding a new compression strategy

1. Create `lib/strategies/new-strategy.ts`
2. Export from `lib/strategies/index.ts`
3. Integrate into prune pipeline in `lib/messages/prune.ts`
4. Add config key in `lib/config.ts`

### Adding a new prompt template

1. Create `lib/prompts/new-prompt.ts` exporting the template string
2. Add to `RuntimePrompts` interface in `lib/prompts/store.ts`
3. Load in `PromptStore.getRuntimePrompts()`
4. Use in appropriate hook or tool

### Modifying compress tool behavior

1. Understand the mode: `range` (range.ts) vs `message` (message.ts)
2. Both share `pipeline.ts` for session prep/finalization
3. Validation in `range-utils.ts` or `message-utils.ts`
4. State changes in `compress/state.ts`
5. Boundary resolution in `compress/search.ts`

## Subdirectory Knowledge Bases

Dedicated AGENTS.md files exist for every subdirectory:

| Directory | AGENTS.md | Focus |
|-----------|-----------|-------|
| `lib/compress/` | [compress/AGENTS.md](lib/compress/AGENTS.md) | Compression engine, pipeline flow, guard conditions |
| `lib/messages/` | [messages/AGENTS.md](lib/messages/AGENTS.md) | Prune pipeline, inject subsystem, message transforms |
| `lib/messages/inject/` | [messages/inject/AGENTS.md](lib/messages/inject/AGENTS.md) | Nudge injection, message ID injection, subagent result expansion |
| `lib/state/` | [state/AGENTS.md](lib/state/AGENTS.md) | Session state, PruneMessagesState structure, persistence |
| `lib/commands/` | [commands/AGENTS.md](lib/commands/AGENTS.md) | /dcp command handlers, sentinel pattern |
| `lib/prompts/` | [prompts/AGENTS.md](lib/prompts/AGENTS.md) | Prompt templates, override system, assembly |
| `lib/prompts/extensions/` | [prompts/extensions/AGENTS.md](lib/prompts/extensions/AGENTS.md) | Conditional prompt fragments, tool format extensions, LLM guidance |
| `lib/strategies/` | [strategies/AGENTS.md](lib/strategies/AGENTS.md) | Deduplication and error-purge compression strategies |
| `lib/subagents/` | [subagents/AGENTS.md](lib/subagents/AGENTS.md) | Subagent result handling, compression-aware merging |
| `lib/ui/` | [ui/AGENTS.md](lib/ui/AGENTS.md) | Notifications, token display caching |
| `scripts/` | [scripts/AGENTS.md](scripts/AGENTS.md) | Developer CLI tools, package validation, session analysis |
| `tests/` | [tests/AGENTS.md](tests/AGENTS.md) | Test suite, Node test runner patterns, fixture factories |

## Known Complexity Hotspots

- **lib/config.ts** (987 lines) — All config loading, merging, validation. Largest file.
- **lib/hooks.ts** (367 lines) — All hook factories, command routing
- **lib/prompts/store.ts** (467 lines) — PromptStore, hot-reload, custom override resolution
- **lib/state/utils.ts** (345 lines) — Block lookups, token stats, compaction detection
- **lib/messages/inject/utils.ts** (374 lines) — Nudge injection, context limit helpers
- **lib/compress/range-utils.ts** (308 lines) — Placeholder parsing, range validation
- **lib/messages/prune.ts** (233 lines) — Core prune logic (replaces spans with placeholders)
- **lib/prompts/system.ts** — System prompt template (critical for LLM behavior)
