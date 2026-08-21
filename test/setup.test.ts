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
    expect(config).toContain("unalias claude")
    expect(config).toContain("command '/opt/agemux/bin/agemux' claude")
    expect(config).toContain('command codex "$@"')
  })

  test("covers Bash login and non-login shells without preserving aliases", () => {
    const home = mkdtempSync(join(tmpdir(), "agemux-setup-"))
    roots.push(home)
    process.env.HOME = home
    writeFileSync(join(home, ".bash_profile"), "export LOGIN_SHELL=yes\n", { mode: 0o644 })

    const result = setupShell("bash", "/opt/agemux/bin/agemux")

    expect(result.paths).toEqual([join(home, ".bashrc"), join(home, ".bash_profile")])
    for (const path of result.paths) {
      const config = readFileSync(path, "utf8")
      expect(config).toContain("unalias claude")
      expect(config).toContain("unalias codex")
      expect(config).toContain("command '/opt/agemux/bin/agemux' claude")
      expect(Bun.spawnSync(["sh", "-n", path]).exitCode).toBe(0)
    }
    const bash = Bun.which("bash")
    if (!bash) throw new Error("bash is required to test Bash setup")
    const aliasedShell = Bun.spawnSync([
      bash,
      "--noprofile",
      "--norc",
      "-ic",
      'alias claude="echo aliased"; . "$AGEMUX_SETUP_CONFIG"; type -t claude',
    ], { env: { ...process.env, AGEMUX_SETUP_CONFIG: join(home, ".bashrc") } })
    expect(aliasedShell.exitCode).toBe(0)
    expect(aliasedShell.stdout.toString().trim()).toBe("function")
    expect(readFileSync(join(home, ".bash_profile"), "utf8")).toContain("export LOGIN_SHELL=yes")
    expect(setupShell("bash", "/opt/agemux/bin/agemux").changed).toBeFalse()
  })

  test("uses an existing profile as the Bash login file", () => {
    const home = mkdtempSync(join(tmpdir(), "agemux-setup-"))
    roots.push(home)
    process.env.HOME = home
    writeFileSync(join(home, ".profile"), "export SHARED_PROFILE=yes\n", { mode: 0o644 })

    expect(setupShell("bash", "/opt/agemux/bin/agemux").paths).toEqual([
      join(home, ".bashrc"),
      join(home, ".profile"),
    ])
    expect(Bun.spawnSync(["sh", "-n", join(home, ".profile")]).exitCode).toBe(0)
  })

  test("rejects shells whose config it does not own", () => {
    const home = mkdtempSync(join(tmpdir(), "agemux-setup-"))
    roots.push(home)
    process.env.HOME = home
    expect(() => setupShell("fish")).toThrow("expected zsh or bash")
  })
})
