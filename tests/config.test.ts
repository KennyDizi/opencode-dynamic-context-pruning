import assert from "node:assert/strict"
import test from "node:test"
import { register } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { PluginInput } from "@opencode-ai/plugin"

const testDataHome = join(tmpdir(), `opencode-dcp-tests-${process.pid}`)
const testConfigHome = join(tmpdir(), `opencode-dcp-config-cfg-tests-${process.pid}`)

process.env.XDG_DATA_HOME = testDataHome
process.env.XDG_CONFIG_HOME = testConfigHome

mkdirSync(testDataHome, { recursive: true })
mkdirSync(testConfigHome, { recursive: true })

register("./helpers/jsonc-loader-hook.mjs", { parentURL: import.meta.url })

const {
    DEFAULTS,
    DEFAULT_PROTECTED_TOOLS,
    COMPRESS_DEFAULT_PROTECTED_TOOLS,
    VALID_CONFIG_KEYS,
    defaultConfig,
    getConfig,
    getInvalidConfigKeys,
    validateConfigTypes,
} = await import("../lib/config")

const cachedGlobalDir = join(testConfigHome, "opencode")
const cachedGlobalJsonc = join(cachedGlobalDir, "dcp.jsonc")
const cachedGlobalJson = join(cachedGlobalDir, "dcp.json")

function clearGlobalConfigFiles(): void {
    rmSync(cachedGlobalJsonc, { force: true })
    rmSync(cachedGlobalJson, { force: true })
}

interface Fixture {
    rootDir: string
    workspaceDir: string
    opencodeDir: string
    customConfigDir: string
    globalDcpDir: string
    cleanup: () => void
    ctx: PluginInput
}

function createFixture(): Fixture {
    const rootDir = mkdtempSync(join(tmpdir(), "opencode-dcp-config-test-"))
    const customConfigDir = join(rootDir, "custom-config")
    const workspaceDir = join(rootDir, "workspace")
    const opencodeDir = join(workspaceDir, ".opencode")
    const globalDcpDir = cachedGlobalDir

    mkdirSync(globalDcpDir, { recursive: true })
    mkdirSync(customConfigDir, { recursive: true })
    mkdirSync(opencodeDir, { recursive: true })

    clearGlobalConfigFiles()

    const previousCustom = process.env.OPENCODE_CONFIG_DIR
    delete process.env.OPENCODE_CONFIG_DIR

    const ctx: PluginInput = {
        directory: workspaceDir,
        client: {
            tui: {
                showToast: async () => undefined,
            },
        },
    } as unknown as PluginInput

    return {
        rootDir,
        workspaceDir,
        opencodeDir,
        customConfigDir,
        globalDcpDir,
        ctx,
        cleanup() {
            if (previousCustom === undefined) {
                delete process.env.OPENCODE_CONFIG_DIR
            } else {
                process.env.OPENCODE_CONFIG_DIR = previousCustom
            }
            clearGlobalConfigFiles()
            rmSync(rootDir, { recursive: true, force: true })
        },
    }
}

test("defaultConfig exposes documented defaults", () => {
    assert.equal(defaultConfig.enabled, true)
    assert.equal(defaultConfig.debug, false)
    assert.equal(defaultConfig.pruneNotification, "detailed")
    assert.equal(defaultConfig.pruneNotificationType, "chat")
    assert.equal(defaultConfig.compress.mode, "range")
    assert.equal(defaultConfig.compress.permission, "allow")
    assert.equal(defaultConfig.compress.nudgeForce, "soft")
    assert.equal(defaultConfig.compress.protectUserMessages, false)
    assert.equal(defaultConfig.compress.summaryBuffer, true)
    assert.equal(defaultConfig.compress.maxContextLimit, DEFAULTS.maxContextLimit)
    assert.equal(defaultConfig.compress.minContextLimit, DEFAULTS.minContextLimit)
    assert.equal(defaultConfig.compress.nudgeFrequency, DEFAULTS.nudgeFrequency)
    assert.equal(
        defaultConfig.compress.iterationNudgeThreshold,
        DEFAULTS.iterationNudgeThreshold,
    )
    assert.equal(defaultConfig.turnProtection.turns, DEFAULTS.turnProtectionTurns)
    assert.equal(defaultConfig.strategies.purgeErrors.turns, DEFAULTS.purgeErrorsTurns)
    assert.equal(defaultConfig.experimental.allowSubAgents, false)
    assert.equal(defaultConfig.experimental.customPrompts, false)
})

