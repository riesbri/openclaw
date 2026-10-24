import type { MemoryAudience } from "../../plugins/memory-provider-types.js";
import { resolveEmbeddedAttemptMemoryAudience } from "../embedded-agent-runner/run/attempt-memory-audience.js";
import type { RunCliAgentParams } from "./types.js";

/** Resolve the host-owned memory audience for one admitted CLI MCP run. */
export async function resolveCliMcpMemoryAudience(
  run: Pick<
    RunCliAgentParams,
    "config" | "sessionId" | "senderIsOwner" | "sessionEntry" | "sessionTarget" | "storePath"
  > & { assertCurrent?: () => void },
  grant: { agentId: string; sessionKey: string },
): Promise<{ memoryAudience?: MemoryAudience; release: () => void }> {
  const storePath = run.sessionTarget?.storePath ?? run.storePath;
  return resolveEmbeddedAttemptMemoryAudience({
    config: run.config,
    agentId: grant.agentId,
    sessionKey: grant.sessionKey,
    sessionId: run.sessionId,
    senderIsOwner: run.senderIsOwner,
    admission: run.sessionEntry && storePath ? { entry: run.sessionEntry, storePath } : undefined,
    assertCallerCurrent: run.assertCurrent,
  });
}
