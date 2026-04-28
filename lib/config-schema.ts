type Permission = "ask" | "allow" | "deny"
type CompressMode = "range" | "message"

export interface Deduplication {
    enabled: boolean
    protectedTools: string[]
}

export interface CompressConfig {
    mode: CompressMode
    permission: Permission
    showCompression: boolean
    summaryBuffer: boolean
    maxContextLimit: number | `${number}%`
    minContextLimit: number | `${number}%`
    modelMaxLimits?: Record<string, number | `${number}%`>
    modelMinLimits?: Record<string, number | `${number}%`>
    nudgeFrequency: number
    iterationNudgeThreshold: number
    nudgeForce: "strong" | "soft"
    protectedTools: string[]
    protectUserMessages: boolean
}

export interface Commands {
    enabled: boolean
    protectedTools: string[]
}

export interface ManualModeConfig {
    enabled: boolean
    automaticStrategies: boolean
}

export interface PurgeErrors {
    enabled: boolean
    turns: number
    protectedTools: string[]
}

export interface TurnProtection {
    enabled: boolean
    turns: number
}

export interface ExperimentalConfig {
    allowSubAgents: boolean
    customPrompts: boolean
}

export interface PluginConfig {
    enabled: boolean
    debug: boolean
    pruneNotification: "off" | "minimal" | "detailed"
    pruneNotificationType: "chat" | "toast"
    commands: Commands
    manualMode: ManualModeConfig
    turnProtection: TurnProtection
    experimental: ExperimentalConfig
    protectedFilePatterns: string[]
    compress: CompressConfig
    strategies: {
        deduplication: Deduplication
        purgeErrors: PurgeErrors
    }
}

export type CompressOverride = Partial<CompressConfig>

export const DEFAULT_PROTECTED_TOOLS = [
    "task",
    "skill",
    "todowrite",
    "todoread",
    "compress",
    "batch",
    "plan_enter",
    "plan_exit",
    "write",
    "edit",
]

export const COMPRESS_DEFAULT_PROTECTED_TOOLS = ["task", "skill", "todowrite", "todoread"]

export const DEFAULTS = {
    turnProtectionTurns: 4,
    maxContextLimit: 100000,
    minContextLimit: 50000,
    nudgeFrequency: 5,
    iterationNudgeThreshold: 15,
    purgeErrorsTurns: 4,
} as const

export const VALID_CONFIG_KEYS = new Set([
    "$schema",
    "enabled",
    "debug",
    "showUpdateToasts",
    "pruneNotification",
    "pruneNotificationType",
    "turnProtection",
    "turnProtection.enabled",
    "turnProtection.turns",
    "experimental",
    "experimental.allowSubAgents",
    "experimental.customPrompts",
    "protectedFilePatterns",
    "commands",
    "commands.enabled",
    "commands.protectedTools",
    "manualMode",
    "manualMode.enabled",
    "manualMode.automaticStrategies",
    "compress",
    "compress.mode",
    "compress.permission",
    "compress.showCompression",
    "compress.summaryBuffer",
    "compress.maxContextLimit",
    "compress.minContextLimit",
    "compress.modelMaxLimits",
    "compress.modelMinLimits",
    "compress.nudgeFrequency",
    "compress.iterationNudgeThreshold",
    "compress.nudgeForce",
    "compress.protectedTools",
    "compress.protectUserMessages",
    "strategies",
    "strategies.deduplication",
    "strategies.deduplication.enabled",
    "strategies.deduplication.protectedTools",
    "strategies.purgeErrors",
    "strategies.purgeErrors.enabled",
    "strategies.purgeErrors.turns",
    "strategies.purgeErrors.protectedTools",
])

function getConfigKeyPaths(obj: Record<string, any>, prefix = ""): string[] {
    const keys: string[] = []
    for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        keys.push(fullKey)

        // model*Limits are dynamic maps keyed by providerID/modelID; do not recurse into arbitrary IDs.
        if (fullKey === "compress.modelMaxLimits" || fullKey === "compress.modelMinLimits") {
            continue
        }

        if (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
            keys.push(...getConfigKeyPaths(obj[key], fullKey))
        }
    }
    return keys
}

export function getInvalidConfigKeys(userConfig: Record<string, any>): string[] {
    const userKeys = getConfigKeyPaths(userConfig)
    return userKeys.filter((key) => !VALID_CONFIG_KEYS.has(key))
}

interface ValidationError {
    key: string
    expected: string
    actual: string
}

