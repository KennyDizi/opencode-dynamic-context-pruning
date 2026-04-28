import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import type { Logger } from "../logger"
import { SYSTEM as SYSTEM_PROMPT } from "./system"
import { COMPRESS_RANGE as COMPRESS_RANGE_PROMPT } from "./compress-range"
import { COMPRESS_MESSAGE as COMPRESS_MESSAGE_PROMPT } from "./compress-message"
import { CONTEXT_LIMIT_NUDGE } from "./context-limit-nudge"
import { TURN_NUDGE } from "./turn-nudge"
import { ITERATION_NUDGE } from "./iteration-nudge"
import { MANUAL_MODE_SYSTEM_EXTENSION, SUBAGENT_SYSTEM_EXTENSION } from "./extensions/system"
import {
    DEFAULTS_README_FILE,
    type PromptPaths,
    buildDefaultPromptFileContent,
    buildDefaultsReadmeContent,
    readFileIfExists,
    resolvePromptPaths,
} from "./loader"

export type PromptKey =
    | "system"
    | "compress-range"
    | "compress-message"
    | "context-limit-nudge"
    | "turn-nudge"
    | "iteration-nudge"

type EditablePromptField =
    | "system"
    | "compressRange"
    | "compressMessage"
    | "contextLimitNudge"
    | "turnNudge"
    | "iterationNudge"

interface PromptDefinition {
    key: PromptKey
    fileName: string
    label: string
    description: string
    usage: string
    runtimeField: EditablePromptField
}

interface PromptOverrideCandidate {
    path: string
}

export interface RuntimePrompts {
    system: string
    compressRange: string
    compressMessage: string
    contextLimitNudge: string
    turnNudge: string
    iterationNudge: string
    manualExtension: string
    subagentExtension: string
}

const PROMPT_DEFINITIONS: PromptDefinition[] = [
    {
        key: "system",
        fileName: "system.md",
        label: "System",
        description: "Core system-level DCP instruction block",
        usage: "Injected into the model system prompt on every request",
        runtimeField: "system",
    },
    {
        key: "compress-range",
        fileName: "compress-range.md",
        label: "Compress Range",
        description: "range-mode compress tool instructions and summary constraints",
        usage: "Registered as the range-mode compress tool description",
        runtimeField: "compressRange",
    },
    {
        key: "compress-message",
        fileName: "compress-message.md",
        label: "Compress Message",
        description: "message-mode compress tool instructions and summary constraints",
        usage: "Registered as the message-mode compress tool description",
        runtimeField: "compressMessage",
    },
    {
        key: "context-limit-nudge",
        fileName: "context-limit-nudge.md",
        label: "Context Limit Nudge",
        description: "High-priority nudge when context is over max threshold",
        usage: "Injected when context usage is beyond configured max limits",
        runtimeField: "contextLimitNudge",
    },
    {
        key: "turn-nudge",
        fileName: "turn-nudge.md",
        label: "Turn Nudge",
        description: "Nudge to compress closed ranges at turn boundaries",
        usage: "Injected when context is between min and max limits at a new user turn",
        runtimeField: "turnNudge",
    },
    {
        key: "iteration-nudge",
        fileName: "iteration-nudge.md",
        label: "Iteration Nudge",
        description: "Nudge after many iterations without user input",
        usage: "Injected when iteration threshold is crossed",
        runtimeField: "iterationNudge",
    },
]

export const PROMPT_KEYS: PromptKey[] = [
    "system",
    "compress-range",
    "compress-message",
    "context-limit-nudge",
    "turn-nudge",
    "iteration-nudge",
]

const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g
const LEGACY_INLINE_COMMENT_LINE_REGEX = /^[ \t]*\/\/.*?\/\/[ \t]*$/gm
const DCP_SYSTEM_REMINDER_TAG_REGEX =
    /^\s*<dcp-system-reminder\b[^>]*>[\s\S]*<\/dcp-system-reminder>\s*$/i

