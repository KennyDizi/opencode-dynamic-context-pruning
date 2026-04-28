import assert from "node:assert/strict"
import test from "node:test"
import { Logger } from "../lib/logger"
import { createSessionState, type SessionState, type WithParts } from "../lib/state"
import { deduplicate } from "../lib/strategies/deduplication"
import { purgeErrors } from "../lib/strategies/purge-errors"
import { buildConfig } from "./helpers/index.js"

function setupState(): SessionState {
    const state = createSessionState()
    state.sessionId = "ses_strategies_test"
    state.currentTurn = 10
    return state
}

function registerTool(
    state: SessionState,
    callId: string,
    tool: string,
    parameters: any,
    opts: { status?: "completed" | "error"; turn?: number; tokenCount?: number; error?: string } = {},
): void {
    state.toolIdList.push(callId)
    state.toolParameters.set(callId, {
        tool,
        parameters,
        status: opts.status ?? "completed",
        error: opts.error,
        turn: opts.turn ?? 1,
        tokenCount: opts.tokenCount ?? 5,
    })
}

const noMessages: WithParts[] = []

// ---------- deduplication.ts ----------

test("deduplicate prunes earlier duplicate tool calls and keeps the most recent", () => {
    const state = setupState()
    const logger = new Logger(false)
    const config = buildConfig()

    registerTool(state, "call-a1", "read", { filePath: "/tmp/a.txt" }, { tokenCount: 10 })
    registerTool(state, "call-a2", "read", { filePath: "/tmp/a.txt" }, { tokenCount: 10 })
    registerTool(state, "call-a3", "read", { filePath: "/tmp/a.txt" }, { tokenCount: 10 })

    deduplicate(state, logger, config, noMessages)

    assert.equal(state.prune.tools.has("call-a1"), true)
    assert.equal(state.prune.tools.has("call-a2"), true)
    assert.equal(state.prune.tools.has("call-a3"), false, "most recent must be preserved")
    assert.equal(state.prune.tools.get("call-a1"), 10)
    assert.equal(state.stats.totalPruneTokens, 20)
})

test("deduplicate preserves unique tool calls", () => {
    const state = setupState()
    const logger = new Logger(false)
    const config = buildConfig()

    registerTool(state, "call-u1", "read", { filePath: "/tmp/a.txt" })
    registerTool(state, "call-u2", "read", { filePath: "/tmp/b.txt" })
    registerTool(state, "call-u3", "grep", { pattern: "TODO" })

    deduplicate(state, logger, config, noMessages)

    assert.equal(state.prune.tools.size, 0)
    assert.equal(state.stats.totalPruneTokens, 0)
})

test("deduplicate handles mixed duplicates and unique entries", () => {
    const state = setupState()
    const logger = new Logger(false)
    const config = buildConfig()

    registerTool(state, "dup-1", "read", { filePath: "/tmp/x.txt" }, { tokenCount: 7 })
    registerTool(state, "uniq-1", "grep", { pattern: "needle" }, { tokenCount: 3 })
    registerTool(state, "dup-2", "read", { filePath: "/tmp/x.txt" }, { tokenCount: 7 })
    registerTool(state, "uniq-2", "bash", { command: "ls" }, { tokenCount: 2 })
    registerTool(state, "dup-3", "read", { filePath: "/tmp/x.txt" }, { tokenCount: 7 })

    deduplicate(state, logger, config, noMessages)

    assert.deepEqual(
        Array.from(state.prune.tools.keys()).sort(),
        ["dup-1", "dup-2"].sort(),
        "only earlier duplicates should be pruned",
    )
    assert.equal(state.prune.tools.has("dup-3"), false)
    assert.equal(state.prune.tools.has("uniq-1"), false)
    assert.equal(state.prune.tools.has("uniq-2"), false)
    assert.equal(state.stats.totalPruneTokens, 14)
})

test("deduplicate normalizes parameter key order when computing signatures", () => {
    const state = setupState()
    const logger = new Logger(false)
    const config = buildConfig()

    registerTool(state, "k1", "edit", { filePath: "/tmp/y.txt", oldText: "a", newText: "b" })
    registerTool(state, "k2", "edit", { newText: "b", oldText: "a", filePath: "/tmp/y.txt" })

    deduplicate(state, logger, config, noMessages)

    assert.equal(state.prune.tools.has("k1"), true)
    assert.equal(state.prune.tools.has("k2"), false)
})

