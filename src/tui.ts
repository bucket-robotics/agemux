import {
  BoxRenderable,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type Renderable,
} from "@opentui/core"
import { basename } from "node:path"
import { harnessNamed, type Harness } from "./harness"
import { Profile, sortProfiles, type HarnessName, type SortWindow } from "./model"
import { canonicalDirectory } from "./paths"
import { adoptProfile, pushCanonical, syncReport, unifiedDiff, type SyncEntry } from "./sync"

const COLOR = {
  bg: "#0d0e10",
  fg: "#c9cbd1",
  bright: "#eceef2",
  dim: "#5c616c",
  faint: "#3a3e46",
  accent: "#d183a9",
  warn: "#d1a563",
  danger: "#a86a7f",
  good: "#7fae7a",
} as const

type Mode = "loading" | "picker" | "new" | "busy" | "done" | "sync" | "diff"

export class AgemuxApp {
  private mode: Mode = "loading"
  private harness: Harness
  private profiles: Profile[] = []
  private selectedIndex = 0
  private sortWindow: SortWindow = "fiveHour"
  private screen?: Renderable
  private syncEntries: SyncEntry[] = []
  private diffProfile?: Profile
  private diffScroll?: ScrollBoxRenderable
  private doneProfile?: Profile
  private finish?: (profile?: Profile) => void
  private reject?: (error: unknown) => void
  private closed = false

  private constructor(private readonly renderer: CliRenderer, harness: HarnessName) {
    this.harness = harnessNamed(harness)
    renderer.setBackgroundColor(COLOR.bg)
    renderer.setTerminalTitle("agemux")
    renderer.keyInput.on("keypress", (key) => this.handleKey(key))
  }

