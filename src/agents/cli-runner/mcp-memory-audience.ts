import { resolveMemoryAudienceFromEntry } from "../../plugins/memory-audience.js";
import type { MemoryAudience } from "../../plugins/memory-provider-types.js";
import { cliBackendLog } from "./log.js";
import type { RunCliAgentParams } from "./types.js";

/** Private plugin tools need session authority independently of the memory provider. */
export async function resolveCliMcpMemoryAudience(
  run: Pick<
    RunCliAgentParams,
    "config" | "sessionId" | "senderIsOwner" | "sessionEntry" | "sessionTarget" | "storePath"
  > & { assertCurrent?: () => void },
  grant: { agentId: string; sessionKey: string },
): Promise<{ memoryAudience?: MemoryAudience; release: () => void }> {
  const storePath = run.sessionTarget?.storePath ?? run.storePath;
  if (!run.sessionEntry || !storePath) {
    return { release: () => {} };
  }
  const resolution = await resolveMemoryAudienceFromEntry(
    {
      agentId: grant.agentId,
      sessionKey: grant.sessionKey,
      sessionId: run.sessionId,
      senderIsOwner: run.senderIsOwner,
      storePath,
      assertCallerCurrent: run.assertCurrent,
    },
    run.sessionEntry,
  );
  if (resolution.status === "granted") {
    return { memoryAudience: resolution.audience, release: resolution.release };
  }
  const level = resolution.kind === "stale-lineage" ? "warn" : "debug";
  cliBackendLog[level](`private tool audience unavailable: ${resolution.reason}`);
  return { release: () => {} };
}
