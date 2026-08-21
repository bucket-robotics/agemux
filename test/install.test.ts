import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("release installer", () => {
  const roots: string[] = []
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  test("downloads, verifies, and installs the native archive", () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-install-test-"))
    roots.push(root)
    const release = join(root, "release")
    const payload = join(root, "payload")
    const fakeBin = join(root, "bin")
    const destination = join(root, "installed")
    mkdirSync(release)
    mkdirSync(payload)
    mkdirSync(fakeBin)

    const platform = nativePlatform()
    const archive = `agemux-${platform}.tar.gz`
    const executable = join(payload, "agemux")
    writeFileSync(executable, "#!/bin/sh\necho installed\n")
    chmodSync(executable, 0o755)
    expect(Bun.spawnSync(["tar", "-C", payload, "-czf", join(release, archive), "agemux"]).exitCode).toBe(0)
    const checksum = new Bun.CryptoHasher("sha256").update(readFileSync(join(release, archive))).digest("hex")
    writeFileSync(join(release, "checksums.txt"), `${checksum}  ${archive}\n`)

    const gh = join(fakeBin, "gh")
    writeFileSync(gh, `#!/bin/sh
set -eu
directory=
patterns=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --pattern) patterns="$patterns $2"; shift 2 ;;
    --dir) directory=$2; shift 2 ;;
    *) shift ;;
  esac
done
for pattern in $patterns; do cp "$FAKE_RELEASE/$pattern" "$directory/$pattern"; done
`)
    chmodSync(gh, 0o755)

    const result = Bun.spawnSync([join(import.meta.dir, "..", "script", "install")], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        HOME: root,
        FAKE_RELEASE: release,
        AGEMUX_INSTALL_DIR: destination,
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain(`installed ${join(destination, "agemux")}`)
    expect(existsSync(join(destination, "agemux"))).toBeTrue()
    expect(Bun.spawnSync([join(destination, "agemux")]).stdout.toString().trim()).toBe("installed")
  })
})

function nativePlatform(): string {
  const operatingSystem = process.platform === "darwin" ? "darwin" : "linux"
  const architecture = process.arch === "arm64" ? "arm64" : "x64"
  return `${operatingSystem}-${architecture}`
}
