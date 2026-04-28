import assert from "node:assert/strict"
import test from "node:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdirSync } from "node:fs"
import {
    allocateBlockId,
    allocateRunId,
    applyCompressionState,
    withPruneTransaction,
    wrapCompressedSummary,
    COMPRESSED_BLOCK_HEADER,
} from "../lib/compress/state"
import {
    buildSearchContext,
    resolveBoundaryIds,
    resolveSelection,
    resolveAnchorMessageId,
} from "../lib/compress/search"
import {
    appendProtectedTools,
    appendProtectedUserMessages,
} from "../lib/compress/protected-content"
import { prepareSession, finalizeSession } from "../lib/compress/pipeline"
import { parseBoundaryId } from "../lib/message-ids"
import { createSessionState, type WithParts } from "../lib/state"
import { Logger } from "../lib/logger"
import type {
    CompressionStateInput,
    SelectionResolution,
    ToolContext,
} from "../lib/compress/types"
import { buildConfig, textPart, toolPart } from "./helpers/index.js"

const testDataHome = join(tmpdir(), `opencode-dcp-engine-tests-${process.pid}`)
const testConfigHome = join(tmpdir(), `opencode-dcp-engine-config-tests-${process.pid}`)

process.env.XDG_DATA_HOME = testDataHome
process.env.XDG_CONFIG_HOME = testConfigHome

mkdirSync(testDataHome, { recursive: true })
mkdirSync(testConfigHome, { recursive: true })

function buildMessage(
    id: string,
    role: "user" | "assistant",
    sessionID: string,
    parts: any[],
    created: number,
): WithParts {
    const info: any = {
        id,
        role,
        sessionID,
        agent: "assistant",
        time: { created },
    }
    if (role === "user") {
        info.model = { providerID: "anthropic", modelID: "claude-test" }
    }
    return { info, parts }
}

function buildBaseMessages(sessionID: string): WithParts[] {
    return [
        buildMessage("msg-user-1", "user", sessionID, [
            textPart("msg-user-1", sessionID, "p1", "Initial user prompt"),
        ], 1),
        buildMessage("msg-assistant-1", "assistant", sessionID, [
            textPart("msg-assistant-1", sessionID, "p2", "Assistant response one"),
        ], 2),
        buildMessage("msg-assistant-2", "assistant", sessionID, [
            textPart("msg-assistant-2", sessionID, "p3", "Assistant response two"),
            toolPart("msg-assistant-2", sessionID, "call-task-1", "task", "task output payload"),
        ], 3),
    ]
}

function buildSelection(messageIds: string[], toolIds: string[] = []): SelectionResolution {
    const tokenMap = new Map<string, number>()
    for (const id of messageIds) {
        tokenMap.set(id, 10)
    }
    return {
        startReference: { kind: "message", rawIndex: 0, messageId: messageIds[0] },
        endReference: {
            kind: "message",
            rawIndex: messageIds.length - 1,
            messageId: messageIds[messageIds.length - 1],
        },
        messageIds: [...messageIds],
        messageTokenById: tokenMap,
        toolIds: [...toolIds],
        requiredBlockIds: [],
    }
}

function buildStateInput(
    overrides: Partial<CompressionStateInput> = {},
): CompressionStateInput {
    return {
        topic: "test topic",
        batchTopic: "batch topic",
        startId: "m0001",
        endId: "m0002",
        mode: "range",
        runId: 1,
        compressMessageId: "msg-compress",
        compressCallId: "call-compress",
        summaryTokens: 5,
        ...overrides,
    }
}

// --- state.ts -----------------------------------------------------------

test("allocateBlockId increments and recovers from invalid counter", () => {
    const state = createSessionState()
    assert.equal(allocateBlockId(state), 1)
    assert.equal(allocateBlockId(state), 2)
    assert.equal(state.prune.messages.nextBlockId, 3)

    state.prune.messages.nextBlockId = 0 as any
    assert.equal(allocateBlockId(state), 1)
    assert.equal(state.prune.messages.nextBlockId, 2)
})

test("allocateRunId increments and recovers from invalid counter", () => {
    const state = createSessionState()
    assert.equal(allocateRunId(state), 1)
    assert.equal(allocateRunId(state), 2)
    assert.equal(state.prune.messages.nextRunId, 3)

    state.prune.messages.nextRunId = -5 as any
    assert.equal(allocateRunId(state), 1)
    assert.equal(state.prune.messages.nextRunId, 2)
})

