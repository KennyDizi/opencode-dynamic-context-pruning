import { existsSync, readFileSync, statSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"

export interface PromptPaths {
    defaultsDir: string
    globalOverridesDir: string
    configDirOverridesDir: string | null
    projectOverridesDir: string | null
}

export interface PromptFileDescriptor {
    fileName: string
    description: string
    usage: string
}

export const DEFAULTS_README_FILE = "README.md"

function findOpencodeDir(startDir: string): string | null {
    let current = startDir
    while (current !== "/") {
        const candidate = join(current, ".opencode")
        if (existsSync(candidate)) {
            try {
                if (statSync(candidate).isDirectory()) {
                    return candidate
                }
            } catch {
                // ignore inaccessible entries while walking upward
            }
        }
        const parent = dirname(current)
        if (parent === current) {
            break
        }
        current = parent
    }
    return null
}

export function resolvePromptPaths(workingDirectory: string): PromptPaths {
    const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
    const globalRoot = join(configHome, "opencode", "dcp-prompts")
    const defaultsDir = join(globalRoot, "defaults")
    const globalOverridesDir = join(globalRoot, "overrides")

    const configDirOverridesDir = process.env.OPENCODE_CONFIG_DIR
        ? join(process.env.OPENCODE_CONFIG_DIR, "dcp-prompts", "overrides")
        : null

    const opencodeDir = findOpencodeDir(workingDirectory)
    const projectOverridesDir = opencodeDir ? join(opencodeDir, "dcp-prompts", "overrides") : null

    return {
        defaultsDir,
        globalOverridesDir,
        configDirOverridesDir,
        projectOverridesDir,
    }
}

export function readFileIfExists(filePath: string): string | null {
    if (!existsSync(filePath)) {
        return null
    }

    try {
        return readFileSync(filePath, "utf-8")
    } catch {
        return null
    }
}

export function buildDefaultPromptFileContent(bundledEditableText: string): string {
    return `${bundledEditableText.trim()}\n`
}

export function buildDefaultsReadmeContent(definitions: PromptFileDescriptor[]): string {
    const lines: string[] = []
    lines.push("# DCP Prompt Defaults")
    lines.push("")
    lines.push("This directory stores the DCP prompts.")
    lines.push("Each prompt file here should contain plain text only (no XML wrappers).")
    lines.push("")
    lines.push("## Creating Overrides")
    lines.push("")
    lines.push(
        "1. Copy a prompt file from this directory into an overrides directory using the same filename.",
    )
    lines.push("2. Edit the copied file using plain text.")
    lines.push("3. Restart OpenCode.")
    lines.push("")
    lines.push("To reset an override, delete the matching file from your overrides directory.")
    lines.push("")
    lines.push(
        "Do not edit the default prompt files directly, they are just for reference, only files in the overrides directory are used.",
    )
    lines.push("")
    lines.push("Override precedence (highest first):")
    lines.push("1. `.opencode/dcp-prompts/overrides/` (project)")
    lines.push("2. `$OPENCODE_CONFIG_DIR/dcp-prompts/overrides/` (config dir)")
    lines.push("3. `~/.config/opencode/dcp-prompts/overrides/` (global)")
    lines.push("")
    lines.push("## Prompt Files")
    lines.push("")

    for (const definition of definitions) {
        lines.push(`- \`${definition.fileName}\``)
        lines.push(`  - Purpose: ${definition.description}.`)
        lines.push(`  - Runtime use: ${definition.usage}.`)
    }

    return `${lines.join("\n")}\n`
}

