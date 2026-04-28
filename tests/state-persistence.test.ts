import assert from "node:assert/strict"
import test from "node:test"
import * as fs from "node:fs/promises"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// IMPORTANT: persistence.ts reads XDG_DATA_HOME at import time to compute
// STORAGE_DIR. We must set it BEFORE importing the module under test.
const TEST_DATA_HOME = join(
    tmpdir(),
    `dcp-persistence-test-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
)
process.env.XDG_DATA_HOME = TEST_DATA_HOME
mkdirSync(TEST_DATA_HOME, { recursive: true })

const STORAGE_DIR = join(TEST_DATA_HOME, "opencode", "storage", "plugin", "dcp")

import type { WithParts } from "../lib/state"

const { Logger } = await import("../lib/logger")
const { createSessionState } = await import("../lib/state")
const { syncToolCache } = await import("../lib/state/tool-cache")
const { saveSessionState, loadSessionState, loadAllSessionStats } = await import(
    "../lib/state/persistence"
)
const { buildConfig } = await import("./helpers/index.js")

function cleanupSessionFile(sessionId: string): void {
    const f = join(STORAGE_DIR, `${sessionId}.json`)
    if (existsSync(f)) {
        rmSync(f, { force: true })
    }
}

function uniqueSessionId(label: string): string {
    return `ses_${label}_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`
}

// ---------- persistence.ts ----------

test("saveSessionState serializes prune tools, nudges, and stats to disk", async () => {
    const sessionId = uniqueSessionId("save")
    const state = createSessionState()
    state.sessionId = sessionId
    state.prune.tools.set("call-1", 100)
    state.prune.tools.set("call-2", 250)
    state.nudges.contextLimitAnchors.add("m0001")
    state.nudges.turnNudgeAnchors.add("m0002")
    state.nudges.iterationNudgeAnchors.add("m0003")
    state.stats.totalPruneTokens = 350
    state.stats.pruneTokenCounter = 17

    const logger = new Logger(false)
    try {
        await saveSessionState(state, logger, "My Session")

        const filePath = join(STORAGE_DIR, `${sessionId}.json`)
        assert.equal(existsSync(filePath), true)
        const raw = await fs.readFile(filePath, "utf-8")
        const parsed = JSON.parse(raw)

        assert.equal(parsed.sessionName, "My Session")
        assert.deepEqual(parsed.prune.tools, { "call-1": 100, "call-2": 250 })
        assert.deepEqual(parsed.nudges.contextLimitAnchors, ["m0001"])
        assert.deepEqual(parsed.nudges.turnNudgeAnchors, ["m0002"])
        assert.deepEqual(parsed.nudges.iterationNudgeAnchors, ["m0003"])
        assert.equal(parsed.stats.totalPruneTokens, 350)
        assert.equal(parsed.stats.pruneTokenCounter, 17)
        assert.equal(typeof parsed.lastUpdated, "string")
        assert.ok(parsed.prune.messages, "messages prune state should be serialized")
        assert.equal(typeof parsed.prune.messages.nextBlockId, "number")
    } finally {
        cleanupSessionFile(sessionId)
    }
})

test("saveSessionState is a no-op when sessionId is null", async () => {
    const state = createSessionState()
    state.sessionId = null
    const logger = new Logger(false)

    const before = existsSync(STORAGE_DIR) ? (await fs.readdir(STORAGE_DIR)).length : 0
    await saveSessionState(state, logger)
    const after = existsSync(STORAGE_DIR) ? (await fs.readdir(STORAGE_DIR)).length : 0

    assert.equal(after, before)
})

test("loadSessionState returns null when no file exists", async () => {
    const logger = new Logger(false)
    const result = await loadSessionState(uniqueSessionId("missing"), logger)
    assert.equal(result, null)
})

test("loadSessionState returns null on corrupt JSON", async () => {
    const sessionId = uniqueSessionId("corrupt")
    const logger = new Logger(false)
    if (!existsSync(STORAGE_DIR)) {
        await fs.mkdir(STORAGE_DIR, { recursive: true })
    }
    const filePath = join(STORAGE_DIR, `${sessionId}.json`)
    await fs.writeFile(filePath, "{ this is not json", "utf-8")
    try {
        const result = await loadSessionState(sessionId, logger)
        assert.equal(result, null)
    } finally {
        cleanupSessionFile(sessionId)
    }
})

test("loadSessionState returns null on structurally invalid payload", async () => {
    const sessionId = uniqueSessionId("invalid")
    const logger = new Logger(false)
    if (!existsSync(STORAGE_DIR)) {
        await fs.mkdir(STORAGE_DIR, { recursive: true })
    }
    const filePath = join(STORAGE_DIR, `${sessionId}.json`)
    await fs.writeFile(filePath, JSON.stringify({ foo: "bar" }), "utf-8")
    try {
        const result = await loadSessionState(sessionId, logger)
        assert.equal(result, null)
    } finally {
        cleanupSessionFile(sessionId)
    }
})

test("save/load round-trip preserves prune tools, nudges, and stats", async () => {
    const sessionId = uniqueSessionId("roundtrip")
    const logger = new Logger(false)
    const state = createSessionState()
    state.sessionId = sessionId
    state.prune.tools.set("rt-a", 11)
    state.prune.tools.set("rt-b", 22)
    state.nudges.contextLimitAnchors.add("m0010")
    state.nudges.contextLimitAnchors.add("m0011")
    state.nudges.turnNudgeAnchors.add("m0020")
    state.nudges.iterationNudgeAnchors.add("m0030")
    state.stats.totalPruneTokens = 33
    state.stats.pruneTokenCounter = 5

    try {
        await saveSessionState(state, logger, "round-trip")
        const loaded = await loadSessionState(sessionId, logger)

        assert.ok(loaded, "expected loaded state to be non-null")
        assert.equal(loaded!.sessionName, "round-trip")
        assert.deepEqual(loaded!.prune.tools, { "rt-a": 11, "rt-b": 22 })
        assert.deepEqual(loaded!.nudges.contextLimitAnchors.sort(), ["m0010", "m0011"])
        assert.deepEqual(loaded!.nudges.turnNudgeAnchors, ["m0020"])
        assert.deepEqual(loaded!.nudges.iterationNudgeAnchors, ["m0030"])
        assert.equal(loaded!.stats.totalPruneTokens, 33)
        assert.equal(loaded!.stats.pruneTokenCounter, 5)
    } finally {
        cleanupSessionFile(sessionId)
    }
})

test("loadSessionState filters out non-string anchor entries and dedupes", async () => {
    const sessionId = uniqueSessionId("dedupe")
    const logger = new Logger(false)
    if (!existsSync(STORAGE_DIR)) {
        await fs.mkdir(STORAGE_DIR, { recursive: true })
    }
    const filePath = join(STORAGE_DIR, `${sessionId}.json`)

    const payload = {
        sessionName: "dedupe",
        prune: {
            tools: { "x": 1 },
            messages: {
                byMessageId: {},
                blocksById: {},
                activeBlockIds: [],
                activeByAnchorMessageId: {},
                nextBlockId: 1,
                nextRunId: 1,
            },
        },
        nudges: {
            contextLimitAnchors: ["m1", "m1", 42, null, "m2"],
            turnNudgeAnchors: ["m3", "m3"],
            iterationNudgeAnchors: ["m4"],
        },
        stats: { pruneTokenCounter: 0, totalPruneTokens: 0 },
        lastUpdated: new Date().toISOString(),
    }
    await fs.writeFile(filePath, JSON.stringify(payload), "utf-8")

    try {
        const loaded = await loadSessionState(sessionId, logger)
        assert.ok(loaded)
        assert.deepEqual(loaded!.nudges.contextLimitAnchors.sort(), ["m1", "m2"])
        assert.deepEqual(loaded!.nudges.turnNudgeAnchors, ["m3"])
        assert.deepEqual(loaded!.nudges.iterationNudgeAnchors, ["m4"])
    } finally {
        cleanupSessionFile(sessionId)
    }
})

test("loadAllSessionStats aggregates across persisted session files", async () => {
    const ids = [uniqueSessionId("agg-a"), uniqueSessionId("agg-b")]
    const logger = new Logger(false)

    try {
        for (const [idx, id] of ids.entries()) {
            const state = createSessionState()
            state.sessionId = id
            state.prune.tools.set(`call-${idx}-1`, 10)
            state.prune.tools.set(`call-${idx}-2`, 20)
            state.stats.totalPruneTokens = 100 * (idx + 1)
            await saveSessionState(state, logger)
        }

        const stats = await loadAllSessionStats(logger)
        assert.ok(stats.sessionCount >= 2)
        assert.ok(stats.totalTokens >= 300)
        assert.ok(stats.totalTools >= 4)
    } finally {
        for (const id of ids) cleanupSessionFile(id)
    }
})

// ---------- tool-cache.ts ----------

function buildAssistantToolMessage(
    sessionId: string,
    messageId: string,
    parts: any[],
): WithParts {
    return {
        info: {
            id: messageId,
            role: "assistant",
            sessionID: sessionId,
            agent: "assistant",
            time: { created: Date.now() },
        } as WithParts["info"],
        parts: parts as WithParts["parts"],
    }
}

function makeToolPart(
    sessionId: string,
    messageId: string,
    callId: string,
    tool: string,
    input: any,
    status: "completed" | "error" = "completed",
    output: string = "ok",
) {
    const stateBlob: any = { status, input, output }
    if (status === "error") {
        stateBlob.error = "boom"
    }
    return {
        id: `${callId}-part`,
        messageID: messageId,
        sessionID: sessionId,
        type: "tool" as const,
        tool,
        callID: callId,
        state: stateBlob,
    }
}

function makeStepStartPart(sessionId: string, messageId: string, idx: number) {
    return {
        id: `${messageId}-step-${idx}`,
        messageID: messageId,
        sessionID: sessionId,
        type: "step-start" as const,
    }
}

test("syncToolCache caches tool parameters keyed by callID", () => {
    const state = createSessionState()
    const config = buildConfig()
    const logger = new Logger(false)
    const sessionId = uniqueSessionId("cache-basic")

    const messages: WithParts[] = [
        buildAssistantToolMessage(sessionId, "msg-1", [
            makeStepStartPart(sessionId, "msg-1", 0),
            makeToolPart(sessionId, "msg-1", "call-x", "read", { filePath: "/tmp/x.txt" }),
            makeToolPart(sessionId, "msg-1", "call-y", "grep", { pattern: "abc" }),
        ]),
    ]

    syncToolCache(state, config, logger, messages)

    assert.equal(state.toolParameters.size, 2)
    const x = state.toolParameters.get("call-x")
    assert.ok(x)
    assert.equal(x!.tool, "read")
    assert.deepEqual(x!.parameters, { filePath: "/tmp/x.txt" })
    assert.equal(x!.status, "completed")
    assert.equal(x!.turn, 1)
    assert.equal(typeof x!.tokenCount, "number")

    const y = state.toolParameters.get("call-y")
    assert.ok(y)
    assert.equal(y!.tool, "grep")
})

test("syncToolCache does not overwrite existing entries on subsequent calls", () => {
    const state = createSessionState()
    const config = buildConfig()
    const logger = new Logger(false)
    const sessionId = uniqueSessionId("cache-no-overwrite")

    const initial: WithParts[] = [
        buildAssistantToolMessage(sessionId, "msg-init", [
            makeStepStartPart(sessionId, "msg-init", 0),
            makeToolPart(sessionId, "msg-init", "stable-call", "read", { filePath: "/tmp/v1.txt" }),
        ]),
    ]
    syncToolCache(state, config, logger, initial)
    const original = state.toolParameters.get("stable-call")
    assert.ok(original)
    assert.deepEqual(original!.parameters, { filePath: "/tmp/v1.txt" })

    // Re-sync with a different "newer" tool part for the same callID
    const updated: WithParts[] = [
        buildAssistantToolMessage(sessionId, "msg-updated", [
            makeStepStartPart(sessionId, "msg-updated", 0),
            makeStepStartPart(sessionId, "msg-updated", 1),
            makeToolPart(sessionId, "msg-updated", "stable-call", "read", {
                filePath: "/tmp/different.txt",
            }),
        ]),
    ]
    syncToolCache(state, config, logger, updated)
    const after = state.toolParameters.get("stable-call")
    assert.ok(after)
    assert.deepEqual(
        after!.parameters,
        { filePath: "/tmp/v1.txt" },
        "existing cache entries must not be overwritten",
    )
    assert.equal(after!.turn, original!.turn)
})

test("syncToolCache records error tool status with error metadata", () => {
    const state = createSessionState()
    const config = buildConfig()
    const logger = new Logger(false)
    const sessionId = uniqueSessionId("cache-error")

    const messages: WithParts[] = [
        buildAssistantToolMessage(sessionId, "msg-e", [
            makeStepStartPart(sessionId, "msg-e", 0),
            makeToolPart(
                sessionId,
                "msg-e",
                "err-call",
                "bash",
                { command: "false" },
                "error",
                "irrelevant",
            ),
        ]),
    ]

    syncToolCache(state, config, logger, messages)
    const entry = state.toolParameters.get("err-call")
    assert.ok(entry)
    assert.equal(entry!.status, "error")
    assert.equal(entry!.error, "boom")
})

test("syncToolCache increments turn counter for each step-start", () => {
    const state = createSessionState()
    const config = buildConfig()
    const logger = new Logger(false)
    const sessionId = uniqueSessionId("cache-turns")

    const messages: WithParts[] = [
        buildAssistantToolMessage(sessionId, "msg-t", [
            makeStepStartPart(sessionId, "msg-t", 0),
            makeToolPart(sessionId, "msg-t", "t1", "read", { filePath: "/a" }),
            makeStepStartPart(sessionId, "msg-t", 1),
            makeToolPart(sessionId, "msg-t", "t2", "read", { filePath: "/b" }),
            makeStepStartPart(sessionId, "msg-t", 2),
            makeToolPart(sessionId, "msg-t", "t3", "read", { filePath: "/c" }),
        ]),
    ]

    syncToolCache(state, config, logger, messages)
    assert.equal(state.toolParameters.get("t1")!.turn, 1)
    assert.equal(state.toolParameters.get("t2")!.turn, 2)
    assert.equal(state.toolParameters.get("t3")!.turn, 3)
})

test("syncToolCache ignores non-tool parts", () => {
    const state = createSessionState()
    const config = buildConfig()
    const logger = new Logger(false)
    const sessionId = uniqueSessionId("cache-skip")

    const messages: WithParts[] = [
        buildAssistantToolMessage(sessionId, "msg-skip", [
            makeStepStartPart(sessionId, "msg-skip", 0),
            {
                id: "txt-1",
                messageID: "msg-skip",
                sessionID: sessionId,
                type: "text" as const,
                text: "hello",
            },
        ]),
    ]

    syncToolCache(state, config, logger, messages)
    assert.equal(state.toolParameters.size, 0)
})
