import { randomUUID } from "node:crypto"
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

export function atomicWrite(path: string, contents: string): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const mode = existsSync(path) ? existingFileMode(path) : 0o600
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  let descriptor: number | undefined

  try {
    descriptor = openSync(temporary, "wx", mode)
    writeFileSync(descriptor, contents, "utf8")
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, path)
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    try { unlinkSync(temporary) } catch (cleanupError) {
      if (!isMissing(cleanupError)) throw cleanupError
    }
    throw error
  }
}

function existingFileMode(path: string): number {
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink()) throw new Error(`refusing to replace symbolic link: ${path}`)
  if (!metadata.isFile()) throw new Error(`refusing to replace non-file: ${path}`)
  return metadata.mode & 0o777
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
