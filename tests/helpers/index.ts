import type { PluginConfig } from "../../lib/config"

export interface BuildConfigOverrides {
    mode?: PluginConfig["compress"]["mode"]
    permission?: PluginConfig["compress"]["permission"]
    allowSubAgents?: boolean
    protectedTools?: string[]
    summaryBuffer?: boolean
    maxContextLimit?: PluginConfig["compress"]["maxContextLimit"]
    minContextLimit?: PluginConfig["compress"]["minContextLimit"]
}

export function buildConfig(overrides: BuildConfigOverrides = {}): PluginConfig {
    return {
        enabled: true,
        debug: false,
        pruneNotification: "off",
        pruneNotificationType: "chat",
        commands: {
            enabled: true,
            protectedTools: [],
        },
        manualMode: {
            enabled: false,
            automaticStrategies: true,
        },
        turnProtection: {
            enabled: false,
            turns: 4,
        },
        experimental: {
            allowSubAgents: overrides.allowSubAgents ?? false,
            customPrompts: false,
        },
        protectedFilePatterns: [],
        compress: {
            mode: overrides.mode ?? "message",
            permission: overrides.permission ?? "allow",
            showCompression: false,
            summaryBuffer: overrides.summaryBuffer ?? false,
            maxContextLimit: overrides.maxContextLimit ?? 150000,
            minContextLimit: overrides.minContextLimit ?? 50000,
            nudgeFrequency: 5,
            iterationNudgeThreshold: 15,
            nudgeForce: "soft",
            protectedTools: overrides.protectedTools ?? ["task"],
            protectUserMessages: false,
        },
        strategies: {
            deduplication: {
                enabled: true,
                protectedTools: [],
            },
            purgeErrors: {
                enabled: true,
                turns: 4,
                protectedTools: [],
            },
        },
    }
}

export function textPart(messageID: string, sessionID: string, id: string, text: string) {
    return {
        id,
        messageID,
        sessionID,
        type: "text" as const,
        text,
    }
}

export function toolPart(
    messageID: string,
    sessionID: string,
    callID: string,
    toolName: string,
    output: string,
) {
    return {
        id: `${callID}-part`,
        messageID,
        sessionID,
        type: "tool" as const,
        tool: toolName,
        callID,
        state: {
            status: "completed" as const,
            input: { description: "demo" },
            output,
        },
    }
}

export function repeatedWord(word: string, count: number): string {
    return Array.from({ length: count }, () => word).join(" ")
}
