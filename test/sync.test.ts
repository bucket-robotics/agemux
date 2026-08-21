import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pushCanonical, syncFiles, syncReport, unifiedDiff } from "../src/sync"

describe("sync", () => {
  const roots: string[] = []
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  test("is report-only until push is explicit", () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-sync-"))
    roots.push(root)
    process.env.AGEMUX_HOME = join(root, ".agemux")
    const canonical = join(root, ".claude")
    process.env.AGEMUX_CLAUDE_CONFIG_DIR = canonical
    const profile = join(root, "profile")
    mkdirSync(canonical)
    mkdirSync(profile)
    writeFileSync(join(canonical, "CLAUDE.md"), "canonical")
    writeFileSync(join(profile, "CLAUDE.md"), "profile")

    expect(syncReport("claude", [profile])[0]).toEqual({
      file: "CLAUDE.md",
      status: "drift",
      differingProfiles: ["profile"],
    })
    expect(readFileSync(join(profile, "CLAUDE.md"), "utf8")).toBe("profile")

    pushCanonical("claude", [profile], "CLAUDE.md")
    expect(readFileSync(join(profile, "CLAUDE.md"), "utf8")).toBe("canonical")
    delete process.env.AGEMUX_CLAUDE_CONFIG_DIR
  })

  test("never syncs config files that can carry credentials", () => {
    expect(syncFiles("claude")).toEqual(["CLAUDE.md", "keybindings.json"])
    expect(syncFiles("codex")).toEqual(["AGENTS.md"])
  })

  test("refuses to overwrite a file-level symbolic link", () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-sync-"))
    roots.push(root)
    const canonical = join(root, ".claude")
    const profile = join(root, "profile")
    const outside = join(root, "outside")
    process.env.AGEMUX_CLAUDE_CONFIG_DIR = canonical
    mkdirSync(canonical)
    mkdirSync(profile)
    writeFileSync(join(canonical, "CLAUDE.md"), "canonical")
    writeFileSync(outside, "outside")
    symlinkSync(outside, join(profile, "CLAUDE.md"))

    expect(() => pushCanonical("claude", [profile], "CLAUDE.md")).toThrow("refusing to replace symbolic link")
    expect(readFileSync(outside, "utf8")).toBe("outside")
    delete process.env.AGEMUX_CLAUDE_CONFIG_DIR
  })

  test("produces a real insertion diff without rewriting following lines", () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-sync-"))
    roots.push(root)
    const canonical = join(root, "canonical")
    const profile = join(root, "profile")
    mkdirSync(canonical)
    mkdirSync(profile)
    writeFileSync(join(canonical, "AGENTS.md"), "one\nthree\n")
    writeFileSync(join(profile, "AGENTS.md"), "one\ntwo\nthree\n")

    const diff = unifiedDiff(canonical, profile, "AGENTS.md")
    expect(diff).toContain("+two")
    expect(diff).not.toContain("-three")
  })
})