const BUNDLED_EDITABLE_PROMPTS: Record<EditablePromptField, string> = {
    system: SYSTEM_PROMPT,
    compressRange: COMPRESS_RANGE_PROMPT,
    compressMessage: COMPRESS_MESSAGE_PROMPT,
    contextLimitNudge: CONTEXT_LIMIT_NUDGE,
    turnNudge: TURN_NUDGE,
    iterationNudge: ITERATION_NUDGE,
}

const INTERNAL_PROMPT_EXTENSIONS = {
    manualExtension: MANUAL_MODE_SYSTEM_EXTENSION,
    subagentExtension: SUBAGENT_SYSTEM_EXTENSION,
}

function createBundledRuntimePrompts(): RuntimePrompts {
    return {
        system: BUNDLED_EDITABLE_PROMPTS.system,
        compressRange: BUNDLED_EDITABLE_PROMPTS.compressRange,
        compressMessage: BUNDLED_EDITABLE_PROMPTS.compressMessage,
        contextLimitNudge: BUNDLED_EDITABLE_PROMPTS.contextLimitNudge,
        turnNudge: BUNDLED_EDITABLE_PROMPTS.turnNudge,
        iterationNudge: BUNDLED_EDITABLE_PROMPTS.iterationNudge,
        manualExtension: INTERNAL_PROMPT_EXTENSIONS.manualExtension,
        subagentExtension: INTERNAL_PROMPT_EXTENSIONS.subagentExtension,
    }
}

function stripConditionalTag(content: string, tagName: string): string {
    const regex = new RegExp(`<${tagName}>[\\s\\S]*?<\/${tagName}>`, "gi")
    return content.replace(regex, "")
}

function unwrapDcpTagIfWrapped(content: string): string {
    const trimmed = content.trim()

    if (DCP_SYSTEM_REMINDER_TAG_REGEX.test(trimmed)) {
        return trimmed
            .replace(/^\s*<dcp-system-reminder\b[^>]*>\s*/i, "")
            .replace(/\s*<\/dcp-system-reminder>\s*$/i, "")
            .trim()
    }

    return trimmed
}

function normalizeReminderPromptContent(content: string): string {
    const normalized = content.trim()

    if (!normalized) {
        return ""
    }

    const startsWrapped = /^\s*<dcp-system-reminder\b[^>]*>/i.test(normalized)
    const endsWrapped = /<\/dcp-system-reminder>\s*$/i.test(normalized)

    if (startsWrapped !== endsWrapped) {
        return ""
    }

    return unwrapDcpTagIfWrapped(normalized)
}

function stripPromptComments(content: string): string {
    return content
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        .replace(HTML_COMMENT_REGEX, "")
        .replace(LEGACY_INLINE_COMMENT_LINE_REGEX, "")
}

function toEditablePromptText(definition: PromptDefinition, rawContent: string): string {
    let normalized = stripPromptComments(rawContent).trim()
    if (!normalized) {
        return ""
    }

    if (definition.key === "system") {
        normalized = stripConditionalTag(normalized, "manual")
        normalized = stripConditionalTag(normalized, "subagent")
    }

    if (definition.key !== "compress-range" && definition.key !== "compress-message") {
        normalized = normalizeReminderPromptContent(normalized)
    }

    return normalized.trim()
}

function wrapRuntimePromptContent(definition: PromptDefinition, editableText: string): string {
    const trimmed = editableText.trim()
    if (!trimmed) {
        return ""
    }

    if (definition.key === "compress-range" || definition.key === "compress-message") {
        return trimmed
    }

    return `<dcp-system-reminder>\n${trimmed}\n</dcp-system-reminder>`
}

export class PromptStore {
    private readonly logger: Logger
    private readonly paths: PromptPaths
    private readonly customPromptsEnabled: boolean
    private runtimePrompts: RuntimePrompts