test("wrapCompressedSummary embeds header, body and block id tag", () => {
    const wrapped = wrapCompressedSummary(7, "  some summary body  ")
    assert.match(wrapped, new RegExp(`^\\[Compressed conversation section\\]\\n`))
    assert.match(wrapped, /some summary body/)
    assert.match(wrapped, /<dcp-message-id>b7<\/dcp-message-id>/)

    const empty = wrapCompressedSummary(3, "   ")
    assert.match(empty, /<dcp-message-id>b3<\/dcp-message-id>/)
    assert.doesNotMatch(empty, /summary/)
})

test("applyCompressionState registers block, updates active sets and message map", () => {
    const state = createSessionState()
    const blockId = allocateBlockId(state)
    const selection = buildSelection(["msg-a", "msg-b"], ["call-1"])
    const result = applyCompressionState(
        state,
        buildStateInput(),
        selection,
        "msg-a",
        blockId,
        "summary text",
        [],
    )

    const messagesState = state.prune.messages
    const block = messagesState.blocksById.get(blockId)
    assert.ok(block, "block must be registered")
    assert.equal(block?.active, true)
    assert.deepEqual(block?.effectiveMessageIds.sort(), ["msg-a", "msg-b"])
    assert.deepEqual(block?.effectiveToolIds, ["call-1"])
    assert.equal(block?.summary, "summary text")
    assert.equal(messagesState.activeBlockIds.has(blockId), true)
    assert.equal(messagesState.activeByAnchorMessageId.get("msg-a"), blockId)

    const entryA = messagesState.byMessageId.get("msg-a")
    assert.deepEqual(entryA?.activeBlockIds, [blockId])
    assert.deepEqual(entryA?.allBlockIds, [blockId])
    assert.equal(entryA?.tokenCount, 10)

    assert.deepEqual(result.newlyCompressedMessageIds.sort(), ["msg-a", "msg-b"])
    assert.deepEqual(result.newlyCompressedToolIds, ["call-1"])
})

test("applyCompressionState consumes prior block, deactivating it and merging coverage", () => {
    const state = createSessionState()
    const firstId = allocateBlockId(state)
    applyCompressionState(
        state,
        buildStateInput({ runId: allocateRunId(state) }),
        buildSelection(["msg-a"], ["call-old"]),
        "msg-a",
        firstId,
        "first summary",
        [],
    )

    const secondId = allocateBlockId(state)
    const result = applyCompressionState(
        state,
        buildStateInput({ runId: allocateRunId(state), startId: "m0001", endId: "m0003" }),
        buildSelection(["msg-a", "msg-b", "msg-c"], ["call-new"]),
        "msg-a",
        secondId,
        "second summary",
        [firstId],
    )

    const messagesState = state.prune.messages
    const firstBlock = messagesState.blocksById.get(firstId)
    const secondBlock = messagesState.blocksById.get(secondId)
    assert.equal(firstBlock?.active, false)
    assert.equal(firstBlock?.deactivatedByBlockId, secondId)
    assert.equal(firstBlock?.parentBlockIds.includes(secondId), true)
    assert.equal(messagesState.activeBlockIds.has(firstId), false)
    assert.equal(messagesState.activeBlockIds.has(secondId), true)
    assert.deepEqual(secondBlock?.consumedBlockIds, [firstId])
    assert.equal(secondBlock?.effectiveToolIds.includes("call-old"), true)
    assert.equal(secondBlock?.effectiveToolIds.includes("call-new"), true)

    const entryA = messagesState.byMessageId.get("msg-a")
    assert.deepEqual(entryA?.activeBlockIds, [secondId])
    assert.equal(entryA?.allBlockIds.includes(firstId), true)
    assert.equal(entryA?.allBlockIds.includes(secondId), true)
    // newly compressed counts only previously inactive coverage
    assert.equal(result.newlyCompressedMessageIds.includes("msg-b"), true)
    assert.equal(result.newlyCompressedMessageIds.includes("msg-c"), true)
})

