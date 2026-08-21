import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AccessCredential } from "../src/auth"
import { currentUsage, parseClaudeUsage, parseCodexUsage } from "../src/usage"

describe("usage parsing", () => {
  test("maps Claude limits to the named windows", () => {
    const usage = parseClaudeUsage({ limits: [
      { kind: "session", percent: 18, resets_at: "2026-08-20T01:00:00Z" },
      { kind: "weekly_all", percent: 36, resets_at: "2026-08-25T01:00:00Z" },
    ] }, 123, "max")
    expect(usage.fiveHour?.usedPercent).toBe(18)
    expect(usage.weekly?.usedPercent).toBe(36)
    expect(usage.plan).toBe("max")
  })

  test("maps Codex windows by duration instead of array position", () => {
    const usage = parseCodexUsage({
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 69, limit_window_seconds: 604800, reset_at: 200 },
        secondary_window: { used_percent: 33, limit_window_seconds: 18000, reset_at: 100 },
      },
    }, 123)
    expect(usage.fiveHour).toEqual({ usedPercent: 33, resetsAt: 100 })
    expect(usage.weekly).toEqual({ usedPercent: 69, resetsAt: 200 })
    expect(usage.plan).toBe("pro")
  })
})

describe("currentUsage", () => {
  const originalFetch = globalThis.fetch
  const roots: string[] = []

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.AGEMUX_HOME
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  test("does not reuse a profile-name cache after the account changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-usage-"))
    roots.push(root)
    process.env.AGEMUX_HOME = root
    const first = credential("first-token", "first-account")
    const second = credential("second-token", "second-account")
    globalThis.fetch = Object.assign(async () => Response.json({
      rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18_000 } },
    }), { preconnect: originalFetch.preconnect })
    expect((await currentUsage("codex", "work", first, 100))?.fiveHour?.usedPercent).toBe(12)

    globalThis.fetch = Object.assign(async () => { throw new Error("offline") }, { preconnect: originalFetch.preconnect })
    expect(await currentUsage("codex", "work", second, 101)).toBeUndefined()
    expect((await currentUsage("codex", "work", first, 101))?.fiveHour?.usedPercent).toBe(12)
  })

  test("passes a bounded abort signal to usage requests", async () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-usage-"))
    roots.push(root)
    process.env.AGEMUX_HOME = root
    let signal: AbortSignal | undefined
    globalThis.fetch = Object.assign(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      signal = init?.signal ?? undefined
      return new Response("unauthorized", { status: 401 })
    }, { preconnect: originalFetch.preconnect })

    expect(await currentUsage("codex", "work", credential("token", "account"), 100)).toBeUndefined()
    expect(signal).toBeInstanceOf(AbortSignal)
  })
})

function credential(accessToken: string, accountId: string): AccessCredential {
  return { accessToken, accountId, identity: {} }
}
