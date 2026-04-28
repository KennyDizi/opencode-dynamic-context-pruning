import assert from "node:assert/strict"
import test from "node:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdirSync } from "node:fs"

const testDataHome = join(tmpdir(), `opencode-dcp-commands-tests-${process.pid}`)
const testConfigHome = join(tmpdir(), `opencode-dcp-commands-config-tests-${process.pid}`)

process.env.XDG_DATA_HOME = testDataHome
process.env.XDG_CONFIG_HOME = testConfigHome

mkdirSync(testDataHome, { recursive: true })
mkdirSync(testConfigHome, { recursive: true })

import { handleContextCommand } from "../lib/commands/context"
import { handleSweepCommand } from "../lib/commands/sweep"
import { handleDecompressCommand } from "../lib/commands/decompress"
import { handleRecompressCommand } from "../lib/commands/recompress"
import { Logger } from "../lib/logger"
import { createSessionState, type CompressionBlock, type WithParts } from "../lib/state"
import { buildConfig, textPart, toolPart } from "./helpers"

interface CapturedPrompt {
    sessionId: string
    text: string
}

function createMockClient(): { client: { session: any }; captured: CapturedPrompt[] } {
    const captured: CapturedPrompt[] = []
    const client = {
        session: {
            prompt: async (req: { path: { id: string }; body: { parts: any[] } }) => {
                const part = req.body.parts[0]
                captured.push({
                    sessionId: req.path.id,
                    text: typeof part?.text === "string" ? part.text : "",
                })
            },
        },
    }
    return { client, captured }
}

function buildUserMessage(
    id: string,
    sessionID: string,
    created: number,
    text: string = "user message",
): WithParts {
    return {
        info: {
            id,
            role: "user",
            sessionID,
            agent: "assistant",
            model: { providerID: "anthropic", modelID: "claude-test" },
            time: { created },
        } as WithParts["info"],
        parts: [textPart(id, sessionID, `${id}-part`, text)],
    }
}

function buildAssistantMessage(
    id: string,
    sessionID: string,
    created: number,
    parts: any[],
): WithParts {
    return {
        info: {
            id,
            role: "assistant",
            sessionID,
            agent: "assistant",
            time: { created },
            tokens: {
                input: 1000,
                output: 200,
                reasoning: 0,
                cache: { read: 0, write: 0 },
            },
        } as WithParts["info"],
        parts,
    }
}

function buildBlock(overrides: Partial<CompressionBlock> & { blockId: number }): CompressionBlock {
    const blockId = overrides.blockId
    return {
        blockId,
        runId: blockId,
        active: true,
        deactivatedByUser: false,
        compressedTokens: 500,
        summaryTokens: 50,
        durationMs: 100,
        mode: "range",
        topic: `topic-${blockId}`,
        batchTopic: `topic-${blockId}`,
        startId: `m000${blockId}`,
        endId: `m000${blockId}`,
        anchorMessageId: `msg-anchor-${blockId}`,
        compressMessageId: `msg-origin-${blockId}`,
        includedBlockIds: [],
        consumedBlockIds: [],
        parentBlockIds: [],
        directMessageIds: [],
        directToolIds: [],
        effectiveMessageIds: [],
        effectiveToolIds: [],
        createdAt: blockId,
        summary: `summary-${blockId}`,
        ...overrides,
    }
}

// =================== /dcp context ===================

test("handleContextCommand returns a breakdown summary for a normal session", async () => {
    const sessionID = "ses_cmd_context_normal"
    const state = createSessionState()
    state.sessionId = sessionID
    state.stats.totalPruneTokens = 1234

    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1, "hello world"),
        buildAssistantMessage("a1", sessionID, 2, [
            textPart("a1", sessionID, "a1-part", "Sure, here is the answer."),
        ]),
    ]
    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleContextCommand({
        client,
        state,
        logger,
        sessionId: sessionID,
        messages,
    })

    assert.equal(captured.length, 1)
    const out = captured[0].text
    assert.match(out, /DCP Context Analysis/)
    assert.match(out, /System/)
    assert.match(out, /User/)
    assert.match(out, /Assistant/)
    assert.match(out, /Tools/)
    assert.match(out, /Pruned:/)
})

test("handleContextCommand handles an empty session gracefully", async () => {
    const sessionID = "ses_cmd_context_empty"
    const state = createSessionState()
    state.sessionId = sessionID

    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleContextCommand({
        client,
        state,
        logger,
        sessionId: sessionID,
        messages: [],
    })

    assert.equal(captured.length, 1)
    const out = captured[0].text
    assert.match(out, /DCP Context Analysis/)
    assert.match(out, /Current context: ~0/)
    // No "Pruned" line when stats.totalPruneTokens === 0
    assert.equal(out.includes("Pruned:"), false)
})