test("withPruneTransaction rolls back state on failure", async () => {
    const state = createSessionState()
    const beforeBlockId = state.prune.messages.nextBlockId
    const beforeRunId = state.prune.messages.nextRunId
    const beforeStats = state.stats.totalPruneTokens

    await assert.rejects(
        withPruneTransaction(state, async () => {
            const blockId = allocateBlockId(state)
            allocateRunId(state)
            applyCompressionState(
                state,
                buildStateInput(),
                buildSelection(["msg-a", "msg-b"]),
                "msg-a",
                blockId,
                "scratch",
                [],
            )
            assert.equal(state.prune.messages.blocksById.size, 1)
            throw new Error("boom")
        }),
        /boom/,
    )

    assert.equal(state.prune.messages.nextBlockId, beforeBlockId)
    assert.equal(state.prune.messages.nextRunId, beforeRunId)
    assert.equal(state.prune.messages.blocksById.size, 0)
    assert.equal(state.prune.messages.activeBlockIds.size, 0)
    assert.equal(state.prune.messages.activeByAnchorMessageId.size, 0)
    assert.equal(state.prune.messages.byMessageId.size, 0)
    assert.equal(state.stats.totalPruneTokens, beforeStats)
})

test("withPruneTransaction commits successful work", async () => {
    const state = createSessionState()
    const result = await withPruneTransaction(state, async () => {
        const blockId = allocateBlockId(state)
        allocateRunId(state)
        applyCompressionState(
            state,
            buildStateInput(),
            buildSelection(["msg-a"]),
            "msg-a",
            blockId,
            "ok",
            [],
        )
        return blockId
    })

    assert.equal(result, 1)
    assert.equal(state.prune.messages.blocksById.size, 1)
    assert.equal(state.prune.messages.activeBlockIds.has(1), true)
})

// --- search.ts ----------------------------------------------------------

test("parseBoundaryId accepts mNNNN and bN forms, rejects junk", () => {
    const message = parseBoundaryId("m0001")
    assert.equal(message?.kind, "message")
    if (message?.kind === "message") {
        assert.equal(message.index, 1)
        assert.equal(message.ref, "m0001")
    }

    const block = parseBoundaryId("b42")
    assert.equal(block?.kind, "compressed-block")
    if (block?.kind === "compressed-block") {
        assert.equal(block.blockId, 42)
        assert.equal(block.ref, "b42")
    }

    assert.equal(parseBoundaryId("not-an-id"), null)
    assert.equal(parseBoundaryId("m99999"), null)
    assert.equal(parseBoundaryId("b0"), null)
    assert.equal(parseBoundaryId(""), null)
})

test("buildSearchContext indexes raw messages and active blocks", () => {
    const sessionID = "ses_search_ctx"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    state.messageIds.byRef.set("m0001", "msg-user-1")
    state.messageIds.byRef.set("m0002", "msg-assistant-1")

    const ctx = buildSearchContext(state, rawMessages)
    assert.equal(ctx.rawMessages.length, 3)
    assert.equal(ctx.rawMessagesById.get("msg-assistant-1")?.info.id, "msg-assistant-1")
    assert.equal(ctx.rawIndexById.get("msg-assistant-2"), 2)
    assert.equal(ctx.summaryByBlockId.size, 0)
})

test("resolveBoundaryIds resolves valid mNNNN refs to raw indices", () => {
    const sessionID = "ses_resolve"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    state.messageIds.byRef.set("m0001", "msg-user-1")
    state.messageIds.byRef.set("m0002", "msg-assistant-1")
    state.messageIds.byRef.set("m0003", "msg-assistant-2")
    state.messageIds.byRawId.set("msg-user-1", "m0001")
    state.messageIds.byRawId.set("msg-assistant-1", "m0002")
    state.messageIds.byRawId.set("msg-assistant-2", "m0003")

    const ctx = buildSearchContext(state, rawMessages)
    const { startReference, endReference } = resolveBoundaryIds(ctx, state, "m0002", "m0003")
    assert.equal(startReference.kind, "message")
    assert.equal(startReference.messageId, "msg-assistant-1")
    assert.equal(startReference.rawIndex, 1)
    assert.equal(endReference.messageId, "msg-assistant-2")
    assert.equal(endReference.rawIndex, 2)
})

test("resolveBoundaryIds throws when start > end ordering is wrong", () => {
    const sessionID = "ses_resolve_order"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    state.messageIds.byRef.set("m0002", "msg-assistant-1")
    state.messageIds.byRef.set("m0003", "msg-assistant-2")
    state.messageIds.byRawId.set("msg-assistant-1", "m0002")
    state.messageIds.byRawId.set("msg-assistant-2", "m0003")

    const ctx = buildSearchContext(state, rawMessages)
    assert.throws(
        () => resolveBoundaryIds(ctx, state, "m0003", "m0002"),
        /appears after endId/,
    )
})

test("resolveBoundaryIds throws on invalid id format", () => {
    const sessionID = "ses_resolve_invalid"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    const ctx = buildSearchContext(state, rawMessages)
    assert.throws(
        () => resolveBoundaryIds(ctx, state, "garbage", "m0002"),
        /startId is invalid/,
    )
})

