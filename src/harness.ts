import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"
import { readAccessCredential } from "./auth"
import { Profile, type HarnessName } from "./model"
import { canonicalDirectory, profileDirectory, profilesRoot } from "./paths"
import { pushCanonical } from "./sync"
import { currentUsage } from "./usage"

export abstract class Harness {
  abstract readonly name: HarnessName
  abstract readonly executable: string
  abstract readonly configEnvironmentKey: "CLAUDE_CONFIG_DIR" | "CODEX_HOME"
  abstract readonly authenticationEnvironmentKeys: readonly string[]
  readonly authenticationEnvironmentPrefixes: readonly string[] = []
  abstract signInArguments(): string[]
  abstract launchArguments(arguments_: string[]): string[]

  async profiles(): Promise<Profile[]> {
    const root = profilesRoot(this.name)
    if (!existsSync(root)) return []

    return Promise.all(readdirSync(root, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."))
      .map((entry) => this.loadProfile(entry.name)))
  }

  async createProfile(name: string): Promise<Profile> {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) {
      throw new Error("profile names use lowercase letters, numbers, and hyphens")
    }
    const directory = profileDirectory(this.name, name)
    if (existsSync(directory)) throw new Error(`${name} already exists`)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    pushCanonical(this.name, [directory])
    return new Profile(this.name, name, directory)
  }

  async importCanonical(name = "personal"): Promise<Profile> {
    const canonical = canonicalDirectory(this.name)
    if (!existsSync(canonical) || !statSync(canonical).isDirectory()) {
      throw new Error(`${this.name} canonical config directory does not exist: ${canonical}`)
    }
    if (!await readAccessCredential(this.name, canonical)) {
      throw new Error(`${this.name} is not signed in at ${canonical}`)
    }
    const directory = profileDirectory(this.name, name)
    if (existsSync(directory)) throw new Error(`${name} already exists`)
    mkdirSync(profilesRoot(this.name), { recursive: true, mode: 0o700 })
    symlinkSync(canonical, directory, "dir")
    return this.loadProfile(name)
  }

  environment(profile: Profile): Record<string, string> {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    for (const key of this.authenticationEnvironmentKeys) delete environment[key]
    for (const key of Object.keys(environment)) {
      if (this.authenticationEnvironmentPrefixes.some((prefix) => key.startsWith(prefix))) delete environment[key]
    }
    environment.USER = userInfo().username
    environment[this.configEnvironmentKey] = profile.directory
    Object.assign(environment, this.additionalEnvironment(profile))
    return environment
  }

  protected additionalEnvironment(_profile: Profile): Record<string, string> {
    return {}
  }

  private async loadProfile(name: string): Promise<Profile> {
    const directory = profileDirectory(this.name, name)
    const credential = await readAccessCredential(this.name, directory)
    const usage = await currentUsage(this.name, name, credential)
    return new Profile(this.name, name, directory, usage, credential?.identity)
  }
}

export class ClaudeHarness extends Harness {
  readonly name = "claude" as const
  readonly executable = process.env.AGEMUX_CLAUDE_BIN ?? Bun.which("claude") ?? "claude"
  readonly configEnvironmentKey = "CLAUDE_CONFIG_DIR" as const
  readonly authenticationEnvironmentKeys = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AWS_API_KEY",
    "ANTHROPIC_AWS_BASE_URL",
    "ANTHROPIC_AWS_WORKSPACE_ID",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
    "ANTHROPIC_FOUNDRY_BASE_URL",
    "ANTHROPIC_FOUNDRY_RESOURCE",
    "ANTHROPIC_GOOGLE_CLOUD_BASE_URL",
    "ANTHROPIC_GOOGLE_CLOUD_LOCATION",
    "ANTHROPIC_GOOGLE_CLOUD_PROJECT",
    "ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID",
    "ANTHROPIC_VERTEX_BASE_URL",
    "ANTHROPIC_VERTEX_PROJECT_ID",
    "ANTHROPIC_FEDERATION_RULE_ID",
    "ANTHROPIC_IDENTITY_TOKEN",
    "ANTHROPIC_IDENTITY_TOKEN_FILE",
    "ANTHROPIC_ORGANIZATION_ID",
    "ANTHROPIC_PROFILE",
    "ANTHROPIC_SERVICE_ACCOUNT_ID",
    "ANTHROPIC_UNIX_SOCKET",
    "ANTHROPIC_WORKSPACE_ID",
    "AWS_BEARER_TOKEN_BEDROCK",
    "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
    "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
    "CLAUDE_CODE_HOST_CREDS_FILE",
    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
    "CLAUDE_CODE_OAUTH_SCOPES",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
    "CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH",
    "CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
    "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
    "CLAUDE_CODE_SKIP_MANTLE_AUTH",
    "CLAUDE_CODE_SKIP_VERTEX_AUTH",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_GATEWAY",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    "CLAUDE_BG_AUTH_SNAPSHOT_PATH",
    "CLAUDE_SECURESTORAGE_CONFIG_DIR",
    "CLAUDE_CODE_SESSION_ACCESS_TOKEN",
    "CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR",
    "CLAUDE_SESSION_INGRESS_TOKEN_FILE",
    "CLAUDE_TRUSTED_DEVICE_TOKEN",
    "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL",
  ] as const
  readonly authenticationEnvironmentPrefixes = [
    "ANTHROPIC_AWS_",
    "ANTHROPIC_BEDROCK_",
    "ANTHROPIC_FOUNDRY_",
    "ANTHROPIC_GOOGLE_CLOUD_",
    "ANTHROPIC_VERTEX_",
    "CLAUDE_BG_AUTH_",
    "CLAUDE_CODE_API_KEY_",
    "CLAUDE_CODE_CUSTOM_OAUTH_",
    "CLAUDE_CODE_HOST_",
    "CLAUDE_CODE_OAUTH_",
    "CLAUDE_CODE_SDK_HAS_",
    "CLAUDE_CODE_SKIP_",
    "CLAUDE_CODE_USE_",
    "CLAUDE_SECURESTORAGE_",
  ] as const

  signInArguments(): string[] {
    return ["auth", "login"]
  }

  launchArguments(arguments_: string[]): string[] {
    return arguments_
  }

  protected additionalEnvironment(profile: Profile): Record<string, string> {
    return { ANTHROPIC_CONFIG_DIR: join(profile.directory, ".anthropic") }
  }
}

export class CodexHarness extends Harness {
  readonly name = "codex" as const
  readonly executable = process.env.AGEMUX_CODEX_BIN ?? Bun.which("codex") ?? "codex"
  readonly configEnvironmentKey = "CODEX_HOME" as const
  readonly authenticationEnvironmentKeys = [
    "CODEX_ACCESS_TOKEN",
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_FEDERATION_RULE_ID",
    "OPENAI_IDENTITY_TOKEN_FILE",
    "OPENAI_WORKLOAD_IDENTITY_CONTEXT",
  ] as const

  signInArguments(): string[] {
    return ["login", "-c", 'cli_auth_credentials_store="file"']
  }

  launchArguments(arguments_: string[]): string[] {
    return ["-c", 'cli_auth_credentials_store="file"', ...arguments_]
  }
}

export function harnessNamed(name: HarnessName): Harness {
  return name === "claude" ? new ClaudeHarness() : new CodexHarness()
}

export function harnessFromArgument(value: string | undefined): HarnessName | undefined {
  return value === "claude" || value === "codex" ? value : undefined
}

export function executableExists(harness: Harness): boolean {
  return existsSync(harness.executable)
}
