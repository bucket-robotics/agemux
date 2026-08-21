import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { atomicWrite } from "./files"

const START = "# >>> agemux >>>"
const END = "# <<< agemux <<<"

export interface SetupResult {
  paths: string[]
  changed: boolean
}

export function setupShell(requestedShell?: string, executable = process.execPath): SetupResult {
  const shell = requestedShell ?? basename(process.env.SHELL ?? "")
  const home = process.env.HOME
  if (!home) throw new Error("HOME is required to set up shell integration")
  const paths = shellConfigs(home, shell)
  const changed = paths.map((path) => installShellBlock(path, executable)).some(Boolean)
  return { paths, changed }
}

function installShellBlock(path: string, executable: string): boolean {
  const current = existsSync(path) ? readFileSync(path, "utf8") : ""
  if (current.includes(START)) return false

  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n"
  atomicWrite(path, `${current}${separator}${shellBlock(executable)}\n`)
  return true
}

function shellConfigs(home: string, shell: string): string[] {
  if (shell === "zsh") return [join(home, ".zshrc")]
  if (shell === "bash") return [join(home, ".bashrc"), bashLoginConfig(home)]
  throw new Error(`unsupported shell: ${shell || "unknown"}; expected zsh or bash`)
}

function bashLoginConfig(home: string): string {
  for (const name of [".bash_profile", ".bash_login", ".profile"]) {
    const path = join(home, name)
    if (existsSync(path)) return path
  }
  return join(home, ".bash_profile")
}

function shellBlock(executable: string): string {
  return `${START}
unalias claude 2>/dev/null || true
unalias codex 2>/dev/null || true

claude() {
  if [ "$#" -eq 0 ] && [ -t 1 ]; then
    case $- in
      *i*) command ${shellQuote(executable)} claude; return ;;
    esac
  fi
  command claude "$@"
}

codex() {
  if [ "$#" -eq 0 ] && [ -t 1 ]; then
    case $- in
      *i*) command ${shellQuote(executable)} codex; return ;;
    esac
  fi
  command codex "$@"
}
${END}`
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
