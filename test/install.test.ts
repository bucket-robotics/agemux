import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("release installer", () => {
  const roots: string[] = []
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  test("downloads, verifies, and installs the application archive without gh", () => {
    const root = mkdtempSync(join(tmpdir(), "agemux-install-test-"))
    roots.push(root)
    const release = join(root, "release")
    const payload = join(root, "payload")
    const fakeBin = join(root, "bin")
    const destination = join(root, "installed")
    const applications = join(root, "applications")
    mkdirSync(release)
    mkdirSync(join(payload, "agemux"), { recursive: true })
    mkdirSync(fakeBin)

    const platform = nativePlatform()
    const archive = `agemux-${platform}.tar.gz`
    writeFileSync(join(payload, "agemux", "main.js"), "// bundled application\n")
    writeFileSync(join(payload, "agemux", "VERSION"), "0.1.1\n")
    writeFileSync(join(payload, "agemux", "LICENSE"), "MIT License\n")
    writeFileSync(join(payload, "agemux", "THIRD_PARTY_NOTICES"), "Dependency notices\n")
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

    const bun = join(fakeBin, "bun")
    writeFileSync(bun, `#!/bin/sh
if [ "\${1:-}" = --version ]; then
  echo 1.3.14
  exit
fi
application=$1
shift
if [ "\${1:-}" = --version ]; then
  cat "\${application%/*}/VERSION"
else
  printf '%s|%s\n' "$AGEMUX_EXECUTABLE" "$*"
fi
`)
    chmodSync(bun, 0o755)

    const curlLog = join(root, "curl.log")
    const installerEnvironment = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      HOME: root,
      FAKE_RELEASE: release,
      CURL_LOG: curlLog,
      AGEMUX_INSTALL_DIR: destination,
      AGEMUX_APPLICATION_DIR: applications,
    }
    const result = Bun.spawnSync([join(import.meta.dir, "..", "script", "install")], {
      env: installerEnvironment,
    })

    if (result.exitCode !== 0) {
      throw new Error(`installer exited ${result.exitCode}\n${result.stdout}\n${result.stderr}`)
    }
    expect(result.stdout.toString()).toContain(`installed ${join(destination, "agemux")}`)
    expect(existsSync(join(destination, "agemux"))).toBeTrue()
    const installedApplication = join(applications, "0.1.1")
    expect(readFileSync(join(installedApplication, "LICENSE"), "utf8")).toContain("MIT License")
    expect(readFileSync(join(installedApplication, "THIRD_PARTY_NOTICES"), "utf8")).toContain("Dependency notices")
    expect(Bun.spawnSync([join(destination, "agemux"), "--version"]).stdout.toString().trim()).toBe("0.1.1")
    expect(Bun.spawnSync([join(destination, "agemux"), "list", "claude"]).stdout.toString().trim()).toBe(
      `${join(destination, "agemux")}|list claude`,
    )
    expect(Bun.spawnSync([join(import.meta.dir, "..", "script", "install")], {
      env: installerEnvironment,
    }).exitCode).toBe(0)
    expect(readFileSync(curlLog, "utf8").trim().split("\n")).toEqual([
      `https://github.com/bucket-robotics/agemux/releases/latest/download/${archive}`,
      "https://github.com/bucket-robotics/agemux/releases/latest/download/checksums.txt",
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
