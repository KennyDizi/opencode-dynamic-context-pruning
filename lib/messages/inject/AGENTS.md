# lib/messages/inject — Nudge & ID Injection

**3 files · 671L total · no barrel** — Injects compress nudges, message IDs, and subagent results into the message stream.

## FILES
| File | Role |
|------|------|
| `inject.ts` (215L) | `injectCompressNudges()` places contextLimit / turnNudge / iterationNudge anchors (clears them if last message already calls compress). `injectMessageIds()` formats mNNNN refs and BLOCKED tags into text parts so the LLM can target them. |
| `subagent-results.ts` (82L) | `injectExtendedSubAgentResults()` async fetches subagent conversations via client API, caches in state, and replaces `<task_result>...</task_result>` blocks. Gated by `config.experimental.allowSubAgents`. |
| `utils.ts` (374L) | `isContextOverLimits()` resolves percentage and absolute model limits. `addAnchor()` enforces nudge frequency. `applyAnchoredNudges()` and `injectAnchoredNudge()` dispatch range vs message mode and handle user (text append) vs assistant (system guidance) injection. |

## KEY PATTERNS
- No barrel. Consumers import directly from sub-files (this is a sub-module of `lib/messages/`).
- Anchor-based injection: nudges land at specific message anchors, never blindly appended.
- Range vs message mode dispatch throughout. Nudge format differs per compress mode.
- Context limit resolution checks both percentage (of model limit) and absolute (`maxContextLimit` / `minContextLimit`).
- Subagent results use async client API calls; results cached in state for reuse across turns.

## ANTI-PATTERNS
- Don't add a barrel. This dir intentionally has none.
- Don't nudge too frequently. `addAnchor()` enforces `config.compress.nudgeFrequency`.
- Don't inject message IDs before `assignMessageRefs` runs. There'd be no mNNNN refs to inject.
- Don't fetch subagent results without checking the `allowSubAgents` config flag.
- Don't bypass `isContextOverLimits()`. It handles both absolute and percentage limits in one place.
