import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setupShell } from "../src/setup"

describe("setupShell", () => {
  const originalHome = process.env.HOME
  const roots: string[] = []

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  test("adds idempotent zsh wrappers without replacing existing config", () => {
    const home = mkdtempSync(join(tmpdir(), "agemux-setup-"))
    roots.push(home)
    process.env.HOME = home
    writeFileSync(join(home, ".zshrc"), "export EDITOR=vim\n", { mode: 0o644 })

    expect(setupShell("zsh", "/opt/agemux/bin/agemux").changed).toBeTrue()
    expect(setupShell("zsh", "/opt/agemux/bin/agemux").changed).toBeFalse()
    const config = readFileSync(join(home, ".zshrc"), "utf8")
    expect(config.match(/# >>> agemux >>>/g)?.length).toBe(1)
    expect(config).toContain("export EDITOR=vim")
    expect(config).toContain("command '/opt/agemux/bin/agemux' claude")
    expect(config).toContain('command codex "$@"')
  })

  test("rejects shells whose config it does not own", () => {
    const home = mkdtempSync(join(tmpdir(), "agemux-setup-"))
    roots.push(home)
    process.env.HOME = home
    expect(() => setupShell("fish")).toThrow("expected zsh or bash")
  })
})
