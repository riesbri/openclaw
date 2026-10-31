import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertMemoryAudienceCurrent,
  assertMemoryAudienceSession,
} from "../../plugins/memory-audience.js";
import { fakeSessionOwner } from "../../plugins/memory-audience.test-support.js";
import { resolveCliMcpMemoryAudience } from "./mcp-memory-audience.js";

// mock-isolation: replace only external session storage and publication facts.
vi.mock("../../config/sessions/session-delivery-generation.js", async () => {
  const { fakeSessionGenerationModule } =
    await import("../../plugins/memory-audience.test-support.js");
  return {
    ...fakeSessionGenerationModule,
    prepareSessionGenerationFacts: (
      input: Parameters<typeof fakeSessionGenerationModule.prepareSessionGenerationFacts>[0] & {
        storePath: string;
      },
    ) => {
      expect(input.storePath).toBe(storePath);
      return fakeSessionGenerationModule.prepareSessionGenerationFacts(input);
    },
  };
});
vi.mock("../../config/sessions/session-entry-read-runtime.js", async () => {
  const { fakeSessionEntryReadModule } =
    await import("../../plugins/memory-audience.test-support.js");
  return fakeSessionEntryReadModule;
});
// The shipped memory-core uses the legacy interface. Private API tools still
// need an audience; their authority cannot depend on a memory provider upgrade.
vi.mock("../../plugins/memory-state.js", () => ({
  resolveLoadedMemoryProviderKind: () => "legacy",
}));

const sessionKey = "agent:main:main";
const storePath = "/tmp/cli-private-tool-audience/main.sqlite";

function rootRun(chatType: "direct" | "group" = "direct", senderIsOwner = true) {
  const entry = { sessionId: randomUUID(), chatType, updatedAt: 1 };
  fakeSessionOwner.rows.set(sessionKey, entry);
  return { config: {}, sessionId: entry.sessionId, sessionEntry: entry, storePath, senderIsOwner };
}

describe("CLI private-tool audience with legacy memory", () => {
  beforeEach(() => fakeSessionOwner.reset());

  it("grants the admitted owner-private audience and revokes it on release", async () => {
    const run = rootRun();
    const resolved = await resolveCliMcpMemoryAudience(run, { agentId: "main", sessionKey });
    try {
      expect(resolved.memoryAudience).toEqual({ kind: "owner-private", agentId: "main" });
      assertMemoryAudienceSession(resolved.memoryAudience!, sessionKey);
      expect(() => assertMemoryAudienceCurrent(resolved.memoryAudience!)).not.toThrow();
      expect(fakeSessionOwner.activeLeases).toBe(1);
    } finally {
      resolved.release();
    }
    expect(fakeSessionOwner.activeLeases).toBe(0);
    expect(() => assertMemoryAudienceCurrent(resolved.memoryAudience!)).toThrow();
  });

  it.each([
    ["group", true],
    ["direct", false],
  ] as const)(
    "does not mint owner-private authority for %s / owner=%s",
    async (chatType, senderIsOwner) => {
      const resolved = await resolveCliMcpMemoryAudience(rootRun(chatType, senderIsOwner), {
        agentId: "main",
        sessionKey,
      });
      try {
        expect(resolved.memoryAudience?.kind).toBe("conversation");
      } finally {
        resolved.release();
      }
      expect(fakeSessionOwner.activeLeases).toBe(0);
    },
  );

  it("fails closed without an admitted row or after its incarnation changes", async () => {
    const run = rootRun();
    const missing = await resolveCliMcpMemoryAudience(
      { ...run, sessionEntry: undefined },
      {
        agentId: "main",
        sessionKey,
      },
    );
    expect(missing.memoryAudience).toBeUndefined();
    missing.release();
    fakeSessionOwner.rows.set(sessionKey, { ...run.sessionEntry, sessionId: randomUUID() });
    const stale = await resolveCliMcpMemoryAudience(run, { agentId: "main", sessionKey });
    expect(stale.memoryAudience).toBeUndefined();
    stale.release();
    expect(fakeSessionOwner.activeLeases).toBe(0);
  });
});
