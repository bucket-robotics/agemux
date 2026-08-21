import { existsSync, lstatSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { createTwoFilesPatch } from "diff"
import { atomicWrite } from "./files"
import type { HarnessName } from "./model"
import { canonicalDirectory } from "./paths"

export type SyncStatus = "in-sync" | "drift" | "missing"

export interface SyncEntry {
  file: string
  status: SyncStatus
  differingProfiles: string[]
}

const SYNC_FILES: Record<HarnessName, readonly string[]> = {
  claude: ["CLAUDE.md", "keybindings.json"],
  codex: ["AGENTS.md"],
}

export function syncReport(harness: HarnessName, profileDirectories: string[]): SyncEntry[] {
  const canonical = canonicalDirectory(harness)
  return SYNC_FILES[harness].map((file) => {
    const source = join(canonical, file)
    const sourceContents = read(source)
    const differingProfiles = profileDirectories
      .filter((directory) => read(join(directory, file)) !== sourceContents)
      .map((directory) => basename(directory))
    const status = !existsSync(source) ? "missing" : differingProfiles.length ? "drift" : "in-sync"
    return { file, status, differingProfiles }
  })
}

export function pushCanonical(harness: HarnessName, profileDirectories: string[], file?: string): void {
  const canonical = canonicalDirectory(harness)
  const files = file ? [assertSyncFile(harness, file)] : SYNC_FILES[harness]
  for (const name of files) {
    const contents = read(join(canonical, name))
    if (contents === undefined) continue
    for (const directory of profileDirectories) atomicWrite(join(directory, name), contents)
  }
}

export function adoptProfile(harness: HarnessName, profileDirectory: string, file: string): void {
  const name = assertSyncFile(harness, file)
  const contents = read(join(profileDirectory, name))
  if (contents === undefined) throw new Error(`${name} does not exist in ${basename(profileDirectory)}`)
  atomicWrite(join(canonicalDirectory(harness), name), contents)
}

export function unifiedDiff(canonical: string, profile: string, file: string): string {
  return createTwoFilesPatch(
    `canonical/${file}`,
    `${basename(profile)}/${file}`,
    read(join(canonical, file)) ?? "",
    read(join(profile, file)) ?? "",
    "",
    "",
    { context: 3 },
  )
}

export function syncFiles(harness: HarnessName): readonly string[] {
  return SYNC_FILES[harness]
}

function assertSyncFile(harness: HarnessName, file: string): string {
  if (!SYNC_FILES[harness].includes(file)) throw new Error(`${file} is not a ${harness} sync file`)
  return file
}

function read(path: string): string | undefined {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error(`refusing to sync symbolic link: ${path}`)
    return readFileSync(path, "utf8")
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
