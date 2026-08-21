import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readAccessCredential } from "../src/auth"

describe("readAccessCredential", () => {
  test("treats an in-progress Codex auth rewrite as temporarily absent", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agemux-auth-"))
    try {
      writeFileSync(join(directory, "auth.json"), "{partial")
      expect(await readAccessCredential("codex", directory)).toBeUndefined()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