// =================== /dcp sweep ===================

test("handleSweepCommand prunes tools issued since the last user message", async () => {
    const sessionID = "ses_cmd_sweep_basic"
    const state = createSessionState()
    state.sessionId = sessionID

    const tool1 = toolPart("a1", sessionID, "call-1", "read", "result-1")
    const tool2 = toolPart("a1", sessionID, "call-2", "grep", "result-2")
    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1),
        buildAssistantMessage("a1", sessionID, 2, [tool1, tool2]),
    ]
    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleSweepCommand({
        client,
        state,
        config: buildConfig(),
        logger,
        sessionId: sessionID,
        messages,
        args: [],
        workingDirectory: process.cwd(),
    })

    assert.equal(captured.length, 1)
    assert.match(captured[0].text, /DCP Sweep/)
    assert.match(captured[0].text, /Swept 2 tool\(s\)/)
    assert.equal(state.prune.tools.has("call-1"), true)
    assert.equal(state.prune.tools.has("call-2"), true)
})

test("handleSweepCommand reports nothing to sweep when no tools follow the user message", async () => {
    const sessionID = "ses_cmd_sweep_empty"
    const state = createSessionState()
    state.sessionId = sessionID

    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1),
        buildAssistantMessage("a1", sessionID, 2, [
            textPart("a1", sessionID, "a1-part", "Just text, no tools."),
        ]),
    ]
    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleSweepCommand({
        client,
        state,
        config: buildConfig(),
        logger,
        sessionId: sessionID,
        messages,
        args: [],
        workingDirectory: process.cwd(),
    })

    assert.equal(captured.length, 1)
    assert.match(captured[0].text, /No tools found/)
    assert.equal(state.prune.tools.size, 0)
})

test("handleSweepCommand reports no user message when there are none", async () => {
    const sessionID = "ses_cmd_sweep_no_user"
    const state = createSessionState()
    state.sessionId = sessionID

    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleSweepCommand({
        client,
        state,
        config: buildConfig(),
        logger,
        sessionId: sessionID,
        messages: [],
        args: [],
        workingDirectory: process.cwd(),
    })

    assert.equal(captured.length, 1)
    assert.match(captured[0].text, /no user message found/)
})

// =================== /dcp decompress ===================

test("handleDecompressCommand lists available compressions when called with no args", async () => {
    const sessionID = "ses_cmd_decompress_list"
    const state = createSessionState()
    state.sessionId = sessionID

    const block = buildBlock({
        blockId: 1,
        active: true,
        compressMessageId: "msg-origin-1",
        anchorMessageId: "msg-anchor-1",
        topic: "Closed exploration",
    })
    state.prune.messages.blocksById.set(1, block)
    state.prune.messages.activeBlockIds.add(1)

    const messages: WithParts[] = [
        buildUserMessage("msg-anchor-1", sessionID, 1),
        buildAssistantMessage("msg-origin-1", sessionID, 2, [
            textPart("msg-origin-1", sessionID, "msg-origin-1-part", "compress origin"),
        ]),
    ]
    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleDecompressCommand({
        client,
        state,
        logger,
        sessionId: sessionID,
        messages,
        args: [],
    })

    assert.equal(captured.length, 1)
    assert.match(captured[0].text, /Usage: \/dcp decompress/)
    assert.match(captured[0].text, /Closed exploration/)
})

test("handleDecompressCommand deactivates the requested block", async () => {
    const sessionID = "ses_cmd_decompress_apply"
    const state = createSessionState()
    state.sessionId = sessionID

    const block = buildBlock({
        blockId: 2,
        active: true,
        compressMessageId: "msg-origin-2",
        anchorMessageId: "msg-anchor-2",
    })
    state.prune.messages.blocksById.set(2, block)
    state.prune.messages.activeBlockIds.add(2)
    state.prune.messages.byMessageId.set("msg-anchor-2", {
        tokenCount: 300,
        allBlockIds: [2],
        activeBlockIds: [2],
    })

    const messages: WithParts[] = [
        buildUserMessage("msg-anchor-2", sessionID, 1),
        buildAssistantMessage("msg-origin-2", sessionID, 2, [
            textPart("msg-origin-2", sessionID, "msg-origin-2-part", "compress origin"),
        ]),
    ]
    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleDecompressCommand({
        client,
        state,
        logger,
        sessionId: sessionID,
        messages,
        args: ["2"],
    })

    const stored = state.prune.messages.blocksById.get(2)
    assert.ok(stored)
    assert.equal(stored.active, false)
    assert.equal(stored.deactivatedByUser, true)
    assert.equal(state.prune.messages.activeBlockIds.has(2), false)
    assert.equal(captured.length, 1)
    assert.match(captured[0].text, /Restored compression 2/)
})

