import assert from "node:assert/strict"
import test from "node:test"
import {
    addAnchor,
    countMessagesAfterIndex,
    findLastNonIgnoredMessage,
    getIterationNudgeThreshold,
    getModelInfo,
    getNudgeFrequency,
    isContextOverLimits,
} from "../lib/messages/inject/utils"
import { createSessionState, type WithParts } from "../lib/state"
import { buildConfig, repeatedWord, textPart } from "./helpers"

function buildUserMessage(
    id: string,
    sessionID: string,
    created: number,
    text: string = "user message",
    ignored: boolean = false,
): WithParts {
    const part = textPart(id, sessionID, `${id}-part`, text)
    if (ignored) {
        ;(part as { ignored?: boolean }).ignored = true
    }
    return {
        info: {
            id,
            role: "user",
            sessionID,
            agent: "assistant",
            model: { providerID: "anthropic", modelID: "claude-test" },
            time: { created },
        } as WithParts["info"],
        parts: [part],
    }
}

function buildAssistantMessage(
    id: string,
    sessionID: string,
    created: number,
    text: string = "assistant message",
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
        parts: [textPart(id, sessionID, `${id}-part`, text)],
    }
}

test("getNudgeFrequency floors and clamps to >= 1", () => {
    assert.equal(getNudgeFrequency(buildConfig()), 5)

    const cfgZero = buildConfig()
    cfgZero.compress.nudgeFrequency = 0
    assert.equal(getNudgeFrequency(cfgZero), 1)

    const cfgFractional = buildConfig()
    cfgFractional.compress.nudgeFrequency = 3.9
    assert.equal(getNudgeFrequency(cfgFractional), 3)
})

test("getIterationNudgeThreshold floors and clamps to >= 1", () => {
    assert.equal(getIterationNudgeThreshold(buildConfig()), 15)

    const cfgZero = buildConfig()
    cfgZero.compress.iterationNudgeThreshold = 0
    assert.equal(getIterationNudgeThreshold(cfgZero), 1)

    const cfgFractional = buildConfig()
    cfgFractional.compress.iterationNudgeThreshold = 7.7
    assert.equal(getIterationNudgeThreshold(cfgFractional), 7)
})

test("findLastNonIgnoredMessage returns the last visible message", () => {
    const sessionID = "ses_inject_last_msg"
    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1),
        buildAssistantMessage("a1", sessionID, 2),
        buildUserMessage("u2", sessionID, 3, "ignored", true),
    ]

    const found = findLastNonIgnoredMessage(messages)
    assert.ok(found)
    assert.equal(found.message.info.id, "a1")
    assert.equal(found.index, 1)
})

test("findLastNonIgnoredMessage returns null when all messages are ignored", () => {
    const sessionID = "ses_inject_all_ignored"
    const messages: WithParts[] = [buildUserMessage("u1", sessionID, 1, "ignored", true)]
    assert.equal(findLastNonIgnoredMessage(messages), null)
})

test("countMessagesAfterIndex skips ignored user messages", () => {
    const sessionID = "ses_inject_count_after"
    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1),
        buildAssistantMessage("a1", sessionID, 2),
        buildUserMessage("u2", sessionID, 3, "ignored", true),
        buildAssistantMessage("a2", sessionID, 4),
        buildUserMessage("u3", sessionID, 5),
    ]

    assert.equal(countMessagesAfterIndex(messages, 0), 3)
    assert.equal(countMessagesAfterIndex(messages, messages.length - 1), 0)
    assert.equal(countMessagesAfterIndex(messages, -1), 4)
})

test("getModelInfo returns the model from the last user message", () => {
    const sessionID = "ses_inject_model"
    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1),
        buildAssistantMessage("a1", sessionID, 2),
    ]

    const info = getModelInfo(messages)
    assert.equal(info.providerId, "anthropic")
    assert.equal(info.modelId, "claude-test")
})

test("getModelInfo returns undefineds when there is no user message", () => {
    const info = getModelInfo([])
    assert.equal(info.providerId, undefined)
    assert.equal(info.modelId, undefined)
})

test("addAnchor adds an anchor when the set is empty", () => {
    const sessionID = "ses_inject_anchor_empty"
    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1),
        buildAssistantMessage("a1", sessionID, 2),
    ]
    const anchors = new Set<string>()

    const added = addAnchor(anchors, "a1", 1, messages, 5)
    assert.equal(added, true)
    assert.ok(anchors.has("a1"))
})

test("addAnchor enforces the interval against the latest existing anchor", () => {
    const sessionID = "ses_inject_anchor_interval"
    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1),
        buildAssistantMessage("a1", sessionID, 2),
        buildAssistantMessage("a2", sessionID, 3),
        buildAssistantMessage("a3", sessionID, 4),
    ]
    const anchors = new Set<string>(["a1"])

    const tooClose = addAnchor(anchors, "a2", 2, messages, 3)
    assert.equal(tooClose, false)
    assert.equal(anchors.size, 1)

    const farEnough = addAnchor(anchors, "a3", 3, messages, 2)
    assert.equal(farEnough, true)
    assert.ok(anchors.has("a3"))
})

test("addAnchor returns false when the anchor is already present", () => {
    const sessionID = "ses_inject_anchor_dup"
    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1),
        buildAssistantMessage("a1", sessionID, 2),
    ]
    const anchors = new Set<string>(["a1"])

    const added = addAnchor(anchors, "a1", 1, messages, 1)
    assert.equal(added, false)
    assert.equal(anchors.size, 1)
})

test("addAnchor returns false when the anchor message index is negative", () => {
    const sessionID = "ses_inject_anchor_neg"
    const anchors = new Set<string>()
    const added = addAnchor(anchors, "missing", -1, [], 1)
    assert.equal(added, false)
    assert.equal(anchors.size, 0)
})

test("isContextOverLimits flags above maxContextLimit and below minContextLimit", () => {
    const sessionID = "ses_inject_limits"
    const state = createSessionState()
    const messages: WithParts[] = [
        buildUserMessage("u1", sessionID, 1, repeatedWord("payload", 800)),
        buildAssistantMessage("a1", sessionID, 2, repeatedWord("response", 800)),
    ]

    const tightConfig = buildConfig({ maxContextLimit: 10, minContextLimit: 1 })
    const tight = isContextOverLimits(tightConfig, state, undefined, undefined, messages)
    assert.equal(tight.overMaxLimit, true)
    assert.equal(tight.overMinLimit, true)

    const looseConfig = buildConfig({ maxContextLimit: 10_000_000, minContextLimit: 9_000_000 })
    const loose = isContextOverLimits(looseConfig, state, undefined, undefined, messages)
    assert.equal(loose.overMaxLimit, false)
    assert.equal(loose.overMinLimit, false)
})