test("resolveBoundaryIds throws when ref is unknown", () => {
    const sessionID = "ses_resolve_unknown"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    state.messageIds.byRef.set("m0002", "msg-assistant-1")
    state.messageIds.byRawId.set("msg-assistant-1", "m0002")
    const ctx = buildSearchContext(state, rawMessages)
    assert.throws(
        () => resolveBoundaryIds(ctx, state, "m0099", "m0002"),
        /not available in the current conversation context/,
    )
})

test("resolveSelection collects message and tool ids inside the boundary range", () => {
    const sessionID = "ses_selection"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    state.messageIds.byRef.set("m0001", "msg-user-1")
    state.messageIds.byRef.set("m0002", "msg-assistant-1")
    state.messageIds.byRef.set("m0003", "msg-assistant-2")
    state.messageIds.byRawId.set("msg-user-1", "m0001")
    state.messageIds.byRawId.set("msg-assistant-1", "m0002")
    state.messageIds.byRawId.set("msg-assistant-2", "m0003")

    const ctx = buildSearchContext(state, rawMessages)
    const { startReference, endReference } = resolveBoundaryIds(ctx, state, "m0002", "m0003")
    const selection = resolveSelection(ctx, startReference, endReference)
    assert.deepEqual(selection.messageIds, ["msg-assistant-1", "msg-assistant-2"])
    assert.deepEqual(selection.toolIds, ["call-task-1"])
    assert.equal(selection.messageTokenById.size, 2)
})

test("resolveAnchorMessageId returns messageId for message references", () => {
    const id = resolveAnchorMessageId({
        kind: "message",
        rawIndex: 0,
        messageId: "msg-anchor",
    })
    assert.equal(id, "msg-anchor")
})

test("resolveAnchorMessageId throws when message reference lacks id", () => {
    assert.throws(
        () => resolveAnchorMessageId({ kind: "message", rawIndex: 0 }),
        /Failed to map boundary matches/,
    )
})

// --- protected-content.ts ----------------------------------------------

test("appendProtectedTools appends matching tool outputs to summary", async () => {
    const sessionID = "ses_protected"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    const ctx = buildSearchContext(state, rawMessages)
    const selection = buildSelection(["msg-assistant-1", "msg-assistant-2"], ["call-task-1"])

    const result = await appendProtectedTools(
        {},
        state,
        false,
        "base summary",
        selection,
        ctx,
        ["task"],
        [],
    )

    assert.match(result, /^base summary/)
    assert.match(result, /protected tools were used/)
    assert.match(result, /Tool: task/)
    assert.match(result, /task output payload/)
})

test("appendProtectedTools returns summary unchanged when no tool matches", async () => {
    const sessionID = "ses_protected_none"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    const ctx = buildSearchContext(state, rawMessages)
    const selection = buildSelection(["msg-assistant-2"], ["call-task-1"])

    const result = await appendProtectedTools(
        {},
        state,
        false,
        "base summary",
        selection,
        ctx,
        ["edit"],
        [],
    )

    assert.equal(result, "base summary")
})

test("appendProtectedTools skips messages already covered by an active block", async () => {
    const sessionID = "ses_protected_skip"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    state.prune.messages.byMessageId.set("msg-assistant-2", {
        tokenCount: 10,
        allBlockIds: [1],
        activeBlockIds: [1],
    })
    const ctx = buildSearchContext(state, rawMessages)
    const selection = buildSelection(["msg-assistant-2"], ["call-task-1"])

    const result = await appendProtectedTools(
        {},
        state,
        false,
        "base summary",
        selection,
        ctx,
        ["task"],
        [],
    )

    assert.equal(result, "base summary")
})

test("appendProtectedUserMessages preserves user prompts when enabled", () => {
    const sessionID = "ses_user_preserve"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    const ctx = buildSearchContext(state, rawMessages)
    const selection = buildSelection(["msg-user-1", "msg-assistant-1"], [])

    const enabled = appendProtectedUserMessages("base", selection, ctx, state, true)
    assert.match(enabled, /^base/)
    assert.match(enabled, /user messages were sent in this conversation verbatim/)
    assert.match(enabled, /Initial user prompt/)

    const disabled = appendProtectedUserMessages("base", selection, ctx, state, false)
    assert.equal(disabled, "base")
})

// --- pipeline.ts --------------------------------------------------------

