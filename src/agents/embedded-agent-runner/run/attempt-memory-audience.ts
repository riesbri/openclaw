import type { SessionEntry } from "../../../config/sessions/types.js";
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import {
  assertMemoryAudienceSession,
  isHostMemoryAudience,
  resolveMemoryAudienceFromEntry,
} from "../../../plugins/memory-audience.js";
import type { MemoryAudience } from "../../../plugins/memory-provider-types.js";
import { log } from "../logger.js";

const retainedAudience = () => {};

/**
 * Keep a delegated audience bound to this attempt, or resolve its admitted
 * source row. The returned release ends the attempt-owned session leases.
 */
export async function resolveEmbeddedAttemptMemoryAudience(params: {
  memoryAudience?: MemoryAudience;
  config?: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  sessionId: string;
  senderIsOwner: boolean | undefined;
  admission?: { entry: SessionEntry; storePath: string };
  assertCallerCurrent?: () => void;
}): Promise<{ memoryAudience?: MemoryAudience; release: () => void }> {
  if (params.memoryAudience) {
    if (!isHostMemoryAudience(params.memoryAudience)) {
      throw new Error("Embedded run memory audience must be host-minted.");
    }
    // The delegating owner keeps custody of a supplied audience's leases.
    assertMemoryAudienceSession(params.memoryAudience, params.sessionKey);
    return { memoryAudience: params.memoryAudience, release: retainedAudience };
  }
  // Private plugin tools consume the same host-owned audience independently of
  // the memory provider. Rowless maintenance runs still need explicit delegation;
  // never derive authority from copied chat metadata or the session-key shape.
  if (!params.admission) {
    return { release: retainedAudience };
  }
  const resolution = await resolveMemoryAudienceFromEntry(
    {
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      senderIsOwner: params.senderIsOwner,
      storePath: params.admission.storePath,
      assertCallerCurrent: params.assertCallerCurrent,
    },
    params.admission.entry,
  );
  if (resolution.status === "granted") {
    return { memoryAudience: resolution.audience, release: resolution.release };
  }
  // A denial grants no private or conversation memory. Stale lineage warns once
  // per attempt because its reason names the only repair; transient checks are
  // retried by the next turn, and ineligible lineage is the intended outcome.
  const message = `memory audience unavailable: ${resolution.reason}`;
  const meta = { event: "memory_audience_denied", kind: resolution.kind };
  const level =
    resolution.kind === "stale-lineage"
      ? "warn"
      : resolution.kind === "unverified"
        ? "info"
        : "debug";
  log[level](message, meta);
  return { release: retainedAudience };
}
