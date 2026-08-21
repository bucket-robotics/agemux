import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { AccessCredential } from "./auth"
import { atomicWrite } from "./files"
import type { HarnessName, UsageSnapshot, UsageWindow } from "./model"
import { usageCachePath } from "./paths"

const FIVE_HOURS = 5 * 60 * 60
const SEVEN_DAYS = 7 * 24 * 60 * 60
const USAGE_TIMEOUT_MS = 5_000

interface UsageCache {
  credentialFingerprint: string
  snapshot: UsageSnapshot
}

export async function currentUsage(
  harness: HarnessName,
  name: string,
  credential: AccessCredential | undefined,
  now = Math.floor(Date.now() / 1000),
): Promise<UsageSnapshot | undefined> {
  if (!credential) return undefined
  const fingerprint = credentialFingerprint(credential)
  const cached = readUsageCache(harness, name, fingerprint)
  if (credential.expiresAt !== undefined && credential.expiresAt <= now) return cached

  try {
    const fresh = harness === "claude"
      ? await fetchClaudeUsage(credential, now)
      : await fetchCodexUsage(credential, now)
    writeUsageCache(harness, name, fingerprint, fresh)
    return fresh
  } catch {
    return cached
  }
}

export function parseClaudeUsage(body: unknown, fetchedAt: number, plan?: string): UsageSnapshot {
  const value = asObject(body)
  const limits = Array.isArray(value.limits) ? value.limits.map(asObject) : []
  const session = limits.find((limit) => limit.kind === "session")
  const weekly = limits.find((limit) => limit.kind === "weekly_all")

  return compactSnapshot({
    fetchedAt,
    plan,
    fiveHour: session ? claudeLimit(session) : claudeLegacy(value.five_hour),
    weekly: weekly ? claudeLimit(weekly) : claudeLegacy(value.seven_day),
  })
}

export function parseCodexUsage(body: unknown, fetchedAt: number): UsageSnapshot {
  const value = asObject(body)
  const rateLimit = asObject(value.rate_limit)
  const windows = [rateLimit.primary_window, rateLimit.secondary_window]
    .filter((window): window is unknown => window != null)
    .map(asObject)

  return compactSnapshot({
    fetchedAt,
    plan: stringValue(value.plan_type),
    fiveHour: codexWindow(windows.find((window) => window.limit_window_seconds === FIVE_HOURS)),
    weekly: codexWindow(windows.find((window) => window.limit_window_seconds === SEVEN_DAYS)),
  })
}

async function fetchClaudeUsage(credential: AccessCredential, fetchedAt: number): Promise<UsageSnapshot> {
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": claudeUserAgent(),
    },
  })
  if (!response.ok) throw new Error(`Claude usage returned ${response.status}`)
  return parseClaudeUsage(await response.json(), fetchedAt, credential.identity.plan)
}

function claudeUserAgent(): string {
  const executable = process.env.AGEMUX_CLAUDE_BIN ?? Bun.which("claude")
  if (!executable) return "claude-cli"
  const version = Bun.spawnSync([executable, "--version"], { stderr: "ignore" })
    .stdout.toString().trim().split(/\s+/)[0]
  return version ? `claude-cli/${version} (external, cli)` : "claude-cli"
}

async function fetchCodexUsage(credential: AccessCredential, fetchedAt: number): Promise<UsageSnapshot> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.accessToken}`,
    Accept: "application/json",
    "User-Agent": "codex-cli",
  }
  if (credential.accountId) headers["ChatGPT-Account-Id"] = credential.accountId

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers,
    signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Codex usage returned ${response.status}`)
  return parseCodexUsage(await response.json(), fetchedAt)
}

function claudeLimit(value: Record<string, unknown>): UsageWindow | undefined {
  const usedPercent = numberValue(value.percent)
  if (usedPercent === undefined) return undefined
  const reset = stringValue(value.resets_at)
  return { usedPercent, resetsAt: reset ? Math.floor(Date.parse(reset) / 1000) : undefined }
}

function claudeLegacy(value: unknown): UsageWindow | undefined {
  const object = asObject(value)
  const usedPercent = numberValue(object.utilization)
  if (usedPercent === undefined) return undefined
  const reset = stringValue(object.resets_at)
  return { usedPercent, resetsAt: reset ? Math.floor(Date.parse(reset) / 1000) : undefined }
}

function codexWindow(value: Record<string, unknown> | undefined): UsageWindow | undefined {
  if (!value) return undefined
  const usedPercent = numberValue(value.used_percent)
  if (usedPercent === undefined) return undefined
  return { usedPercent, resetsAt: numberValue(value.reset_at) }
}

function compactSnapshot(snapshot: UsageSnapshot): UsageSnapshot {
  return Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value !== undefined)) as unknown as UsageSnapshot
}

function readUsageCache(harness: HarnessName, name: string, fingerprint: string): UsageSnapshot | undefined {
  try {
    const cache = JSON.parse(readFileSync(usageCachePath(harness, name), "utf8")) as UsageCache
    return cache.credentialFingerprint === fingerprint ? cache.snapshot : undefined
  } catch {
    return undefined
  }
}

function writeUsageCache(harness: HarnessName, name: string, credentialFingerprint: string, snapshot: UsageSnapshot): void {
  const path = usageCachePath(harness, name)
  atomicWrite(path, `${JSON.stringify({ credentialFingerprint, snapshot } satisfies UsageCache)}\n`)
}

function credentialFingerprint(credential: AccessCredential): string {
  const identity = credential.accountId ?? credential.identity.email ?? credential.accessToken
  return createHash("sha256").update(identity).digest("hex")
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
