# scripts — Developer tooling and CLI utilities

**10 files · 2174L total** — Package validation, prompt preview, session/token analysis CLIs. No barrel.

## FILES
| File | Role |
|------|------|
| `print.ts` (105L) | CLI to preview prompts via PromptStore + renderSystemPrompt. Flags: `--list`, `--show <key>`, `--system`, `--system-manual`, `--system-subagent`, `--system-all`. Run via `npx tsx scripts/print.ts`. |
| `verify-package.mjs` (233L) | 4-stage package validation: repo files exist, package.json shape, runtime import graph (no CJS leaks), packed tarball contents. Uses `npm pack --dry-run`. Run via `npm run check:package`. |
| `opencode_api.py` (249L) | Shared Python lib for SQLite DB access (`~/.local/share/opencode/opencode.db`). Exposes `OpencodeAPI`, `add_api_arguments()`, `create_client_from_args()`, `list_sessions_across_projects()`. |
| `opencode-dcp-stats` (452L) | Analyzes DCP cache impact. Tracks cache hit rates before/after compress, per-tool breakdown, cost analysis, cache recovery by distance from DCP call. |
| `opencode-find-session` (132L) | Search session IDs by title. Flags: `--exact`, `--json`, `--all`. |
| `opencode-get-message` (98L) | Get message payload by ID. Direct session lookup or scan across sessions. |
| `opencode-session-timeline` (258L) | Token values per step with color-coded terminal output. Highlights DCP tool usage causing cache drops. |
| `opencode-message-token-counts` (393L) | Per-message token counts via `@anthropic-ai/tokenizer` (Node subprocess). Size bars, role coloring, largest message highlights. |
| `opencode-token-stats` (182L) | Aggregate token stats across sessions. Per-session table plus grand totals. |
| `README.md` (32L) | DCP CLI docs. Documents `bun run dcp --type` usage convention. |

## KEY PATTERNS
- Python scripts share `opencode_api.py` for DB access and common argparse setup via `add_api_arguments()`.
- Token-counting scripts bridge to Node.js for `@anthropic-ai/tokenizer`.
- `verify-package.mjs` is CI-critical, runs in pr-checks workflow.
- `print.ts` is developer tooling, not shipped in production.
- Python CLIs invoked via `bun run dcp --type <script>` per README convention.

## ANTI-PATTERNS
- Don't run Python scripts without the shared `opencode_api.py` dependency on path.
- Don't bypass `verify-package.mjs` before releases, it catches packaging bugs.
- Don't add scripts requiring new runtime deps without updating `package.json` or requirements.
- Don't modify `opencode_api.py` without testing all dependent Python scripts.