  static async create(harness: HarnessName): Promise<AgemuxApp> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      consoleMode: "disabled",
      targetFps: 30,
    })
    return new AgemuxApp(renderer, harness)
  }

  run(): Promise<Profile | undefined> {
    return new Promise((resolve, reject) => {
      this.finish = resolve
      this.reject = reject
      this.renderLoading()
      this.perform(this.loadProfiles())
    })
  }

  private perform(task: Promise<void>): void {
    void task.catch((error) => this.abort(error))
  }

  private handleKey(key: KeyEvent): void {
    try {
      this.onKey(key)
    } catch (error) {
      this.abort(error)
    }
  }

  private async loadProfiles(): Promise<void> {
    this.mode = "loading"
    this.renderLoading()
    const profiles = await this.harness.profiles()
    if (this.closed) return
    this.profiles = sortProfiles(profiles, this.sortWindow)
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.profiles.length - 1))
    this.mode = "picker"
    this.renderPicker()
  }

  private onKey(key: KeyEvent): void {
    if (key.eventType === "release") return
    if (key.ctrl && key.name === "c") return this.close()
    if (this.mode === "new" || this.mode === "busy" || this.mode === "loading") {
      if (key.name === "escape" && this.mode === "new") this.showPicker()
      return
    }
    if (this.mode === "picker") return this.onPickerKey(key)
    if (this.mode === "sync") return this.onSyncKey(key)
    if (this.mode === "diff") return this.onDiffKey(key)
    if (this.mode === "done") return this.onDoneKey(key)
  }

  private onPickerKey(key: KeyEvent): void {
    if (key.name === "up" || key.name === "k") this.moveSelection(-1)
    else if (key.name === "down" || key.name === "j") this.moveSelection(1)
    else if (key.name === "return" || key.name === "a") this.chooseSelected()
    else if (key.name === "w") this.toggleSort()
    else if (key.name === "tab" || key.name === "+") this.perform(this.toggleHarness())
    else if (key.name === "n") this.renderNewProfile()
    else if (key.name === "i" && this.profiles.length === 0) void this.importCanonical()
    else if (key.name === "s") this.renderSync()
    else if (key.name === "q" || key.name === "escape") this.close()
  }

  private onSyncKey(key: KeyEvent): void {
    if (key.name === "up" || key.name === "k") this.moveSyncSelection(-1)
    else if (key.name === "down" || key.name === "j") this.moveSyncSelection(1)
    else if (key.name === "return") this.pushAll()
    else if (key.name === "d") this.renderDiff()
    else if (key.name === "escape" || key.name === "q") this.showPicker()
  }

  private onDiffKey(key: KeyEvent): void {
    const entry = this.syncEntries[this.selectedIndex]
    if (!entry || !this.diffProfile) return
    if (key.name === "return") {
      pushCanonical(this.harness.name, [this.diffProfile.directory], entry.file)
      this.renderSync()
    } else if (key.name === "a") {
      adoptProfile(this.harness.name, this.diffProfile.directory, entry.file)
      this.renderSync()
    } else if (key.name === "up" || key.name === "k") this.diffScroll?.scrollBy(-1)
    else if (key.name === "down" || key.name === "j") this.diffScroll?.scrollBy(1)
    else if (key.name === "escape" || key.name === "q") this.renderSync()
  }

  private onDoneKey(key: KeyEvent): void {
    if (key.name === "return" && this.doneProfile) this.choose(this.doneProfile)
    else if (key.name === "escape") this.showPicker()
  }

  private moveSelection(delta: number): void {
    if (!this.profiles.length) return
    this.selectedIndex = (this.selectedIndex + delta + this.profiles.length) % this.profiles.length
    this.renderPicker()
  }

  private moveSyncSelection(delta: number): void {
    if (!this.syncEntries.length) return
    this.selectedIndex = (this.selectedIndex + delta + this.syncEntries.length) % this.syncEntries.length
    this.renderSync(false)
  }

  private toggleSort(): void {
    this.sortWindow = this.sortWindow === "fiveHour" ? "weekly" : "fiveHour"
    this.profiles = sortProfiles(this.profiles, this.sortWindow)
    this.selectedIndex = 0
    this.renderPicker()
  }

  private async toggleHarness(): Promise<void> {
    this.harness = harnessNamed(this.harness.name === "claude" ? "codex" : "claude")
    this.selectedIndex = 0
    await this.loadProfiles()
  }

  private chooseSelected(): void {
    const profile = this.profiles[this.selectedIndex]
    if (profile) this.choose(profile)
  }

  private choose(profile: Profile): void {
    this.complete(profile)
  }

  private close(): void {
    this.complete()
  }

  private complete(profile?: Profile): void {
    if (this.closed) return
    this.closed = true
    this.renderer.destroy()
    this.finish?.(profile)
    this.finish = undefined
    this.reject = undefined
  }

  private abort(error: unknown): void {
    if (this.closed) return
    this.closed = true
    this.renderer.destroy()
    this.reject?.(error)
    this.finish = undefined
    this.reject = undefined
  }

  private async importCanonical(): Promise<void> {
    try {
      await this.harness.importCanonical("personal")
      await this.loadProfiles()
    } catch (error) {
      this.renderPicker(errorMessage(error))
    }
  }

  private renderLoading(): void {
    this.replaceScreen(this.shell(
      this.header(`${this.harness.name}  ·  loading`),
      new TextRenderable(this.renderer, { content: "reading accounts…", fg: COLOR.dim, marginTop: 3 }),
    ))
  }

  private renderPicker(error?: string): void {
    const body = new BoxRenderable(this.renderer, { id: "accounts", flexDirection: "column", marginTop: 2, flexGrow: 1 })
    if (!this.profiles.length) {
      body.add(new TextRenderable(this.renderer, { content: "no accounts yet.", fg: COLOR.fg, marginBottom: 2 }))
      body.add(new TextRenderable(this.renderer, { content: "i   use the current login as personal", fg: COLOR.bright }))
      body.add(new TextRenderable(this.renderer, { content: "n   sign in to a new account", fg: COLOR.bright }))
    } else {
      body.add(this.columnHeader())
      this.profiles.forEach((profile, index) => body.add(this.profileRow(profile, index === this.selectedIndex)))
    }
    if (error) body.add(new TextRenderable(this.renderer, { content: error, fg: COLOR.danger, marginTop: 1 }))

    const other = this.harness.name === "claude" ? "codex" : "claude"
    const footer = this.profiles.length
      ? `↑↓ move   ↵ launch   n new   s sync   w sort   + ${other}   q quit`
      : `n new   i import   + ${other}   q quit`
    this.replaceScreen(this.shell(
      this.header(`${this.harness.name}  ·  ${this.profiles.length} account${this.profiles.length === 1 ? "" : "s"}`),
      body,
      this.footer(footer),
    ))
  }

  private columnHeader(): Renderable {
    const row = new BoxRenderable(this.renderer, { flexDirection: "row", height: 1, marginBottom: 1 })
    row.add(this.column("", 3, COLOR.dim))
    row.add(this.column("account", 18, COLOR.dim))
    row.add(this.column("5h left", 24, this.sortWindow === "fiveHour" ? COLOR.accent : COLOR.dim))
    row.add(this.column("week left", 24, this.sortWindow === "weekly" ? COLOR.accent : COLOR.dim))
    row.add(this.column("plan", 12, COLOR.dim))
    return row
  }

  private profileRow(profile: Profile, selected: boolean): Renderable {
    const row = new BoxRenderable(this.renderer, { flexDirection: "row", height: 2, marginBottom: 1 })
    const fiveHour = profile.usage?.fiveHour
    const weekly = profile.usage?.weekly
    row.add(this.column(selected ? "›" : "", 3, selected ? COLOR.accent : COLOR.dim))
    row.add(this.column(profile.name, 18, selected ? COLOR.bright : COLOR.fg))
    row.add(this.column(formatWindow(fiveHour, profile.usage?.fetchedAt), 24, windowColor(fiveHour)))
    row.add(this.column(formatWindow(weekly, profile.usage?.fetchedAt), 24, windowColor(weekly)))
    row.add(this.column(profile.usage?.plan ?? profile.identity.plan ?? "—", 12, COLOR.dim))
    return row
  }

  private renderNewProfile(): void {
    this.mode = "new"
    const input = new InputRenderable(this.renderer, {
      id: "profile-name",
      width: 32,
      value: "",
      placeholder: "account-name",
      textColor: COLOR.bright,
      cursorColor: COLOR.accent,
      focusedBackgroundColor: COLOR.bg,
    })
    input.on(InputRenderableEvents.ENTER, () => this.perform(this.completeNewProfile(input.value)))
    const config = `~/.agemux/${this.harness.name}/<name>`
    this.replaceScreen(this.shell(
      this.header(`${this.harness.name}  ·  new account`),
      new TextRenderable(this.renderer, { content: "name  ›", fg: COLOR.accent, marginTop: 2 }),
      input,
      new TextRenderable(this.renderer, { content: `config    ${config}`, fg: COLOR.dim, marginTop: 2 }),
      new TextRenderable(this.renderer, { content: `synced    ${this.harness.name === "claude" ? "CLAUDE.md · keybindings.json" : "AGENTS.md"}`, fg: COLOR.dim }),
      this.footer("↵ sign in   esc cancel"),
    ))
    input.focus()
  }

  private async completeNewProfile(name: string): Promise<void> {
    if (this.mode !== "new") return
    this.mode = "busy"
    let profile: Profile
    try {
      profile = await this.harness.createProfile(name)
    } catch (error) {
      this.mode = "new"
      this.renderNewProfileError(name, errorMessage(error))
      return
    }

    this.replaceScreen(this.shell(
      this.header(`${this.harness.name}  ·  new account`),
      new TextRenderable(this.renderer, { content: `› waiting for ${this.harness.name} sign-in…`, fg: COLOR.bright, marginTop: 3 }),
      this.footer("ctrl-c cancels sign-in"),
    ))
    await this.renderer.idle()
    this.renderer.suspend()
    let status: number
    try {
      const child = Bun.spawn([this.harness.executable, ...this.harness.signInArguments()], {
        env: this.harness.environment(profile),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      status = await child.exited
    } finally {
      this.renderer.resume()
    }
    if (status !== 0) return this.loadProfiles()

    const refreshed = (await this.harness.profiles()).find((candidate) => candidate.name === profile.name) ?? profile
    this.doneProfile = refreshed
    this.mode = "done"
    this.renderDone(refreshed)
  }

  private renderNewProfileError(name: string, message: string): void {
    const input = new InputRenderable(this.renderer, {
      id: "profile-name",
      width: 32,
      value: name,
      textColor: COLOR.bright,
      cursorColor: COLOR.accent,
      focusedBackgroundColor: COLOR.bg,
    })
    input.on(InputRenderableEvents.ENTER, () => this.perform(this.completeNewProfile(input.value)))
    this.replaceScreen(this.shell(
      this.header(`${this.harness.name}  ·  new account`),
      new TextRenderable(this.renderer, { content: "name  ›", fg: COLOR.accent, marginTop: 2 }),
      input,
      new TextRenderable(this.renderer, { content: message, fg: COLOR.danger, marginTop: 2 }),
      this.footer("↵ sign in   esc cancel"),
    ))
    input.focus()
  }

  private renderDone(profile: Profile): void {
    const identity = profile.identity.email ? `${profile.identity.email} · ` : ""
    const plan = profile.usage?.plan ?? profile.identity.plan ?? "signed in"
    this.replaceScreen(this.shell(
      this.header(`${this.harness.name}  ·  new account`),
      new TextRenderable(this.renderer, { content: `✓  signed in as ${profile.name}`, fg: COLOR.bright, marginTop: 2 }),
      new TextRenderable(this.renderer, { content: `account    ${identity}${plan}`, fg: COLOR.dim, marginTop: 2 }),
      new TextRenderable(this.renderer, { content: `config     ${profile.directory.replace(process.env.HOME ?? "", "~")}`, fg: COLOR.dim }),
      this.footer("↵ launch now   esc back to picker"),
    ))
  }

  private showPicker(): void {
    this.mode = "picker"
    this.selectedIndex = 0
    this.renderPicker()
  }

  private renderSync(refresh = true): void {
    this.mode = "sync"
    if (refresh) {
      this.syncEntries = syncReport(this.harness.name, this.profiles.map((profile) => profile.directory))
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.syncEntries.length - 1))
    }
    const body = new BoxRenderable(this.renderer, { flexDirection: "column", flexGrow: 1, marginTop: 2 })
    this.syncEntries.forEach((entry, index) => {
      const selected = index === this.selectedIndex
      const marker = entry.status === "in-sync" ? "✓" : entry.status === "drift" ? "~" : "·"
      const detail = entry.status === "drift" ? `${entry.differingProfiles.join(", ")} differs` : entry.status
      body.add(new TextRenderable(this.renderer, {
        content: `${selected ? "›" : " "}  ${marker}  ${entry.file.padEnd(22)} ${detail}`,
        fg: entry.status === "in-sync" ? COLOR.good : entry.status === "drift" ? COLOR.warn : COLOR.dim,
        height: 2,
      }))
    })
    this.replaceScreen(this.shell(
      this.header(`${this.harness.name}  ·  sync`, `canonical ${canonicalDirectory(this.harness.name).replace(process.env.HOME ?? "", "~")} → ${this.profiles.map((profile) => profile.name).join(" · ")}`),
      body,
      this.footer("↵ push canonical → all   d diff   esc back"),
    ))
  }

  private pushAll(): void {
    pushCanonical(this.harness.name, this.profiles.map((profile) => profile.directory))
    this.renderSync()
  }

  private renderDiff(): void {
    const entry = this.syncEntries[this.selectedIndex]
    if (!entry || !entry.differingProfiles.length) return
    this.diffProfile = this.profiles.find((profile) => profile.name === entry.differingProfiles[0])
    if (!this.diffProfile) return
    this.mode = "diff"
    const content = unifiedDiff(canonicalDirectory(this.harness.name), this.diffProfile.directory, entry.file)
    this.diffScroll = new ScrollBoxRenderable(this.renderer, {
      flexGrow: 1,
      marginTop: 2,
      scrollY: true,
      scrollX: false,
      viewportCulling: true,
      verticalScrollbarOptions: { visible: false },
    })
    this.diffScroll.add(new TextRenderable(this.renderer, { content, fg: COLOR.fg }))
    this.replaceScreen(this.shell(
      this.header(`${this.harness.name}  ·  sync · ${entry.file}`, `canonical vs ${this.diffProfile.name}`),
      this.diffScroll,
      this.footer(`↑↓ scroll   ↵ push canonical   a adopt ${this.diffProfile.name}'s   esc back`),
    ))
  }

  private replaceScreen(screen: Renderable): void {
    if (this.screen) {
      this.renderer.root.remove(this.screen)
      this.screen.destroyRecursively()
    }
    this.screen = screen
    this.renderer.root.add(screen)
  }

  private shell(...children: Renderable[]): BoxRenderable {
    const shell = new BoxRenderable(this.renderer, {
      id: "screen",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      paddingX: 3,
      paddingY: 2,
      backgroundColor: COLOR.bg,
    })
    children.forEach((child) => shell.add(child))
    return shell
  }

  private header(title: string, right = "agemux"): BoxRenderable {
    const row = new BoxRenderable(this.renderer, { flexDirection: "row", justifyContent: "space-between", height: 2 })
    row.add(new TextRenderable(this.renderer, { content: title, fg: COLOR.bright }))
    row.add(new TextRenderable(this.renderer, { content: right, fg: COLOR.faint }))
    return row
  }

  private footer(content: string): TextRenderable {
    return new TextRenderable(this.renderer, { content, fg: COLOR.dim, height: 1 })
  }

  private column(content: string, width: number, color: string): TextRenderable {
    return new TextRenderable(this.renderer, { content, width, height: 1, fg: color })
  }
}