test("default protected tool lists contain expected entries", () => {
    for (const tool of ["task", "skill", "todowrite", "todoread", "compress", "edit", "write"]) {
        assert.ok(
            DEFAULT_PROTECTED_TOOLS.includes(tool),
            `DEFAULT_PROTECTED_TOOLS missing ${tool}`,
        )
    }
    assert.deepEqual(
        [...COMPRESS_DEFAULT_PROTECTED_TOOLS].sort(),
        ["skill", "task", "todoread", "todowrite"],
    )
})


test("getInvalidConfigKeys returns empty array for fully valid config", () => {
    assert.deepEqual(getInvalidConfigKeys({}), [])
    assert.deepEqual(
        getInvalidConfigKeys({
            enabled: true,
            compress: { mode: "range", permission: "allow" },
            strategies: { deduplication: { enabled: true } },
        }),
        [],
    )
})

test("getInvalidConfigKeys flags unknown top-level and nested keys", () => {
    const invalid = getInvalidConfigKeys({
        enabled: true,
        notARealKey: 1,
        compress: { mode: "range", bogusNested: true },
    })
    assert.ok(invalid.includes("notARealKey"))
    assert.ok(invalid.includes("compress.bogusNested"))
    assert.ok(!invalid.includes("enabled"))
    assert.ok(!invalid.includes("compress"))
    assert.ok(!invalid.includes("compress.mode"))
})

test("getInvalidConfigKeys does not recurse into model*Limits maps", () => {
    const invalid = getInvalidConfigKeys({
        compress: {
            modelMaxLimits: {
                "openai/gpt-5.3-codex": 120000,
                "anthropic/claude-sonnet-4.6": "80%",
            },
            modelMinLimits: { "openai/gpt-5.3-codex": 50000 },
        },
    })
    assert.deepEqual(invalid, [])
})

test("VALID_CONFIG_KEYS covers compress and strategies leaves", () => {
    for (const key of [
        "compress.mode",
        "compress.permission",
        "compress.maxContextLimit",
        "compress.modelMaxLimits",
        "strategies.deduplication.enabled",
        "strategies.purgeErrors.turns",
        "manualMode.automaticStrategies",
    ]) {
        assert.ok(VALID_CONFIG_KEYS.has(key), `missing ${key} from VALID_CONFIG_KEYS`)
    }
})


test("validateConfigTypes accepts a valid config", () => {
    const errors = validateConfigTypes({
        enabled: true,
        debug: false,
        pruneNotification: "detailed",
        pruneNotificationType: "chat",
        protectedFilePatterns: ["*.env"],
        turnProtection: { enabled: true, turns: 4 },
        experimental: { allowSubAgents: true, customPrompts: false },
        commands: { enabled: true, protectedTools: ["task"] },
        manualMode: { enabled: false, automaticStrategies: true },
        compress: {
            mode: "range",
            permission: "allow",
            showCompression: false,
            summaryBuffer: true,
            maxContextLimit: 100000,
            minContextLimit: "50%",
            modelMaxLimits: { "openai/gpt-5": 120000, "anthropic/sonnet": "80%" },
            modelMinLimits: { "openai/gpt-5": "25%" },
            nudgeFrequency: 5,
            iterationNudgeThreshold: 15,
            nudgeForce: "soft",
            protectedTools: ["task"],
            protectUserMessages: false,
        },
        strategies: {
            deduplication: { enabled: true, protectedTools: [] },
            purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
        },
    })
    assert.deepEqual(errors, [])
})

