import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"
import type { HarnessName, ProfileIdentity } from "./model"
import { canonicalDirectory } from "./paths"

export interface AccessCredential {
  accessToken: string
  accountId?: string
  expiresAt?: number
  identity: ProfileIdentity
}

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string
    expiresAt?: number
    subscriptionType?: string
  }
}

interface CodexCredentials {
  tokens?: {
    access_token?: string
    account_id?: string
    id_token?: string
  }
}

export async function readAccessCredential(
  harness: HarnessName,
  directory: string,
): Promise<AccessCredential | undefined> {
  try {
    return harness === "claude" ? await readClaudeCredential(directory) : readCodexCredential(directory)
  } catch {
    // Codex rewrites auth.json in place. A reader can observe a partial body;
    // absence is safer than ever replaying its rotating refresh token.
    return undefined
  }
}

async function readClaudeCredential(directory: string): Promise<AccessCredential | undefined> {
  const file = join(directory, ".credentials.json")
  const raw = existsSync(file) ? readFileSync(file, "utf8") : await readClaudeKeychain(directory)
  if (!raw) return undefined

  const oauth = (JSON.parse(raw) as ClaudeCredentials).claudeAiOauth
  if (!oauth?.accessToken) return undefined

  return {
    accessToken: oauth.accessToken,
    expiresAt: oauth.expiresAt ? Math.floor(oauth.expiresAt / 1000) : undefined,
    identity: { plan: oauth.subscriptionType },
  }
}

async function readClaudeKeychain(directory: string): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined

  const canonical = realpathSync(directory)
  const canonicalHome = realpathSync(canonicalDirectory("claude"))
  const suffix = createHash("sha256").update(canonical).digest("hex").slice(0, 8)
  const service = canonical === canonicalHome ? "Claude Code-credentials" : `Claude Code-credentials-${suffix}`
  const user = userInfo().username

  const child = Bun.spawn([
    "/usr/bin/security",
    "find-generic-password",
    "-w",
    "-s",
    service,
    "-a",
    user,
  ], { stdout: "pipe", stderr: "ignore" })
  const raw = await new Response(child.stdout).text()
  return (await child.exited) === 0 ? raw.trim() : undefined
}

function readCodexCredential(directory: string): AccessCredential | undefined {
  const file = join(directory, "auth.json")
  if (!existsSync(file)) return undefined

  const tokens = (JSON.parse(readFileSync(file, "utf8")) as CodexCredentials).tokens
  if (!tokens?.access_token) return undefined

  const accessClaims = decodeJwt(tokens.access_token)
  const idClaims = tokens.id_token ? decodeJwt(tokens.id_token) : undefined
  const authClaims = objectAt(idClaims, "https://api.openai.com/auth")

  return {
    accessToken: tokens.access_token,
    accountId: tokens.account_id,
    expiresAt: numberAt(accessClaims, "exp"),
    identity: {
      email: stringAt(idClaims, "email"),
      plan: stringAt(authClaims, "chatgpt_plan_type"),
    },
  }
}

function decodeJwt(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1]
  if (!payload) return undefined
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function objectAt(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const nested = value?.[key]
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>) : undefined
}

function stringAt(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const candidate = value?.[key]
  return typeof candidate === "string" ? candidate : undefined
}

function numberAt(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const candidate = value?.[key]
  return typeof candidate === "number" ? candidate : undefined
}