function buildToolCtx(state: ReturnType<typeof createSessionState>): ToolContext {
    return {
        client: {
            session: {
                messages: async () => ({ data: [] as WithParts[] }),
                get: async () => ({ data: { parentID: null } }),
            },
        },
        state,
        logger: new Logger(false),
        config: buildConfig(),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressMessage: "", compressRange: "" }
            },
        } as any,
    }
}

test("prepareSession aborts when manual mode is active and not pending", async () => {
    const state = createSessionState()
    state.manualMode = "active"
    const toolCtx = buildToolCtx(state)
    const askCalls: any[] = []
    const runCtx = {
        ask: async (input: any) => {
            askCalls.push(input)
        },
        metadata: () => {},
        sessionID: "ses_manual_block",
    }

    await assert.rejects(
        prepareSession(toolCtx, runCtx as any, "title"),
        /Manual mode: compress blocked/,
    )
    assert.equal(askCalls.length, 0)
})

test("prepareSession requests permission, fetches messages and assigns refs", async () => {
    const sessionID = "ses_pipeline_prep"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    const askArgs: any[] = []
    const metadataArgs: any[] = []
    const toolCtx: ToolContext = {
        client: {
            session: {
                messages: async () => ({ data: rawMessages }),
                get: async () => ({ data: { parentID: null } }),
            },
        },
        state,
        logger: new Logger(false),
        config: buildConfig(),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressMessage: "", compressRange: "" }
            },
        } as any,
    }
    const runCtx = {
        ask: async (input: any) => {
            askArgs.push(input)
        },
        metadata: (input: any) => {
            metadataArgs.push(input)
        },
        sessionID,
    }

    const prepared = await prepareSession(toolCtx, runCtx as any, "compress title")

    assert.equal(askArgs.length, 1)
    assert.equal(askArgs[0].permission, "compress")
    assert.deepEqual(metadataArgs, [{ title: "compress title" }])
    assert.equal(prepared.rawMessages.length, rawMessages.length)
    assert.equal(prepared.searchContext.rawMessages.length, rawMessages.length)
    assert.equal(state.sessionId, sessionID)
    // assignMessageRefs should have populated message id state for non-ignored messages
    assert.ok(state.messageIds.byRef.size > 0)
})

test("prepareSession rejects when permission ask throws", async () => {
    const state = createSessionState()
    const toolCtx = buildToolCtx(state)
    const runCtx = {
        ask: async () => {
            throw new Error("denied")
        },
        metadata: () => {},
        sessionID: "ses_perm_fail",
    }
    await assert.rejects(
        prepareSession(toolCtx, runCtx as any, "title"),
        /Compress permission request failed/,
    )
})

test("finalizeSession resets manual mode and applies pending compression durations", async () => {
    const sessionID = "ses_finalize"
    const rawMessages = buildBaseMessages(sessionID)
    const state = createSessionState()
    state.sessionId = sessionID
    state.manualMode = "compress-pending"
    // Seed a block with a matching pending duration
    state.prune.messages.blocksById.set(1, {
        blockId: 1,
        runId: 1,
        active: true,
        deactivatedByUser: false,
        compressedTokens: 0,
        summaryTokens: 0,
        durationMs: 0,
        topic: "t",
        startId: "m0001",
        endId: "m0002",
        anchorMessageId: "msg-user-1",
        compressMessageId: "msg-compress",
        compressCallId: "call-x",
        includedBlockIds: [],
        consumedBlockIds: [],
        parentBlockIds: [],
        directMessageIds: [],
        directToolIds: [],
        effectiveMessageIds: ["msg-user-1"],
        effectiveToolIds: [],
        createdAt: Date.now(),
        summary: "s",
    })
    state.compressionTiming.pendingByCallId.set("call-x", {
        messageId: "msg-compress",
        callId: "call-x",
        durationMs: 1234,
    })

    const toolCtx: ToolContext = {
        client: {
            session: {
                messages: async () => ({ data: rawMessages }),
                get: async () => ({ data: { parentID: null } }),
            },
            tui: {
                showToast: async () => {},
            },
        },
        state,
        logger: new Logger(false),
        config: buildConfig(),
        prompts: {
            reload() {},
            getRuntimePrompts() {
                return { compressMessage: "", compressRange: "" }
            },
        } as any,
    }
    const runCtx = {
        ask: async () => {},
        metadata: () => {},
        sessionID,
    }

    await finalizeSession(toolCtx, runCtx as any, rawMessages, [], undefined)

    assert.equal(state.manualMode, "active")
    assert.equal(state.prune.messages.blocksById.get(1)?.durationMs, 1234)
})