test("validateConfigTypes catches wrong scalar types with descriptive payload", () => {
    const errors = validateConfigTypes({
        enabled: "yes",
        debug: 1,
        compress: { mode: 123, permission: "maybe", nudgeFrequency: "fast" },
    })

    const byKey = Object.fromEntries(errors.map((e) => [e.key, e]))

    assert.ok(byKey.enabled)
    assert.equal(byKey.enabled.expected, "boolean")
    assert.equal(byKey.enabled.actual, "string")

    assert.ok(byKey.debug)
    assert.equal(byKey.debug.expected, "boolean")

    assert.ok(byKey["compress.mode"])
    assert.equal(byKey["compress.mode"].expected, '"range" | "message"')

    assert.ok(byKey["compress.permission"])
    assert.equal(byKey["compress.permission"].expected, '"ask" | "allow" | "deny"')

    assert.ok(byKey["compress.nudgeFrequency"])
    assert.equal(byKey["compress.nudgeFrequency"].expected, "number")
})

test("validateConfigTypes accepts every valid enum value", () => {
    for (const mode of ["range", "message"] as const) {
        for (const permission of ["ask", "allow", "deny"] as const) {
            for (const nudgeForce of ["strong", "soft"] as const) {
                const errs = validateConfigTypes({
                    compress: { mode, permission, nudgeForce },
                })
                assert.deepEqual(
                    errs,
                    [],
                    `mode=${mode} permission=${permission} nudgeForce=${nudgeForce}`,
                )
            }
        }
    }

    for (const pn of ["off", "minimal", "detailed"] as const) {
        assert.deepEqual(validateConfigTypes({ pruneNotification: pn }), [])
    }
    for (const pnt of ["chat", "toast"] as const) {
        assert.deepEqual(validateConfigTypes({ pruneNotificationType: pnt }), [])
    }
})

test("validateConfigTypes rejects out-of-range numerics with clamp warning", () => {
    const errors = validateConfigTypes({
        turnProtection: { turns: 0 },
        compress: { nudgeFrequency: -3, iterationNudgeThreshold: 0 },
        strategies: { purgeErrors: { turns: 0 } },
    })
    const keys = errors.map((e) => e.key)
    assert.ok(keys.includes("turnProtection.turns"))
    assert.ok(keys.includes("compress.nudgeFrequency"))
    assert.ok(keys.includes("compress.iterationNudgeThreshold"))
    assert.ok(keys.includes("strategies.purgeErrors.turns"))
    for (const err of errors) {
        assert.match(err.expected, /positive number/)
    }
})

test("validateConfigTypes validates context limit values (number or percent string)", () => {
    assert.deepEqual(
        validateConfigTypes({ compress: { maxContextLimit: 100, minContextLimit: "50%" } }),
        [],
    )

    const errors = validateConfigTypes({
        compress: { maxContextLimit: true, minContextLimit: [] },
    })
    const keys = errors.map((e) => e.key)
    assert.ok(keys.includes("compress.maxContextLimit"))
    assert.ok(keys.includes("compress.minContextLimit"))
})

test("validateConfigTypes validates modelMaxLimits/modelMinLimits maps", () => {
    const arrayErrs = validateConfigTypes({
        compress: { modelMaxLimits: ["nope"] as any },
    })
    assert.ok(arrayErrs.some((e) => e.key === "compress.modelMaxLimits"))

    const childErrs = validateConfigTypes({
        compress: {
            modelMaxLimits: { "openai/gpt-5": true as any },
            modelMinLimits: { "openai/gpt-5": "abc" as any },
        },
    })
    const keys = childErrs.map((e) => e.key)
    assert.ok(keys.includes("compress.modelMaxLimits.openai/gpt-5"))
    assert.ok(keys.includes("compress.modelMinLimits.openai/gpt-5"))
})

