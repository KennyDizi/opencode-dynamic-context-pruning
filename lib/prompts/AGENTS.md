# lib/prompts — Prompt Templates

**9 files · 740L + extensions/ (4 files · 150L)** — All LLM prompt content. Hot-reloadable. No template engine, raw template literals only.

## FILES
| File | Role |
|------|------|
| `index.ts` | Barrel: exports `PromptStore`, `RuntimePrompts` types, `renderSystemPrompt()` assembler |
|| `store.ts` (369L) | `PromptStore` class. Disk I/O calls delegated to `loader.ts`, path resolution, override merging, `reload()` |
|| `loader.ts` (116L) | File I/O + path resolution for override system (`resolvePromptPaths`, `readFileIfExists`, `buildDefaultPromptFileContent`). Extracted from `store.ts` |
| `system.ts` | Base system prompt. **CRITICAL** — drives LLM behavior session-wide |
| `compress-range.ts` | Range compress tool prompt |
| `compress-message.ts` | Message compress tool prompt |
| `context-limit-nudge.ts` | Nudge injected near context limit |
| `turn-nudge.ts` | Per-turn compression reminder |
| `iteration-nudge.ts` | Iteration-count-based nudge |
| `extensions/system.ts` | Protected tools extension (appended to base) |
| `extensions/tool.ts` | Range format extension |
| `extensions/manual.ts` | Manual mode extension |

## HOW PROMPTS ARE ASSEMBLED
- `renderSystemPrompt()` (index.ts) builds the final system prompt: `system.ts` base + applicable extensions concatenated.
- Extensions append conditionally: `extensions/system.ts` when protected tools configured; `extensions/manual.ts` when manual mode active; `extensions/tool.ts` for range format.
- All templates return raw strings. No interpolation framework. Compose via `${}` in template literals only.
- `RuntimePrompts` interface (store.ts) has ONE field per template. Adding a prompt = adding a field here.

## CUSTOM OVERRIDE SYSTEM
- Gated by `config.experimental.customPrompts`.
- On enable, DCP writes built-in defaults to `~/.config/opencode/dcp-prompts/defaults/` (read-only reference).
- User edits live in `~/.config/opencode/dcp-prompts/overrides/<name>.md`.
- Override resolution: if override file exists, it fully replaces the default. No merging, no partial overrides.
- `PromptStore.reload()` re-reads every file from disk. Triggered by `/dcp` commands or config change. No process restart needed.

## WHERE TO LOOK
| Task | File |
|------|------|
| Change how LLM behaves overall | `system.ts` |
| Change compress tool instructions | `compress-range.ts` or `compress-message.ts` |
| Change when/how nudges fire | `turn-nudge.ts`, `iteration-nudge.ts`, `context-limit-nudge.ts` |
| Add protected-tools guidance | `extensions/system.ts` |
| Wire up new prompt loading | `store.ts` (`getRuntimePrompts`, `RuntimePrompts`) |
| Change assembly order | `index.ts` (`renderSystemPrompt`) |
| Debug override path resolution | `store.ts` path constants |

## ANTI-PATTERNS
- Don't introduce a template engine. Stay with template literals.
- Don't read prompt files outside `PromptStore`. All I/O routes through it for hot-reload + override consistency.
- Don't hardcode prompt strings inside hooks/tools. Pull from `RuntimePrompts` so overrides take effect.
- Don't merge overrides partially. Override = full replacement. Document the contract, don't soften it.
- Don't edit `system.ts` casually. Run a real session afterward, prompt drift breaks the whole pipeline.
- Don't forget to add new templates to `RuntimePrompts` AND `getRuntimePrompts()` in store.ts. Missing either = silent fallback.
- Don't bypass `renderSystemPrompt()` to build system prompts ad-hoc. Extensions won't apply.
