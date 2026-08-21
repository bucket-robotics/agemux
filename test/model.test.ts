import { describe, expect, test } from "bun:test"
import { Profile, sortProfiles } from "../src/model"

describe("sortProfiles", () => {
  const profile = (name: string, fiveHour: number, weekly: number) => new Profile(
    "claude",
    name,
    `/tmp/${name}`,
    { fetchedAt: 1, fiveHour: { usedPercent: fiveHour }, weekly: { usedPercent: weekly } },
  )

  test("sorts by percent left in the active window", () => {
    const profiles = [profile("work", 18, 36), profile("personal", 59, 88)]
    expect(sortProfiles(profiles, "fiveHour").map((candidate) => candidate.name)).toEqual(["work", "personal"])
    expect(sortProfiles(profiles, "weekly").map((candidate) => candidate.name)).toEqual(["work", "personal"])
  })

  test("puts unknown usage last", () => {
    const unknown = new Profile("claude", "unknown", "/tmp/unknown")
    expect(sortProfiles([unknown, profile("known", 50, 50)], "fiveHour")[0]?.name).toBe("known")
  })
})
