# lib/commands — /dcp Slash Commands

**9 files · 1569L** — Handlers for /dcp subcommands. Routed via `createCommandExecuteHandler` in `lib/hooks.ts`.

## FILES

| Command | File | What It Does |
|---------|------|--------------|
| `/dcp help` | `help.ts` | Print available subcommands |
| `/dcp context` | `context.ts` (305L) | Token usage breakdown by category + pruning savings via `computeStateTokenStats()` |
| `/dcp stats` | `stats.ts` (148L) | Cumulative pruning stats across sessions |
| `/dcp sweep [count]` | `sweep.ts` (268L) | Prune recent tools, respects `commands.protectedTools` |
| `/dcp manual [on\|off]` | `manual.ts` | Toggle `state.manualMode` |
| `/dcp compress` | `compress.ts` | **Stub.** Real logic lives inline in `hooks.ts` |
| `/dcp decompress <n>` | `decompress.ts` (275L) | Restore block by `blockId`; lists IDs if no arg |
| `/dcp recompress <n>` | `recompress.ts` (224L) | Re-apply a user-decompressed block |
| (shared) | `compression-targets.ts` (137L) | `resolveCompressionTargets()`, `formatBlockSummary()` for decompress/recompress |

## HANDLER CONTRACT

- Signature: `handleX(ctx: ToolContext)` where `ToolContext = { client, state, logger, config, prompts }` (same shape as compress tools).
- **Sentinel throw pattern**: each handler throws a unique sentinel error after success, e.g. `__DCP_CONTEXT_HANDLED__`, `__DCP_SWEEP_HANDLED__`, `__DCP_DECOMPRESS_HANDLED__`. `createCommandExecuteHandler` in `hooks.ts` catches these to short-circuit the command pipeline.
- All handlers persist state after mutation via the persistence layer in `state/persistence.ts`.

## KEY NON-OBVIOUS PATTERNS

- **`deactivatedByUser` is owned by `decompress.ts`.** It's the ONLY site that sets `block.deactivatedByUser = true` (alongside `block.active = false`). Other deactivations (consumed by a later compression) leave this flag false. Treat it as the "user-restored" marker.
- **`recompress.ts` is the inverse**: sets `active = true`, `deactivatedByUser = false`, then triggers a re-prune on the next transform.
- **`sweep.ts` filters by `config.commands.protectedTools`** before pruning. Don't bypass this check, even for "obviously safe" tools.
- **`compress.ts` is now a real module.** `handleCompressCommand` was extracted from `hooks.ts` into `lib/commands/compress.ts` and is exported from the commands barrel. Routing still happens in `createCommandExecuteHandler` but the implementation lives here.
- **`compression-targets.ts` is the shared resolver** for both decompress and recompress. New block-targeting commands should reuse `resolveCompressionTargets()` rather than re-walking `state.prune.blocks`.
- **`context.ts` token math** flows through `computeStateTokenStats()` (from `state/utils.ts`). Don't compute token breakdowns ad-hoc; extend that helper.

## WHERE TO LOOK

| Task | File |
|------|------|
| Add a new sentinel + routing | `hooks.ts` `createCommandExecuteHandler` |
| Change token category labels | `context.ts` + `state/utils.ts` `computeStateTokenStats` |
| Adjust which tools sweep skips | `sweep.ts` + `config.commands.protectedTools` |
| Block targeting / ID resolution | `compression-targets.ts` |
| Manual-mode state machine | `manual.ts` + `state.manualMode` (`false \| "active" \| "compress-pending"`) |
| Cumulative stats schema | `stats.ts` + `state.stats` |

## ANTI-PATTERNS

- Don't add logic to `compress.ts`. It's a placeholder.
- Don't mutate `block.active` without also setting `deactivatedByUser` correctly (true on user decompress, false on recompress, untouched on consumption).
- Don't throw a generic `Error("handled")`. Use the unique `__DCP_<NAME>_HANDLED__` sentinel so `hooks.ts` can distinguish completions from real errors.
- Don't skip the post-mutation persistence call. Decompress/recompress/manual all persist; new mutating commands must too.
- Don't re-walk `state.prune.blocks` in new commands. Use `resolveCompressionTargets()`.
