# lib/ui — Notifications & UI Utilities

**2 files · 651L · no barrel** — User-facing output only. No business logic here.

## FILES
| File | Role |
|------|------|
| `notification.ts` (347L) | Post-compression notifications. Builds summary (block summaries, token savings, session stats). Called by `compress/pipeline.ts` after each run. |
| `utils.ts` (304L) | Token display caching. `getDisplayTokens()` memoizes expensive tokenizer calls. Used by `/dcp context` and `inject/utils.ts`. |

## KEY PATTERNS
- **Direct imports, no barrel.** Consumers use `import { sendNotification } from "../ui/notification"`. Don't expect `from "../ui"` to work.
- **Two channels** in `notification.ts`: `"chat"` (synthetic conversation message) vs `"toast"` (`client.tui.showToast`). Selector: `config.pruneNotificationType`.
- **Two verbosity levels**: `"minimal"` vs `"detailed"`. Selector: `config.pruneNotification`.
- **Per-instance token cache** in `utils.ts`. Not shared across requests, not global. Tokenizer calls are the hot path being optimized.

## ANTI-PATTERNS
- Don't put compression logic, state mutation, or boundary resolution here. Output formatting only.
- Don't bypass `getDisplayTokens()` for context display, you'll re-tokenize the same strings.
- Don't add a third notification channel without threading config through `pruneNotificationType` validation in `lib/config.ts`.
- **If you add a third file here, also add `index.ts` barrel.** Convention requires barrels in every subdir. This dir is the lone exception, currently. Don't extend the exception.
