import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { atomicWrite } from "./files"

const START = "# >>> agemux >>>"
const END = "# <<< agemux <<<"

export interface SetupResult {
  path: string
  changed: boolean
}

export function setupShell(requestedShell?: string, executable = process.execPath): SetupResult {
  const shell = requestedShell ?? basename(process.env.SHELL ?? "")
  const home = process.env.HOME
  if (!home) throw new Error("HOME is required to set up shell integration")
  const path = shellConfig(home, shell)
  const current = existsSync(path) ? readFileSync(path, "utf8") : ""
  if (current.includes(START)) return { path, changed: false }

  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n"
  atomicWrite(path, `${current}${separator}${shellBlock(executable)}\n`)
  return { path, changed: true }
}

function shellConfig(home: string, shell: string): string {
  if (shell === "zsh") return join(home, ".zshrc")
  if (shell === "bash") return join(home, ".bashrc")
  throw new Error(`unsupported shell: ${shell || "unknown"}; expected zsh or bash`)
}

function shellBlock(executable: string): string {
  return `${START}
claude() {
  if [[ $# -eq 0 && $- == *i* && -t 1 ]]; then
    command ${shellQuote(executable)} claude
  else
    command claude "$@"
  fi
}

codex() {
  if [[ $# -eq 0 && $- == *i* && -t 1 ]]; then
    command ${shellQuote(executable)} codex
  else
    command codex "$@"
  fi
}
${END}`
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
