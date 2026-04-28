import type { SessionState } from "../state"
import type { Logger } from "../logger"
import type { PluginConfig } from "../config"
import { handleManualTriggerCommand } from "./manual"

interface CompressCommandContext {
    client: any
    state: SessionState
    config: PluginConfig
    logger: Logger
    sessionId: string
    messages: any[]
}

interface CompressCommandInput {
    arguments: string
    sessionID: string
    subcommand: string
    subArgs: string[]
}

interface CompressCommandOutput {
    parts: any[]
}

export async function handleCompressCommand(
    ctx: CompressCommandContext,
    input: CompressCommandInput,
    output: CompressCommandOutput,
): Promise<void> {
    const userFocus = input.subArgs.join(" ").trim()
    const prompt = await handleManualTriggerCommand(ctx, "compress", userFocus)
    if (!prompt) {
        throw new Error("__DCP_MANUAL_TRIGGER_BLOCKED__")
    }

    ctx.state.manualMode = "compress-pending"
    ctx.state.pendingManualTrigger = {
        sessionId: input.sessionID,
        prompt,
    }
    const rawArgs = (input.arguments || "").trim()
    output.parts.length = 0
    output.parts.push({
        type: "text",
        text: rawArgs ? `/dcp ${rawArgs}` : `/dcp ${input.subcommand}`,
    })
}
