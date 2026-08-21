export type HarnessName = "claude" | "codex"
export type SortWindow = "fiveHour" | "weekly"

export interface UsageWindow {
  usedPercent: number
  resetsAt?: number
}

export interface UsageSnapshot {
  fetchedAt: number
  plan?: string
  fiveHour?: UsageWindow
  weekly?: UsageWindow
}

export interface ProfileIdentity {
  email?: string
  plan?: string
}

export class Profile {
  constructor(
    readonly harness: HarnessName,
    readonly name: string,
    readonly directory: string,
    readonly usage?: UsageSnapshot,
    readonly identity: ProfileIdentity = {},
  ) {}

  remaining(window: SortWindow): number {
    return 100 - (this.usage?.[window]?.usedPercent ?? 100)
  }

  withUsage(usage: UsageSnapshot): Profile {
    return new Profile(this.harness, this.name, this.directory, usage, {
      ...this.identity,
      plan: usage.plan ?? this.identity.plan,
    })
  }
}

export function sortProfiles(profiles: Profile[], window: SortWindow): Profile[] {
  return profiles.toSorted((left, right) => {
    const remaining = right.remaining(window) - left.remaining(window)
    return remaining || left.name.localeCompare(right.name)
  })
}
