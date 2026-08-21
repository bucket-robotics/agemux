import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { ClaudeHarness, CodexHarness } from "../src/harness"
import { Profile } from "../src/model"

describe("CodexHarness", () => {
  const roots: string[] = []
  afterEach(() => {
    delete process.env.AGEMUX_HOME
    delete process.env.AGEMUX_CODEX_HOME
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  test("refuses to create a dangling canonical import", async () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-harness-"))
    roots.push(root)
    const canonical = join(root, ".codex")
    process.env.AGEMUX_HOME = join(root, ".agemux")
    process.env.AGEMUX_CODEX_HOME = canonical

    const harness = new CodexHarness()
    expect(harness.importCanonical("personal")).rejects.toThrow("canonical config directory does not exist")
  })

  test("forces file auth and isolates CODEX_HOME on every launch", async () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-harness-"))
    roots.push(root)
    process.env.AGEMUX_HOME = join(root, ".agemux")
    const harness = new CodexHarness()
    const profile = await harness.createProfile("work")

    expect(harness.launchArguments([])).toEqual(["-c", 'cli_auth_credentials_store="file"'])
    const original = setAuthenticationOverrides(harness)
    try {
      const environment = harness.environment(profile)
      expect(environment.CODEX_HOME).toBe(profile.directory)
      for (const key of harness.authenticationEnvironmentKeys) expect(environment[key]).toBeUndefined()
    } finally {
      restoreEnvironment(original)
    }
  })
})

describe("ClaudeHarness", () => {
  test("removes direct-auth overrides from a profile launch", () => {
    const harness = new ClaudeHarness()
    const original = setAuthenticationOverrides(harness)
    const anthropicConfig = process.env.ANTHROPIC_CONFIG_DIR
    const provenBypasses = [
      "ANTHROPIC_CUSTOM_HEADERS",
      "ANTHROPIC_UNIX_SOCKET",
      "AWS_BEARER_TOKEN_BEDROCK",
      "CLAUDE_BG_AUTH_SNAPSHOT_PATH",
      "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
      "CLAUDE_CODE_CUSTOM_OAUTH_URL",
      "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
      "CLAUDE_CODE_HOST_CREDS_FILE",
      "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
      "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
      "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
      "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
      "CLAUDE_SECURESTORAGE_CONFIG_DIR",
    ] as const
    const toolCredentials = [
      "AWS_ACCESS_KEY_ID",
      "AWS_ENDPOINT_URL_S3",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "CLOUDSDK_AUTH_ACCESS_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ] as const
    const bypassEnvironment = Object.fromEntries(provenBypasses.map((key) => [key, process.env[key]]))
    const toolEnvironment = Object.fromEntries(toolCredentials.map((key) => [key, process.env[key]]))
    const ambientUser = process.env.USER
    process.env.ANTHROPIC_CONFIG_DIR = "/wrong/global-anthropic-config"
    process.env.USER = "wrong-ambient-user"
    for (const key of provenBypasses) process.env[key] = "wrong-ambient-auth"
    for (const key of toolCredentials) process.env[key] = "ambient-tool-credential"
    try {
      const profile = new Profile("claude", "work", "/tmp/work")
      const environment = harness.environment(profile)
      expect(environment.CLAUDE_CONFIG_DIR).toBe(profile.directory)
      expect(environment.ANTHROPIC_CONFIG_DIR).toBe("/tmp/work/.anthropic")
      expect(environment.USER).toBe(userInfo().username)
      for (const key of provenBypasses) expect(environment[key]).toBeUndefined()
      for (const key of toolCredentials) expect(environment[key]).toBe("ambient-tool-credential")
      for (const key of harness.authenticationEnvironmentKeys) expect(environment[key]).toBeUndefined()
      for (const prefix of harness.authenticationEnvironmentPrefixes) {
        expect(Object.keys(environment).some((key) => key.startsWith(prefix))).toBeFalse()
      }
    } finally {
      restoreEnvironment(bypassEnvironment)
      restoreEnvironment(original)
      restoreEnvironment(toolEnvironment)
      if (anthropicConfig === undefined) delete process.env.ANTHROPIC_CONFIG_DIR
      else process.env.ANTHROPIC_CONFIG_DIR = anthropicConfig
      if (ambientUser === undefined) delete process.env.USER
      else process.env.USER = ambientUser
    }
  })
})

function restoreEnvironment(environment: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function setAuthenticationOverrides(harness: ClaudeHarness | CodexHarness): Record<string, string | undefined> {
  const original = Object.fromEntries(harness.authenticationEnvironmentKeys.map((key) => [key, process.env[key]]))
  for (const key of harness.authenticationEnvironmentKeys) process.env[key] = "wrong-ambient-auth"
  return original
}
