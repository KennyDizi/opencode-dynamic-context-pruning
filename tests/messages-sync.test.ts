import assert from "node:assert/strict"
import test from "node:test"
import { syncCompressionBlocks } from "../lib/messages/sync"
import { Logger } from "../lib/logger"
import { createSessionState, type CompressionBlock, type WithParts } from "../lib/state"
import { textPart } from "./helpers"

function buildBlock(overrides: Partial<CompressionBlock> & { blockId: number }): CompressionBlock {
    const blockId = overrides.blockId
    return {
        blockId,
        runId: blockId,
        active: true,
        deactivatedByUser: false,
        compressedTokens: 100,
        summaryTokens: 20,
        durationMs: 50,
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

function buildMessage(id: string, sessionID: string, created: number): WithParts {
    return {
        info: {
            id,
            role: "assistant",
            sessionID,
            agent: "assistant",
            time: { created },
        } as WithParts["info"],
        parts: [textPart(id, sessionID, `${id}-part`, `content-${id}`)],
    }
}

test("syncCompressionBlocks is a no-op when there are no blocks in state", () => {
    const state = createSessionState()
    const logger = new Logger(false)
    const messages: WithParts[] = [buildMessage("msg-1", "ses_sync_noop", 1)]

    assert.doesNotThrow(() => syncCompressionBlocks(state, logger, messages))
    assert.equal(state.prune.messages.activeBlockIds.size, 0)
    assert.equal(state.prune.messages.blocksById.size, 0)
})

test("syncCompressionBlocks activates a block whose origin message is present", () => {
    const state = createSessionState()
    const logger = new Logger(false)
    const sessionID = "ses_sync_activate"

    const block = buildBlock({
        blockId: 1,
        active: false,
        compressMessageId: "msg-origin-1",
        anchorMessageId: "msg-anchor-1",
    })
    state.prune.messages.blocksById.set(1, block)

    const messages: WithParts[] = [
        buildMessage("msg-anchor-1", sessionID, 1),
        buildMessage("msg-origin-1", sessionID, 2),
    ]

    syncCompressionBlocks(state, logger, messages)

    const stored = state.prune.messages.blocksById.get(1)
    assert.ok(stored)
    assert.equal(stored.active, true)
    assert.equal(stored.deactivatedAt, undefined)
    assert.ok(state.prune.messages.activeBlockIds.has(1))
    assert.equal(state.prune.messages.activeByAnchorMessageId.get("msg-anchor-1"), 1)
})

test("syncCompressionBlocks deactivates a block whose origin message is missing", () => {
    const state = createSessionState()
    const logger = new Logger(false)
    const sessionID = "ses_sync_missing_origin"

    const block = buildBlock({
        blockId: 2,
        active: true,
        compressMessageId: "msg-origin-missing",
        anchorMessageId: "msg-anchor-2",
    })
    state.prune.messages.blocksById.set(2, block)
    state.prune.messages.activeBlockIds.add(2)

    const messages: WithParts[] = [buildMessage("msg-anchor-2", sessionID, 1)]

    syncCompressionBlocks(state, logger, messages)

    const stored = state.prune.messages.blocksById.get(2)
    assert.ok(stored)
    assert.equal(stored.active, false)
    assert.ok(stored.deactivatedAt !== undefined)
    assert.equal(state.prune.messages.activeBlockIds.has(2), false)
})

test("syncCompressionBlocks keeps a user-decompressed block inactive even when origin is present", () => {
    const state = createSessionState()
    const logger = new Logger(false)
    const sessionID = "ses_sync_user_decompressed"

    const block = buildBlock({
        blockId: 3,
        active: false,
        deactivatedByUser: true,
        deactivatedAt: 12345,
        compressMessageId: "msg-origin-3",
        anchorMessageId: "msg-anchor-3",
    })
    state.prune.messages.blocksById.set(3, block)

    const messages: WithParts[] = [
        buildMessage("msg-anchor-3", sessionID, 1),
        buildMessage("msg-origin-3", sessionID, 2),
    ]

    syncCompressionBlocks(state, logger, messages)

    const stored = state.prune.messages.blocksById.get(3)
    assert.ok(stored)
    assert.equal(stored.active, false)
    assert.equal(stored.deactivatedByUser, true)
    assert.equal(stored.deactivatedAt, 12345)
    assert.equal(state.prune.messages.activeBlockIds.has(3), false)
})

test("syncCompressionBlocks deactivates blocks consumed by a newer block", () => {
    const state = createSessionState()
    const logger = new Logger(false)
    const sessionID = "ses_sync_consumed"

    const older = buildBlock({
        blockId: 1,
        active: true,
        createdAt: 1,
        compressMessageId: "msg-origin-old",
        anchorMessageId: "msg-anchor-old",
    })
    const newer = buildBlock({
        blockId: 2,
        active: true,
        createdAt: 2,
        compressMessageId: "msg-origin-new",
        anchorMessageId: "msg-anchor-new",
        consumedBlockIds: [1],
    })
    state.prune.messages.blocksById.set(1, older)
    state.prune.messages.blocksById.set(2, newer)
    state.prune.messages.activeBlockIds.add(1)
    state.prune.messages.activeBlockIds.add(2)
    state.prune.messages.activeByAnchorMessageId.set("msg-anchor-old", 1)

    const messages: WithParts[] = [
        buildMessage("msg-anchor-old", sessionID, 1),
        buildMessage("msg-origin-old", sessionID, 2),
        buildMessage("msg-anchor-new", sessionID, 3),
        buildMessage("msg-origin-new", sessionID, 4),
    ]

    syncCompressionBlocks(state, logger, messages)

    const consumed = state.prune.messages.blocksById.get(1)
    const winner = state.prune.messages.blocksById.get(2)
    assert.ok(consumed && winner)
    assert.equal(consumed.active, false)
    assert.equal(consumed.deactivatedByBlockId, 2)
    assert.equal(winner.active, true)
    assert.equal(state.prune.messages.activeBlockIds.has(1), false)
    assert.equal(state.prune.messages.activeBlockIds.has(2), true)
    assert.equal(state.prune.messages.activeByAnchorMessageId.has("msg-anchor-old"), false)
})

test("syncCompressionBlocks preserves block metadata (topic, startId, endId, summary)", () => {
    const state = createSessionState()
    const logger = new Logger(false)
    const sessionID = "ses_sync_metadata"

    const block = buildBlock({
        blockId: 7,
        topic: "Closed exploration phase",
        startId: "m0001",
        endId: "m0010",
        summary: "Detailed summary content",
        compressMessageId: "msg-origin-7",
        anchorMessageId: "msg-anchor-7",
    })
    state.prune.messages.blocksById.set(7, block)

    const messages: WithParts[] = [
        buildMessage("msg-anchor-7", sessionID, 1),
        buildMessage("msg-origin-7", sessionID, 2),
    ]

    syncCompressionBlocks(state, logger, messages)

    const stored = state.prune.messages.blocksById.get(7)
    assert.ok(stored)
    assert.equal(stored.topic, "Closed exploration phase")
    assert.equal(stored.startId, "m0001")
    assert.equal(stored.endId, "m0010")
    assert.equal(stored.summary, "Detailed summary content")
})

test("syncCompressionBlocks rebuilds entry.activeBlockIds from current activeBlockIds set", () => {
    const state = createSessionState()
    const logger = new Logger(false)
    const sessionID = "ses_sync_entry_filter"

    const block = buildBlock({
        blockId: 4,
        compressMessageId: "msg-origin-4",
        anchorMessageId: "msg-anchor-4",
    })
    state.prune.messages.blocksById.set(4, block)
    state.prune.messages.byMessageId.set("msg-anchor-4", {
        tokenCount: 50,
        allBlockIds: [4, 99],
        activeBlockIds: [99],
    })

    const messages: WithParts[] = [
        buildMessage("msg-anchor-4", sessionID, 1),
        buildMessage("msg-origin-4", sessionID, 2),
    ]

    syncCompressionBlocks(state, logger, messages)

    const entry = state.prune.messages.byMessageId.get("msg-anchor-4")
    assert.ok(entry)
    // 99 doesn't exist as a real block, so it's filtered out of activeBlockIds
    assert.deepEqual(entry.activeBlockIds, [4])
    assert.deepEqual(entry.allBlockIds, [4, 99])
})
