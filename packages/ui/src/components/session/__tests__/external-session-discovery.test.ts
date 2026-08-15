import { describe, it, expect } from "bun:test"

describe("effectiveKnownDirectories filter", () => {
  it("sessions from unknown directories pass when their directory is in globalActiveSessions", () => {
    const knownDirs = new Set(["/known/project"])
    const globalActiveSessions = [
      { id: "s1", directory: "/known/project" },
      { id: "s2", directory: "/external/unknown-dir" },
    ]

    const effective = new Set(knownDirs)
    for (const session of globalActiveSessions) {
      const dir = (session as { directory?: string }).directory?.toLowerCase()
      if (dir) effective.add(dir)
    }

    expect(effective.has("/known/project")).toBe(true)
    expect(effective.has("/external/unknown-dir")).toBe(true)
    expect(effective.size).toBe(2)
  })

  it("sessions from known directories still pass", () => {
    const knownDirs = new Set(["/known/project"])
    const globalActiveSessions = [
      { id: "s1", directory: "/known/project" },
    ]

    const effective = new Set(knownDirs)
    for (const session of globalActiveSessions) {
      const dir = (session as { directory?: string }).directory?.toLowerCase()
      if (dir) effective.add(dir)
    }

    expect(effective.has("/known/project")).toBe(true)
    expect(effective.size).toBe(1)
  })

  it("empty knownDirs with no globalActiveSessions stays empty", () => {
    const knownDirs = new Set<string>()
    const globalActiveSessions: Array<{ id: string; directory?: string }> = []

    const effective = new Set(knownDirs)
    for (const session of globalActiveSessions) {
      const dir = session.directory?.toLowerCase()
      if (dir) effective.add(dir)
    }

    expect(effective.size).toBe(0)
  })

  it("sessions without directory do not add to effective set", () => {
    const knownDirs = new Set(["/known/project"])
    const globalActiveSessions = [
      { id: "s1", directory: undefined },
      { id: "s2", directory: null as string | null },
    ]

    const effective = new Set(knownDirs)
    for (const session of globalActiveSessions) {
      const dir = (session as { directory?: string | null }).directory?.toLowerCase()
      if (dir) effective.add(dir)
    }

    expect(effective.size).toBe(1)
    expect(effective.has("/known/project")).toBe(true)
  })

  it("deduplicates directories already in knownDirs", () => {
    const knownDirs = new Set(["/known/project"])
    const globalActiveSessions = [
      { id: "s1", directory: "/known/project" },
      { id: "s2", directory: "/known/project" },
      { id: "s3", directory: "/new/dir" },
    ]

    const effective = new Set(knownDirs)
    for (const session of globalActiveSessions) {
      const dir = (session as { directory?: string }).directory?.toLowerCase()
      if (dir) effective.add(dir)
    }

    expect(effective.size).toBe(2)
    expect(effective.has("/known/project")).toBe(true)
    expect(effective.has("/new/dir")).toBe(true)
  })
})
