import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("account picker", () => {
  const roots: string[] = []
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  test("launches the harness selected after switching", async () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-picker-test-"))
    roots.push(root)
    const home = join(root, "home")
    const bin = join(root, "bin")
    const launched = join(root, "launched")
    mkdirSync(join(home, "claude", "personal"), { recursive: true })
    mkdirSync(join(home, "codex", "work"), { recursive: true })
    mkdirSync(bin)

    const claude = fakeHarness(bin, "claude", launched)
    const codex = fakeHarness(bin, "codex", launched)
    const runner = join(root, "run-picker")
    writeFileSync(runner, `#!/bin/sh
export AGEMUX_HOME=${quote(home)}
export AGEMUX_CLAUDE_BIN=${quote(claude)}
export AGEMUX_CODEX_BIN=${quote(codex)}
exec ${quote(process.execPath)} ${quote(join(import.meta.dir, "..", "src", "main.ts"))} claude
`)
    chmodSync(runner, 0o755)

    const command = ptyCommand(root, runner)
    const child = Bun.spawn(command, {
      stdin: process.platform === "darwin" ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = new Response(child.stdout).text()
    const stderr = new Response(child.stderr).text()
    if (process.platform !== "darwin") {
      const stdin = child.stdin
      if (!stdin) throw new Error("picker PTY stdin was not created")
      await Bun.sleep(2_000)
      stdin.write("\t")
      await Bun.sleep(500)
      stdin.write("\r")
      stdin.end()
    }

    const status = await child.exited
    if (status !== 0) throw new Error(`picker exited ${status}\n${await stdout}\n${await stderr}`)
    expect(existsSync(launched)).toBeTrue()
    expect(readFileSync(launched, "utf8").trim()).toBe("codex")
  }, 8_000)

  test("restores the terminal and exits nonzero when profile loading fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-picker-test-"))
    roots.push(root)
    const invalidHome = join(root, "not-a-directory")
    const bin = join(root, "bin")
    mkdirSync(invalidHome)
    mkdirSync(bin)
    writeFileSync(join(invalidHome, "claude"), "file")
    const claude = fakeHarness(bin, "claude", join(root, "unused"))
    const runner = join(root, "run-broken-picker")
    writeFileSync(runner, `#!/bin/sh
export AGEMUX_HOME=${quote(invalidHome)}
export AGEMUX_CLAUDE_BIN=${quote(claude)}
exec ${quote(process.execPath)} ${quote(join(import.meta.dir, "..", "src", "main.ts"))} claude
`)
    chmodSync(runner, 0o755)

    const child = Bun.spawn(exitPtyCommand(root, runner), { stdout: "pipe", stderr: "pipe" })
    const stdout = new Response(child.stdout).text()
    const stderr = new Response(child.stderr).text()

    expect(await child.exited).toBe(1)
    const output = `${await stdout}${await stderr}`
    expect(output).toContain("agemux:")
    expect(output).toContain("\x1b[?1049h")
    expect(output).toContain("\x1b[?1049l")
  }, 5_000)
})

function fakeHarness(bin: string, name: string, launched: string): string {
  const executable = join(bin, name)
  writeFileSync(executable, `#!/bin/sh\necho ${quote(name)} > ${quote(launched)}\n`)
  chmodSync(executable, 0o755)
  return executable
}

function ptyCommand(root: string, runner: string): string[] {
  if (process.platform !== "darwin") return ["script", "-q", "-e", "-c", runner, "/dev/null"]

  const expectScript = join(root, "drive-picker")
  writeFileSync(expectScript, `#!/usr/bin/expect -f
set timeout 5
spawn ${runner}
expect {
  -re "personal" {}
  timeout { exit 124 }
}
send "\\t"
after 500
send "\\r"
expect {
  eof {}
  timeout { exit 124 }
}
set result [wait]
exit [lindex $result 3]
`)
  chmodSync(expectScript, 0o755)
  return [expectScript]
}

function exitPtyCommand(root: string, runner: string): string[] {
  if (process.platform !== "darwin") return ["script", "-q", "-e", "-c", runner, "/dev/null"]

  const expectScript = join(root, "wait-for-broken-picker")
  writeFileSync(expectScript, `#!/usr/bin/expect -f
set timeout 5
spawn ${runner}
expect eof
set result [wait]
exit [lindex $result 3]
`)
  chmodSync(expectScript, 0o755)
  return [expectScript]
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