test("handleDecompressCommand reports an error for an unknown block id", async () => {
    const sessionID = "ses_cmd_decompress_unknown"
    const state = createSessionState()
    state.sessionId = sessionID

    // Have at least one real block so messagesState.blocksById is non-empty (so sync activates)
    const block = buildBlock({
        blockId: 1,
        compressMessageId: "msg-origin-1",
        anchorMessageId: "msg-anchor-1",
    })
    state.prune.messages.blocksById.set(1, block)

    const messages: WithParts[] = [
        buildUserMessage("msg-anchor-1", sessionID, 1),
        buildAssistantMessage("msg-origin-1", sessionID, 2, [
            textPart("msg-origin-1", sessionID, "msg-origin-1-part", "compress origin"),
        ]),
    ]
    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleDecompressCommand({
        client,
        state,
        logger,
        sessionId: sessionID,
        messages,
        args: ["999"],
    })

    assert.equal(captured.length, 1)
    assert.match(captured[0].text, /Compression 999 does not exist/)
})

// =================== /dcp recompress ===================

test("handleRecompressCommand lists user-decompressed blocks when called with no args", async () => {
    const sessionID = "ses_cmd_recompress_list"
    const state = createSessionState()
    state.sessionId = sessionID

    const block = buildBlock({
        blockId: 5,
        active: false,
        deactivatedByUser: true,
        deactivatedAt: 1,
        compressMessageId: "msg-origin-5",
        anchorMessageId: "msg-anchor-5",
        topic: "User-restored region",
    })
    state.prune.messages.blocksById.set(5, block)

    const messages: WithParts[] = [
        buildUserMessage("msg-anchor-5", sessionID, 1),
        buildAssistantMessage("msg-origin-5", sessionID, 2, [
            textPart("msg-origin-5", sessionID, "msg-origin-5-part", "compress origin"),
        ]),
    ]
    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleRecompressCommand({
        client,
        state,
        logger,
        sessionId: sessionID,
        messages,
        args: [],
    })

    assert.equal(captured.length, 1)
    assert.match(captured[0].text, /Usage: \/dcp recompress/)
    assert.match(captured[0].text, /User-restored region/)
})

test("handleRecompressCommand re-activates a previously user-decompressed block", async () => {
    const sessionID = "ses_cmd_recompress_apply"
    const state = createSessionState()
    state.sessionId = sessionID

    const block = buildBlock({
        blockId: 6,
        active: false,
        deactivatedByUser: true,
        deactivatedAt: 1,
        compressMessageId: "msg-origin-6",
        anchorMessageId: "msg-anchor-6",
    })
    state.prune.messages.blocksById.set(6, block)

    const messages: WithParts[] = [
        buildUserMessage("msg-anchor-6", sessionID, 1),
        buildAssistantMessage("msg-origin-6", sessionID, 2, [
            textPart("msg-origin-6", sessionID, "msg-origin-6-part", "compress origin"),
        ]),
    ]
    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleRecompressCommand({
        client,
        state,
        logger,
        sessionId: sessionID,
        messages,
        args: ["6"],
    })

    const stored = state.prune.messages.blocksById.get(6)
    assert.ok(stored)
    assert.equal(stored.active, true)
    assert.equal(stored.deactivatedByUser, false)
    assert.ok(state.prune.messages.activeBlockIds.has(6))
    assert.equal(captured.length, 1)
    assert.match(captured[0].text, /Re-applied compression 6/)
})

test("handleRecompressCommand reports an error for an unknown block id", async () => {
    const sessionID = "ses_cmd_recompress_unknown"
    const state = createSessionState()
    state.sessionId = sessionID

    const block = buildBlock({
        blockId: 1,
        compressMessageId: "msg-origin-1",
        anchorMessageId: "msg-anchor-1",
    })
    state.prune.messages.blocksById.set(1, block)

    const messages: WithParts[] = [
        buildUserMessage("msg-anchor-1", sessionID, 1),
        buildAssistantMessage("msg-origin-1", sessionID, 2, [
            textPart("msg-origin-1", sessionID, "msg-origin-1-part", "compress origin"),
        ]),
    ]
    const { client, captured } = createMockClient()
    const logger = new Logger(false)

    await handleRecompressCommand({
        client,
        state,
        logger,
        sessionId: sessionID,
        messages,
        args: ["999"],
    })

    assert.equal(captured.length, 1)
    assert.match(captured[0].text, /Compression 999 does not exist/)
})