export function validateConfigTypes(config: Record<string, any>): ValidationError[] {
    const errors: ValidationError[] = []

    if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
        errors.push({ key: "enabled", expected: "boolean", actual: typeof config.enabled })
    }

    if (config.debug !== undefined && typeof config.debug !== "boolean") {
        errors.push({ key: "debug", expected: "boolean", actual: typeof config.debug })
    }

    if (config.pruneNotification !== undefined) {
        const validValues = ["off", "minimal", "detailed"]
        if (!validValues.includes(config.pruneNotification)) {
            errors.push({
                key: "pruneNotification",
                expected: '"off" | "minimal" | "detailed"',
                actual: JSON.stringify(config.pruneNotification),
            })
        }
    }

    if (config.pruneNotificationType !== undefined) {
        const validValues = ["chat", "toast"]
        if (!validValues.includes(config.pruneNotificationType)) {
            errors.push({
                key: "pruneNotificationType",
                expected: '"chat" | "toast"',
                actual: JSON.stringify(config.pruneNotificationType),
            })
        }
    }

    if (config.protectedFilePatterns !== undefined) {
        if (!Array.isArray(config.protectedFilePatterns)) {
            errors.push({
                key: "protectedFilePatterns",
                expected: "string[]",
                actual: typeof config.protectedFilePatterns,
            })
        } else if (!config.protectedFilePatterns.every((v: unknown) => typeof v === "string")) {
            errors.push({
                key: "protectedFilePatterns",
                expected: "string[]",
                actual: "non-string entries",
            })
        }
    }

    if (config.turnProtection) {
        if (
            config.turnProtection.enabled !== undefined &&
            typeof config.turnProtection.enabled !== "boolean"
        ) {
            errors.push({
                key: "turnProtection.enabled",
                expected: "boolean",
                actual: typeof config.turnProtection.enabled,
            })
        }

        if (
            config.turnProtection.turns !== undefined &&
            typeof config.turnProtection.turns !== "number"
        ) {
            errors.push({
                key: "turnProtection.turns",
                expected: "number",
                actual: typeof config.turnProtection.turns,
            })
        }
        if (typeof config.turnProtection.turns === "number" && config.turnProtection.turns < 1) {
            errors.push({
                key: "turnProtection.turns",
                expected: "positive number (>= 1)",
                actual: `${config.turnProtection.turns}`,
            })
        }
    }

    const experimental = config.experimental
    if (experimental !== undefined) {
        if (
            typeof experimental !== "object" ||
            experimental === null ||
            Array.isArray(experimental)
        ) {
            errors.push({
                key: "experimental",
                expected: "object",
                actual: typeof experimental,
            })
        } else {
            if (
                experimental.allowSubAgents !== undefined &&
                typeof experimental.allowSubAgents !== "boolean"
            ) {
                errors.push({
                    key: "experimental.allowSubAgents",
                    expected: "boolean",
                    actual: typeof experimental.allowSubAgents,
                })
            }

            if (
                experimental.customPrompts !== undefined &&
                typeof experimental.customPrompts !== "boolean"
            ) {
                errors.push({
                    key: "experimental.customPrompts",
                    expected: "boolean",
                    actual: typeof experimental.customPrompts,
                })
            }
        }
    }

    const commands = config.commands
    if (commands !== undefined) {
        if (typeof commands !== "object" || commands === null || Array.isArray(commands)) {
            errors.push({
                key: "commands",
                expected: "object",
                actual: typeof commands,
            })
        } else {
            if (commands.enabled !== undefined && typeof commands.enabled !== "boolean") {
                errors.push({
                    key: "commands.enabled",
                    expected: "boolean",
                    actual: typeof commands.enabled,
                })
            }
            if (commands.protectedTools !== undefined && !Array.isArray(commands.protectedTools)) {
                errors.push({
                    key: "commands.protectedTools",
                    expected: "string[]",
                    actual: typeof commands.protectedTools,
                })
            }
        }
    }

    const manualMode = config.manualMode
    if (manualMode !== undefined) {
        if (typeof manualMode !== "object" || manualMode === null || Array.isArray(manualMode)) {
            errors.push({
                key: "manualMode",
                expected: "object",
                actual: typeof manualMode,
            })
        } else {
            if (manualMode.enabled !== undefined && typeof manualMode.enabled !== "boolean") {
                errors.push({
                    key: "manualMode.enabled",
                    expected: "boolean",
                    actual: typeof manualMode.enabled,
                })
            }

            if (
                manualMode.automaticStrategies !== undefined &&
                typeof manualMode.automaticStrategies !== "boolean"
            ) {
                errors.push({
                    key: "manualMode.automaticStrategies",
                    expected: "boolean",
                    actual: typeof manualMode.automaticStrategies,
                })
            }
        }
    }

    const compress = config.compress
    if (compress !== undefined) {
        if (typeof compress !== "object" || compress === null || Array.isArray(compress)) {
            errors.push({
                key: "compress",
                expected: "object",
                actual: typeof compress,
            })
        } else {
            if (
                compress.mode !== undefined &&
                compress.mode !== "range" &&
                compress.mode !== "message"
            ) {
                errors.push({
                    key: "compress.mode",
                    expected: '"range" | "message"',
                    actual: JSON.stringify(compress.mode),
                })
            }

            if (
                compress.summaryBuffer !== undefined &&
                typeof compress.summaryBuffer !== "boolean"
            ) {
                errors.push({
                    key: "compress.summaryBuffer",
                    expected: "boolean",
                    actual: typeof compress.summaryBuffer,
                })
            }

            if (
                compress.nudgeFrequency !== undefined &&
                typeof compress.nudgeFrequency !== "number"
            ) {
                errors.push({
                    key: "compress.nudgeFrequency",
                    expected: "number",
                    actual: typeof compress.nudgeFrequency,
                })
            }

            if (typeof compress.nudgeFrequency === "number" && compress.nudgeFrequency < 1) {
                errors.push({
                    key: "compress.nudgeFrequency",
                    expected: "positive number (>= 1)",
                    actual: `${compress.nudgeFrequency} (will be clamped to 1)`,
                })
            }

            if (
                compress.iterationNudgeThreshold !== undefined &&
                typeof compress.iterationNudgeThreshold !== "number"
            ) {
                errors.push({
                    key: "compress.iterationNudgeThreshold",
                    expected: "number",
                    actual: typeof compress.iterationNudgeThreshold,
                })
            }

            if (
                compress.nudgeForce !== undefined &&
                compress.nudgeForce !== "strong" &&
                compress.nudgeForce !== "soft"
            ) {
                errors.push({
                    key: "compress.nudgeForce",
                    expected: '"strong" | "soft"',
                    actual: JSON.stringify(compress.nudgeForce),
                })
            }

            if (compress.protectedTools !== undefined && !Array.isArray(compress.protectedTools)) {
                errors.push({
                    key: "compress.protectedTools",
                    expected: "string[]",
                    actual: typeof compress.protectedTools,
                })
            }

            if (
                compress.protectUserMessages !== undefined &&
                typeof compress.protectUserMessages !== "boolean"
            ) {
                errors.push({
                    key: "compress.protectUserMessages",
                    expected: "boolean",
                    actual: typeof compress.protectUserMessages,
                })
            }

            if (
                typeof compress.iterationNudgeThreshold === "number" &&
                compress.iterationNudgeThreshold < 1
            ) {
                errors.push({
                    key: "compress.iterationNudgeThreshold",
                    expected: "positive number (>= 1)",
                    actual: `${compress.iterationNudgeThreshold} (will be clamped to 1)`,
                })
            }

            const validateLimitValue = (
                key: string,
                value: unknown,
                actualValue: unknown = value,
            ): void => {
                const isValidNumber = typeof value === "number"
                const isPercentString = typeof value === "string" && value.endsWith("%")

                if (!isValidNumber && !isPercentString) {
                    errors.push({
                        key,
                        expected: 'number | "${number}%"',
                        actual: JSON.stringify(actualValue),
                    })
                }
            }

            const validateModelLimits = (
                key: "compress.modelMaxLimits" | "compress.modelMinLimits",
                limits: unknown,
            ): void => {
                if (limits === undefined) {
                    return
                }

                if (typeof limits !== "object" || limits === null || Array.isArray(limits)) {
                    errors.push({
                        key,
                        expected: "Record<string, number | ${number}%>",
                        actual: typeof limits,
                    })
                    return
                }

                for (const [providerModelKey, limit] of Object.entries(limits)) {
                    const isValidNumber = typeof limit === "number"
                    const isPercentString =
                        typeof limit === "string" && /^\d+(?:\.\d+)?%$/.test(limit)
                    if (!isValidNumber && !isPercentString) {
                        errors.push({
                            key: `${key}.${providerModelKey}`,
                            expected: 'number | "${number}%"',
                            actual: JSON.stringify(limit),
                        })
                    }
                }
            }

            if (compress.maxContextLimit !== undefined) {
                validateLimitValue("compress.maxContextLimit", compress.maxContextLimit)
            }

            if (compress.minContextLimit !== undefined) {
                validateLimitValue("compress.minContextLimit", compress.minContextLimit)
            }

            validateModelLimits("compress.modelMaxLimits", compress.modelMaxLimits)
            validateModelLimits("compress.modelMinLimits", compress.modelMinLimits)

            const validValues = ["ask", "allow", "deny"]
            if (compress.permission !== undefined && !validValues.includes(compress.permission)) {
                errors.push({
                    key: "compress.permission",
                    expected: '"ask" | "allow" | "deny"',
                    actual: JSON.stringify(compress.permission),
                })
            }

            if (
                compress.showCompression !== undefined &&
                typeof compress.showCompression !== "boolean"
            ) {
                errors.push({
                    key: "compress.showCompression",
                    expected: "boolean",
                    actual: typeof compress.showCompression,
                })
            }
        }
    }

    const strategies = config.strategies
    if (strategies) {
        if (
            strategies.deduplication?.enabled !== undefined &&
            typeof strategies.deduplication.enabled !== "boolean"
        ) {
            errors.push({
                key: "strategies.deduplication.enabled",
                expected: "boolean",
                actual: typeof strategies.deduplication.enabled,
            })
        }

        if (
            strategies.deduplication?.protectedTools !== undefined &&
            !Array.isArray(strategies.deduplication.protectedTools)
        ) {
            errors.push({
                key: "strategies.deduplication.protectedTools",
                expected: "string[]",
                actual: typeof strategies.deduplication.protectedTools,
            })
        }

        if (strategies.purgeErrors) {
            if (
                strategies.purgeErrors.enabled !== undefined &&
                typeof strategies.purgeErrors.enabled !== "boolean"
            ) {
                errors.push({
                    key: "strategies.purgeErrors.enabled",
                    expected: "boolean",
                    actual: typeof strategies.purgeErrors.enabled,
                })
            }

            if (
                strategies.purgeErrors.turns !== undefined &&
                typeof strategies.purgeErrors.turns !== "number"
            ) {
                errors.push({
                    key: "strategies.purgeErrors.turns",
                    expected: "number",
                    actual: typeof strategies.purgeErrors.turns,
                })
            }
            // Warn if turns is 0 or negative - will be clamped to 1
            if (
                typeof strategies.purgeErrors.turns === "number" &&
                strategies.purgeErrors.turns < 1
            ) {
                errors.push({
                    key: "strategies.purgeErrors.turns",
                    expected: "positive number (>= 1)",
                    actual: `${strategies.purgeErrors.turns} (will be clamped to 1)`,
                })
            }
            if (
                strategies.purgeErrors.protectedTools !== undefined &&
                !Array.isArray(strategies.purgeErrors.protectedTools)
            ) {
                errors.push({
                    key: "strategies.purgeErrors.protectedTools",
                    expected: "string[]",
                    actual: typeof strategies.purgeErrors.protectedTools,
                })
            }
        }
    }

    return errors
}

