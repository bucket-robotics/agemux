import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("release installer", () => {
  const roots: string[] = []
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  for (const runtime of runtimes) test(`installs ${runtime.platform} without Bun or gh`, () => {
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

    const archive = `agemux-${runtime.platform}.tar.gz`
    writeFileSync(join(payload, "agemux", "main.js"), "// bundled application\n")
    writeFileSync(join(payload, "agemux", "VERSION"), "0.1.1\n")
    writeFileSync(join(payload, "agemux", "LICENSE"), "MIT License\n")
    writeFileSync(join(payload, "agemux", "THIRD_PARTY_NOTICES"), "Dependency notices\n")
    expect(Bun.spawnSync(["tar", "-C", payload, "-czf", join(release, archive), "agemux"]).exitCode).toBe(0)
    const checksum = new Bun.CryptoHasher("sha256").update(readFileSync(join(release, archive))).digest("hex")
    writeFileSync(join(release, "checksums.txt"), `${checksum}  ${archive}\n`)

    const bunPayload = join(root, "bun-payload")
    mkdirSync(join(bunPayload, runtime.bunDirectory), { recursive: true })
    const bundledBun = join(bunPayload, runtime.bunDirectory, "bun")
    writeFileSync(bundledBun, `#!/bin/sh
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
    chmodSync(bundledBun, 0o755)
    expect(Bun.spawnSync(["zip", "-qr", join(release, runtime.bunArchive), runtime.bunDirectory], {
      cwd: bunPayload,
    }).exitCode).toBe(0)
    writeFileSync(join(release, "LICENSE.md"), "Bun license\n")

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

    fakeCommand(fakeBin, "uname", `case "\${1:-}" in
  -s) echo ${runtime.operatingSystem} ;;
  -m) echo ${runtime.machine} ;;
  *) echo ${runtime.operatingSystem} ;;
esac`)
    fakeCommand(fakeBin, "sw_vers", "echo 13.0")
    fakeCommand(fakeBin, "sysctl", "echo SSE4.2")
    fakeCommand(fakeBin, "ldd", "echo 'ldd (GNU libc) 2.17'")
    fakeCommand(fakeBin, "getconf", "echo 'glibc 2.17'")
    fakeCommand(fakeBin, "grep", "exit 0")

    const gh = join(fakeBin, "gh")
    writeFileSync(gh, "#!/bin/sh\nexit 99\n")
    chmodSync(gh, 0o755)

    const sha256sum = join(fakeBin, "sha256sum")
    writeFileSync(sha256sum, `#!/bin/sh
case "\${1##*/}" in
  ${runtime.bunArchive}) checksum=${runtime.bunChecksum} ;;
  BUN_LICENSE.md) checksum=2c6160ec8fb853f7e8f97d9b249e756c9b0ac44860a68b6bf4f1b0bcbc5c3741 ;;
  ${archive}) checksum=${checksum} ;;
  *) echo "unexpected checksum target: $1" >&2; exit 1 ;;
esac
printf '%s  %s\n' "$checksum" "$1"
`)
    chmodSync(sha256sum, 0o755)

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
    expect(readFileSync(join(installedApplication, "ARCHIVE_SHA256"), "utf8").trim()).toBe(checksum)
    const installedRuntime = join(applications, "runtime", `bun-1.3.14-${runtime.bunChecksum}`)
    expect(existsSync(join(installedRuntime, "bun"))).toBeTrue()
    expect(readFileSync(join(installedRuntime, "LICENSE.md"), "utf8")).toContain("Bun license")
    expect(readFileSync(join(destination, "agemux"), "utf8")).toContain(join(installedRuntime, "bun"))
    expect(Bun.spawnSync([join(destination, "agemux"), "--version"]).stdout.toString().trim()).toBe("0.1.1")
    expect(Bun.spawnSync([join(destination, "agemux"), "list", "claude"]).stdout.toString().trim()).toBe(
      `${join(destination, "agemux")}|list claude`,
    )
    expect(Bun.spawnSync([join(import.meta.dir, "..", "script", "install")], {
      env: installerEnvironment,
    }).exitCode).toBe(0)
    expect(readFileSync(curlLog, "utf8").trim().split("\n")).toEqual([
      `https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/${runtime.bunArchive}`,
      "https://raw.githubusercontent.com/oven-sh/bun/bun-v1.3.14/LICENSE.md",
      `https://github.com/bucket-robotics/agemux/releases/latest/download/${archive}`,
      "https://github.com/bucket-robotics/agemux/releases/latest/download/checksums.txt",
      `https://github.com/bucket-robotics/agemux/releases/latest/download/${archive}`,
      "https://github.com/bucket-robotics/agemux/releases/latest/download/checksums.txt",
    ])
  })
})

const runtimes = [
  {
    platform: "darwin-arm64",
    operatingSystem: "Darwin",
    machine: "arm64",
    bunArchive: "bun-darwin-aarch64.zip",
    bunDirectory: "bun-darwin-aarch64",
    bunChecksum: "d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620",
  },
  {
    platform: "darwin-x64",
    operatingSystem: "Darwin",
    machine: "x86_64",
    bunArchive: "bun-darwin-x64-baseline.zip",
    bunDirectory: "bun-darwin-x64-baseline",
    bunChecksum: "3e35ad6f53971a9834bf9e6786e2adf72b5f1921cc9a9c5fde073d2972944076",
  },
  {
    platform: "linux-arm64",
    operatingSystem: "Linux",
    machine: "aarch64",
    bunArchive: "bun-linux-aarch64.zip",
    bunDirectory: "bun-linux-aarch64",
    bunChecksum: "a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b",
  },
  {
    platform: "linux-x64",
    operatingSystem: "Linux",
    machine: "x86_64",
    bunArchive: "bun-linux-x64-baseline.zip",
    bunDirectory: "bun-linux-x64-baseline",
    bunChecksum: "a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7",
  },
] as const

function fakeCommand(directory: string, name: string, body: string): void {
  const executable = join(directory, name)
  writeFileSync(executable, `#!/bin/sh\n${body}\n`)
  chmodSync(executable, 0o755)
}
