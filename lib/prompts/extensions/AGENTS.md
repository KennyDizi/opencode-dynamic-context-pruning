# lib/prompts/extensions — Prompt Extension Templates

**4 files · ~143L total · no barrel** — Conditional and dynamic prompt fragments appended to base prompts.

## FILES
| File | Role |
|------|------|
| `system.ts` (32L) | System prompt extensions: `MANUAL_MODE_SYSTEM_EXTENSION`, `SUBAGENT_SYSTEM_EXTENSION`, `buildProtectedToolsExtension()`. |
| `tool.ts` (35L) | Compress tool schema format extensions: `RANGE_FORMAT_EXTENSION`, `MESSAGE_FORMAT_EXTENSION`. Not overridable via custom prompts. |
| `manual.ts` (~33L) | Manual mode extension with `/dcp compress` trigger instructions. |
| `nudge.ts` (43L) | Dynamic LLM guidance: `buildCompressedBlockGuidance()`, `renderMessagePriorityGuidance()`, `appendGuidanceToDcpTag()`. |

## KEY PATTERNS
- No barrel, extensions are imported individually by `lib/prompts/` modules.
- System extensions are conditional (manual mode, subagent context, protected tools).
- Tool format extensions are immutable, schemas must match runtime validation.
- Nudge guidance is built dynamically from current state (active blocks, priority map).
- All extensions are plain string templates or template functions.

## ANTI-PATTERNS
- Don't make tool format extensions editable, validation logic must match the format description exactly.
- Don't add runtime logic here, these are pure prompt templates.
- Don't import from extensions in non-prompt modules, only `lib/prompts/` should use these.
- Don't add a barrel, intentional no-barrel pattern.