export async function showLaunchHandoff(harness: HarnessName, profile: Profile): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, consoleMode: "disabled" })
  renderer.setBackgroundColor(COLOR.bg)
  const screen = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    padding: 3,
    backgroundColor: COLOR.bg,
  })
  const text = new TextRenderable(renderer, {
    content: `›  launching ${harness} · ${profile.name}`,
    fg: COLOR.bright,
    marginTop: Math.max(1, Math.floor(renderer.terminalHeight / 2) - 4),
    marginLeft: 2,
  })
  screen.add(text)
  renderer.root.add(screen)
  await new Promise((resolve) => setTimeout(resolve, 180))
  renderer.destroy()
}

function formatWindow(window: { usedPercent: number; resetsAt?: number } | undefined, fetchedAt?: number): string {
  if (!window) return "—"
  const remaining = Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)))
  const filled = Math.round(remaining / 10)
  const bar = `${"━".repeat(filled)}${"─".repeat(10 - filled)}`
  const stale = fetchedAt && Math.floor(Date.now() / 1000) - fetchedAt > 5 * 60 ? ` · ${age(fetchedAt)} ago` : ""
  return `${bar} ${remaining}%${stale}`
}

function windowColor(window: { usedPercent: number } | undefined): string {
  if (!window) return COLOR.dim
  return 100 - window.usedPercent < 15 ? COLOR.warn : COLOR.fg
}

function age(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