test("validateConfigTypes rejects non-string entries in protectedFilePatterns", () => {
    const objErrs = validateConfigTypes({ protectedFilePatterns: "*.env" as any })
    assert.equal(objErrs.length, 1)
    assert.equal(objErrs[0].key, "protectedFilePatterns")

    const mixedErrs = validateConfigTypes({ protectedFilePatterns: ["*.env", 5 as any] })
    assert.equal(mixedErrs.length, 1)
    assert.equal(mixedErrs[0].actual, "non-string entries")
})

test("validateConfigTypes rejects non-object containers", () => {
    const errors = validateConfigTypes({
        experimental: "yes" as any,
        commands: [] as any,
        manualMode: null as any,
        compress: 5 as any,
    })
    const keys = errors.map((e) => e.key)
    assert.ok(keys.includes("experimental"))
    assert.ok(keys.includes("commands"))
    assert.ok(keys.includes("compress"))
})


test("getConfig returns defaults when no config files exist (and creates a global stub)", () => {
    const fx = createFixture()
    try {
        const cfg = getConfig(fx.ctx)

        assert.equal(cfg.enabled, defaultConfig.enabled)
        assert.equal(cfg.compress.mode, defaultConfig.compress.mode)
        assert.equal(cfg.compress.permission, defaultConfig.compress.permission)
        assert.equal(cfg.compress.maxContextLimit, defaultConfig.compress.maxContextLimit)
        assert.equal(cfg.strategies.purgeErrors.turns, defaultConfig.strategies.purgeErrors.turns)
        assert.deepEqual(cfg.protectedFilePatterns, [])
    } finally {
        fx.cleanup()
    }
})

test("getConfig with empty {} config still yields defaults", () => {
    const fx = createFixture()
    try {
        writeFileSync(join(fx.globalDcpDir, "dcp.jsonc"), "{}\n", "utf-8")
        const cfg = getConfig(fx.ctx)
        assert.equal(cfg.enabled, true)
        assert.equal(cfg.compress.mode, "range")
        assert.equal(cfg.compress.nudgeFrequency, DEFAULTS.nudgeFrequency)
    } finally {
        fx.cleanup()
    }
})

test("getConfig honors enabled:false at the global layer", () => {
    const fx = createFixture()
    try {
        writeFileSync(
            join(fx.globalDcpDir, "dcp.jsonc"),
            JSON.stringify({ enabled: false }),
            "utf-8",
        )
        const cfg = getConfig(fx.ctx)
        assert.equal(cfg.enabled, false)
        assert.equal(cfg.compress.mode, defaultConfig.compress.mode)
    } finally {
        fx.cleanup()
    }
})

test("getConfig parses JSONC with comments and trailing commas", () => {
    const fx = createFixture()
    try {
        const content = `{
    // top-level comment
    "enabled": true,
    "compress": {
        "mode": "message", // override mode
        "nudgeForce": "strong",
        "protectedTools": ["mytool",], /* trailing comma + block comment */
    },
}
`
        writeFileSync(join(fx.globalDcpDir, "dcp.jsonc"), content, "utf-8")
        const cfg = getConfig(fx.ctx)
        assert.equal(cfg.compress.mode, "message")
        assert.equal(cfg.compress.nudgeForce, "strong")
        assert.ok(cfg.compress.protectedTools.includes("mytool"))
        assert.equal(cfg.compress.permission, defaultConfig.compress.permission)
    } finally {
        fx.cleanup()
    }
})

test("getConfig: project layer overrides global layer", () => {
    const fx = createFixture()
    try {
        writeFileSync(
            join(fx.globalDcpDir, "dcp.jsonc"),
            JSON.stringify({
                compress: { mode: "range", nudgeFrequency: 3 },
                debug: true,
            }),
            "utf-8",
        )
        writeFileSync(
            join(fx.opencodeDir, "dcp.jsonc"),
            JSON.stringify({
                compress: { mode: "message" },
            }),
            "utf-8",
        )
        const cfg = getConfig(fx.ctx)
        assert.equal(cfg.compress.mode, "message")
        assert.equal(cfg.compress.nudgeFrequency, 3)
        assert.equal(cfg.debug, true)
    } finally {
        fx.cleanup()
    }
})

