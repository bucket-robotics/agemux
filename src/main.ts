#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { AgemuxApp, showLaunchHandoff } from "./tui"
import { executableExists, harnessFromArgument, harnessNamed } from "./harness"
import type { HarnessName, Profile } from "./model"
import { setupShell } from "./setup"
import { VERSION } from "./version"

const [command, ...arguments_] = process.argv.slice(2)
const directHarness = harnessFromArgument(command)

if (directHarness) {
  await openPicker(directHarness)
} else if (command === "list") {
  await listProfiles(requireHarness(arguments_[0]))
} else if (command === "launch") {
  await launchNamed(requireHarness(arguments_[0]), arguments_[1], arguments_.slice(2))
} else if (command === "add") {
  await addProfile(requireHarness(arguments_[0]), arguments_[1])
} else if (command === "setup") {
  setup(arguments_[0])
} else if (command === "--version" || command === "-v" || command === "version") {
  console.log(VERSION)
} else if (command === "--help" || command === "-h" || command === "help" || command === undefined) {
  printHelp()
} else {
  fail(`unknown command: ${command}`)
}

async function openPicker(name: HarnessName): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail("the account picker requires a TTY")
  const harness = harnessNamed(name)
  if (!executableExists(harness)) fail(`${name} executable not found at ${harness.executable}`)
  const app = await AgemuxApp.create(name)
  let profile: Profile | undefined
  try {
    profile = await app.run()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  if (!profile) process.exit(0)
  await showLaunchHandoff(profile.harness, profile)
  execProfile(profile.harness, profile, [])
}

async function listProfiles(name: HarnessName): Promise<void> {
  const profiles = await harnessNamed(name).profiles()
  console.log(JSON.stringify(profiles.map((profile) => ({
    name: profile.name,
    directory: profile.directory,
    usage: profile.usage,
    identity: profile.identity,
  })), null, 2))
}

async function launchNamed(name: HarnessName, profileName: string | undefined, arguments_: string[]): Promise<void> {
  if (!profileName) fail("launch requires a profile name")
  const harness = harnessNamed(name)
  const profile = (await harness.profiles()).find((candidate) => candidate.name === profileName)
  if (!profile) fail(`${name} profile not found: ${profileName}`)
  if (arguments_[0] === "--dry-run") {
    console.log(JSON.stringify({ executable: harness.executable, arguments: harness.launchArguments(arguments_.slice(1)), environment: { [harness.configEnvironmentKey]: profile.directory } }, null, 2))
    return
  }
  execProfile(name, profile, arguments_)
}

async function addProfile(name: HarnessName, profileName: string | undefined): Promise<void> {
  if (!profileName) fail("add requires a profile name")
  const harness = harnessNamed(name)
  const profile = await harness.createProfile(profileName)
  const child = Bun.spawn([harness.executable, ...harness.signInArguments()], {
    env: harness.environment(profile),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  process.exit(await child.exited)
}

function execProfile(name: HarnessName, profile: Profile, arguments_: string[]): void {
  const harness = harnessNamed(name)
  if (!existsSync(harness.executable)) fail(`${name} executable not found at ${harness.executable}`)
  const execve = process.execve
  if (!execve) fail("this Bun runtime does not support execve")
  execve(
    harness.executable,
    [harness.executable, ...harness.launchArguments(arguments_)],
    harness.environment(profile),
  )
  fail(`failed to exec ${name}`)
}

function requireHarness(value: string | undefined): HarnessName {
  const harness = harnessFromArgument(value)
  if (!harness) fail("expected claude or codex")
  return harness
}

function setup(shell: string | undefined): void {
  try {
    const executable = process.env.AGEMUX_EXECUTABLE
    if (!executable) fail("setup must be run through the installed agemux launcher")
    const result = setupShell(shell, executable)
    const paths = result.paths.join(", ")
    console.log(result.changed
      ? `agemux: added shell integration to ${paths}; open a new shell`
      : `agemux: shell integration already exists in ${paths}`)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

function printHelp(): void {
  console.log(`agemux

  agemux claude|codex
  agemux list claude|codex
  agemux add claude|codex NAME
  agemux launch claude|codex NAME [ARGS...]
  agemux setup [zsh|bash]
`)
}

function fail(message: string): never {
  console.error(`agemux: ${message}`)
  process.exit(1)
}