export const defaultConfig: PluginConfig = {
    enabled: true,
    debug: false,
    pruneNotification: "detailed",
    pruneNotificationType: "chat",
    commands: {
        enabled: true,
        protectedTools: [...DEFAULT_PROTECTED_TOOLS],
    },
    manualMode: {
        enabled: false,
        automaticStrategies: true,
    },
    turnProtection: {
        enabled: false,
        turns: DEFAULTS.turnProtectionTurns,
    },
    experimental: {
        allowSubAgents: false,
        customPrompts: false,
    },
    protectedFilePatterns: [],
    compress: {
        mode: "range",
        permission: "allow",
        showCompression: false,
        summaryBuffer: true,
        maxContextLimit: DEFAULTS.maxContextLimit,
        minContextLimit: DEFAULTS.minContextLimit,
        nudgeFrequency: DEFAULTS.nudgeFrequency,
        iterationNudgeThreshold: DEFAULTS.iterationNudgeThreshold,
        nudgeForce: "soft",
        protectedTools: [...COMPRESS_DEFAULT_PROTECTED_TOOLS],
        protectUserMessages: false,
    },
    strategies: {
        deduplication: {
            enabled: true,
            protectedTools: [],
        },
        purgeErrors: {
            enabled: true,
            turns: DEFAULTS.purgeErrorsTurns,
            protectedTools: [],
        },
    },
}