test("getConfig: configDir (custom) layer overrides global; project overrides configDir", () => {
    const fx = createFixture()
    try {
        process.env.OPENCODE_CONFIG_DIR = fx.customConfigDir

        writeFileSync(
            join(fx.globalDcpDir, "dcp.jsonc"),
            JSON.stringify({
                compress: { permission: "allow", nudgeFrequency: 2, nudgeForce: "soft" },
            }),
            "utf-8",
        )
        writeFileSync(
            join(fx.customConfigDir, "dcp.jsonc"),
            JSON.stringify({
                compress: { permission: "ask", nudgeFrequency: 7 },
            }),
            "utf-8",
        )
        writeFileSync(
            join(fx.opencodeDir, "dcp.jsonc"),
            JSON.stringify({
                compress: { permission: "deny" },
            }),
            "utf-8",
        )

        const cfg = getConfig(fx.ctx)
        assert.equal(cfg.compress.permission, "deny")
        assert.equal(cfg.compress.nudgeFrequency, 7)
        assert.equal(cfg.compress.nudgeForce, "soft")
    } finally {
        fx.cleanup()
    }
})

test("getConfig merges array fields (protectedFilePatterns + protectedTools) by union", () => {
    const fx = createFixture()
    try {
        writeFileSync(
            join(fx.globalDcpDir, "dcp.jsonc"),
            JSON.stringify({
                protectedFilePatterns: ["*.env"],
                compress: { protectedTools: ["task"] },
            }),
            "utf-8",
        )
        writeFileSync(
            join(fx.opencodeDir, "dcp.jsonc"),
            JSON.stringify({
                protectedFilePatterns: ["*.secret"],
                compress: { protectedTools: ["custom-tool", "task"] },
            }),
            "utf-8",
        )
        const cfg = getConfig(fx.ctx)
        assert.deepEqual([...cfg.protectedFilePatterns].sort(), ["*.env", "*.secret"])
        for (const t of [...COMPRESS_DEFAULT_PROTECTED_TOOLS, "custom-tool"]) {
            assert.ok(
                cfg.compress.protectedTools.includes(t),
                `missing ${t} in merged protectedTools`,
            )
        }
        const counts = new Map<string, number>()
        for (const t of cfg.compress.protectedTools) {
            counts.set(t, (counts.get(t) ?? 0) + 1)
        }
        for (const [, n] of counts) assert.equal(n, 1)
    } finally {
        fx.cleanup()
    }
})

test("getConfig: a malformed config file falls back to previous layer values", () => {
    const fx = createFixture()
    try {
        writeFileSync(
            join(fx.globalDcpDir, "dcp.jsonc"),
            JSON.stringify({ compress: { mode: "message" } }),
            "utf-8",
        )
        writeFileSync(join(fx.opencodeDir, "dcp.jsonc"), "{ this is not json", "utf-8")

        const cfg = getConfig(fx.ctx)
        assert.equal(cfg.compress.mode, "message")
    } finally {
        fx.cleanup()
    }
})

test("getConfig prefers .jsonc over .json when both exist", () => {
    const fx = createFixture()
    try {
        writeFileSync(
            join(fx.globalDcpDir, "dcp.jsonc"),
            JSON.stringify({ compress: { mode: "message" } }),
            "utf-8",
        )
        writeFileSync(
            join(fx.globalDcpDir, "dcp.json"),
            JSON.stringify({ compress: { mode: "range" } }),
            "utf-8",
        )
        const cfg = getConfig(fx.ctx)
        assert.equal(cfg.compress.mode, "message")
    } finally {
        fx.cleanup()
    }
})

test("getConfig falls back to .json when .jsonc is absent", () => {
    const fx = createFixture()
    try {
        writeFileSync(
            join(fx.globalDcpDir, "dcp.json"),
            JSON.stringify({ compress: { permission: "deny" } }),
            "utf-8",
        )
        const cfg = getConfig(fx.ctx)
        assert.equal(cfg.compress.permission, "deny")
    } finally {
        fx.cleanup()
    }
})
