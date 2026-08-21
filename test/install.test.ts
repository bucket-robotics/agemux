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

    const curl = join(fakeBin, "curl")
    writeFileSync(curl, `#!/bin/sh
set -eu
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    http*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\n' "$url" >> "$CURL_LOG"
cp "$FAKE_RELEASE/\${url##*/}" "$output"
`)
    chmodSync(curl, 0o755)

    const gh = join(fakeBin, "gh")
    writeFileSync(gh, "#!/bin/sh\nexit 99\n")
    chmodSync(gh, 0o755)

    const curlLog = join(root, "curl.log")

    const result = Bun.spawnSync([join(import.meta.dir, "..", "script", "install")], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        HOME: root,
        FAKE_RELEASE: release,
        CURL_LOG: curlLog,
        AGEMUX_INSTALL_DIR: destination,
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain(`installed ${join(destination, "agemux")}`)
    expect(existsSync(join(destination, "agemux"))).toBeTrue()
    expect(Bun.spawnSync([join(destination, "agemux")]).stdout.toString().trim()).toBe("installed")
    expect(readFileSync(curlLog, "utf8").trim().split("\n")).toEqual([
      `https://github.com/bucket-robotics/agemux/releases/latest/download/${archive}`,
      "https://github.com/bucket-robotics/agemux/releases/latest/download/checksums.txt",
    ])
  })
})

function nativePlatform(): string {
  const operatingSystem = process.platform === "darwin" ? "darwin" : "linux"
  const architecture = process.arch === "arm64" ? "arm64" : "x64"
  return `${operatingSystem}-${architecture}`
}