    constructor(logger: Logger, workingDirectory: string, customPromptsEnabled = false) {
        this.logger = logger
        this.paths = resolvePromptPaths(workingDirectory)
        this.customPromptsEnabled = customPromptsEnabled
        this.runtimePrompts = createBundledRuntimePrompts()

        if (this.customPromptsEnabled) {
            this.ensureDefaultFiles()
        }
        this.reload()
    }

    getRuntimePrompts(): RuntimePrompts {
        return { ...this.runtimePrompts }
    }

    reload(): void {
        const nextPrompts = createBundledRuntimePrompts()

        if (!this.customPromptsEnabled) {
            this.runtimePrompts = nextPrompts
            return
        }

        for (const definition of PROMPT_DEFINITIONS) {
            const bundledSource = BUNDLED_EDITABLE_PROMPTS[definition.runtimeField]
            const bundledEditable = toEditablePromptText(definition, bundledSource)
            const bundledRuntime = wrapRuntimePromptContent(definition, bundledEditable)
            const fallbackValue = bundledRuntime || bundledSource.trim()
            let effectiveValue = fallbackValue

            for (const candidate of this.getOverrideCandidates(definition.fileName)) {
                const rawOverride = readFileIfExists(candidate.path)
                if (rawOverride === null) {
                    continue
                }

                const editableOverride = toEditablePromptText(definition, rawOverride)
                if (!editableOverride) {
                    this.logger.warn("Prompt override is empty or invalid after normalization", {
                        key: definition.key,
                        path: candidate.path,
                    })
                    continue
                }

                const wrappedOverride = wrapRuntimePromptContent(definition, editableOverride)
                if (!wrappedOverride) {
                    this.logger.warn("Prompt override could not be wrapped for runtime", {
                        key: definition.key,
                        path: candidate.path,
                    })
                    continue
                }

                effectiveValue = wrappedOverride
                break
            }

            nextPrompts[definition.runtimeField] = effectiveValue
        }

        this.runtimePrompts = nextPrompts
    }

    private getOverrideCandidates(fileName: string): PromptOverrideCandidate[] {
        const candidates: PromptOverrideCandidate[] = []

        if (this.paths.projectOverridesDir) {
            candidates.push({
                path: join(this.paths.projectOverridesDir, fileName),
            })
        }

        if (this.paths.configDirOverridesDir) {
            candidates.push({
                path: join(this.paths.configDirOverridesDir, fileName),
            })
        }

        candidates.push({
            path: join(this.paths.globalOverridesDir, fileName),
        })

        return candidates
    }

    private ensureDefaultFiles(): void {
        try {
            mkdirSync(this.paths.defaultsDir, { recursive: true })
            mkdirSync(this.paths.globalOverridesDir, { recursive: true })
        } catch {
            this.logger.warn("Failed to initialize prompt directories", {
                defaultsDir: this.paths.defaultsDir,
                globalOverridesDir: this.paths.globalOverridesDir,
            })
            return
        }

        for (const definition of PROMPT_DEFINITIONS) {
            const bundledEditable = toEditablePromptText(
                definition,
                BUNDLED_EDITABLE_PROMPTS[definition.runtimeField],
            )
            const managedContent = buildDefaultPromptFileContent(
                bundledEditable || BUNDLED_EDITABLE_PROMPTS[definition.runtimeField],
            )
            const filePath = join(this.paths.defaultsDir, definition.fileName)

            try {
                const existing = readFileIfExists(filePath)
                if (existing === managedContent) {
                    continue
                }
                writeFileSync(filePath, managedContent, "utf-8")
            } catch {
                this.logger.warn("Failed to write default prompt file", {
                    key: definition.key,
                    path: filePath,
                })
            }
        }

        const readmePath = join(this.paths.defaultsDir, DEFAULTS_README_FILE)
        const readmeContent = buildDefaultsReadmeContent(PROMPT_DEFINITIONS)

        try {
            const existing = readFileIfExists(readmePath)
            if (existing !== readmeContent) {
                writeFileSync(readmePath, readmeContent, "utf-8")
            }
        } catch {
            this.logger.warn("Failed to write defaults README", {
                path: readmePath,
            })
        }
    }
}