test("deduplicate is a no-op when disabled in config", () => {
    const state = setupState()
    const logger = new Logger(false)
    const config = buildConfig()
    config.strategies.deduplication.enabled = false

    registerTool(state, "d-1", "read", { filePath: "/tmp/z.txt" })
    registerTool(state, "d-2", "read", { filePath: "/tmp/z.txt" })

    deduplicate(state, logger, config, noMessages)

    assert.equal(state.prune.tools.size, 0)
})

test("deduplicate skips tool calls listed as protected", () => {
    const state = setupState()
    const logger = new Logger(false)
    const config = buildConfig()
    config.strategies.deduplication.protectedTools = ["my_protected_tool"]

    registerTool(state, "p-1", "my_protected_tool", { x: 1 })
    registerTool(state, "p-2", "my_protected_tool", { x: 1 })

    deduplicate(state, logger, config, noMessages)

    assert.equal(state.prune.tools.size, 0)
})

// ---------- purge-errors.ts ----------

test("purgeErrors prunes errored tool calls older than the turn threshold", () => {
    const state = setupState()
    state.currentTurn = 10
    const logger = new Logger(false)
    const config = buildConfig()
    config.strategies.purgeErrors.turns = 4

    registerTool(state, "err-old", "bash", { command: "fail" }, {
        status: "error",
        turn: 1,
        tokenCount: 8,
        error: "boom",
    })

    purgeErrors(state, logger, config, noMessages)

    assert.equal(state.prune.tools.has("err-old"), true)
    assert.equal(state.prune.tools.get("err-old"), 8)
    assert.equal(state.stats.totalPruneTokens, 8)
})

test("purgeErrors preserves successful tool calls regardless of age", () => {
    const state = setupState()
    state.currentTurn = 100
    const logger = new Logger(false)
    const config = buildConfig()

    registerTool(state, "ok-old", "read", { filePath: "/tmp/old.txt" }, {
        status: "completed",
        turn: 1,
        tokenCount: 4,
    })

    purgeErrors(state, logger, config, noMessages)

    assert.equal(state.prune.tools.size, 0)
    assert.equal(state.stats.totalPruneTokens, 0)
})

test("purgeErrors keeps recent errors that are within the turn threshold", () => {
    const state = setupState()
    state.currentTurn = 5
    const logger = new Logger(false)
    const config = buildConfig()
    config.strategies.purgeErrors.turns = 4

    registerTool(state, "err-recent", "bash", { command: "fail" }, {
        status: "error",
        turn: 4,
        error: "still recent",
    })

    purgeErrors(state, logger, config, noMessages)

    assert.equal(state.prune.tools.has("err-recent"), false)
})

test("purgeErrors handles empty tool list as a no-op", () => {
    const state = setupState()
    const logger = new Logger(false)
    const config = buildConfig()

    purgeErrors(state, logger, config, noMessages)

    assert.equal(state.prune.tools.size, 0)
    assert.equal(state.stats.totalPruneTokens, 0)
})

test("purgeErrors skips protected tools even when errored and old", () => {
    const state = setupState()
    state.currentTurn = 100
    const logger = new Logger(false)
    const config = buildConfig()
    config.strategies.purgeErrors.protectedTools = ["my_safe_tool"]

    registerTool(state, "safe-err", "my_safe_tool", { x: 1 }, {
        status: "error",
        turn: 1,
        error: "ignored",
    })

    purgeErrors(state, logger, config, noMessages)

    assert.equal(state.prune.tools.size, 0)
})

test("purgeErrors processes only error tools when mixed with successful ones", () => {
    const state = setupState()
    state.currentTurn = 20
    const logger = new Logger(false)
    const config = buildConfig()
    config.strategies.purgeErrors.turns = 4

    registerTool(state, "ok-1", "read", { filePath: "/tmp/a.txt" }, {
        status: "completed",
        turn: 1,
        tokenCount: 5,
    })
    registerTool(state, "err-1", "bash", { command: "fail-1" }, {
        status: "error",
        turn: 1,
        tokenCount: 9,
        error: "x",
    })
    registerTool(state, "ok-2", "grep", { pattern: "z" }, {
        status: "completed",
        turn: 2,
        tokenCount: 3,
    })
    registerTool(state, "err-2", "bash", { command: "fail-2" }, {
        status: "error",
        turn: 2,
        tokenCount: 11,
        error: "y",
    })

    purgeErrors(state, logger, config, noMessages)

    assert.deepEqual(
        Array.from(state.prune.tools.keys()).sort(),
        ["err-1", "err-2"].sort(),
    )
    assert.equal(state.stats.totalPruneTokens, 20)
})
