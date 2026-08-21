import { homedir } from "node:os"
import { join } from "node:path"
import type { HarnessName } from "./model"

export function agemuxHome(): string {
  return process.env.AGEMUX_HOME ?? join(homedir(), ".agemux")
}

export function profilesRoot(harness: HarnessName): string {
  return join(agemuxHome(), harness)
}

export function profileDirectory(harness: HarnessName, name: string): string {
  return join(profilesRoot(harness), name)
}

export function usageCachePath(harness: HarnessName, name: string): string {
  return join(agemuxHome(), "cache", harness, `${name}.json`)
}

export function canonicalDirectory(harness: HarnessName): string {
  const override = process.env[harness === "claude" ? "AGEMUX_CLAUDE_CONFIG_DIR" : "AGEMUX_CODEX_HOME"]
  if (override) return override
  return join(homedir(), harness === "claude" ? ".claude" : ".codex")
}
