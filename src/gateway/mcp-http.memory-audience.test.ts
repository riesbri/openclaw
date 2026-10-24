import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareSystemAgentRunAdmission } from "../agents/admitted-run-context.js";
import { assertMemoryAudienceCurrent } from "../plugins/memory-audience.js";
import {
  withChildAudience,
  AUDIENCE_CHILD_KEY,
} from "../plugins/memory-provider-runtime.audience.test-support.js";
import {
  activateMcpLoopbackClientGrantCapture,
  bindMcpLoopbackClientGrantAdmission,
  mintMcpLoopbackClientGrant,
  revokeMcpLoopbackClientGrant,
} from "./mcp-grant-store.js";
import { closeMcpLoopbackServer, ensureMcpLoopbackServer } from "./mcp-http.js";
import { getActiveMcpLoopbackRuntime } from "./mcp-http.loopback-runtime.js";
import type { resolveGatewayScopedTools } from "./tool-resolution.js";

const resolveTools = vi.hoisted(() => vi.fn<typeof resolveGatewayScopedTools>());
vi.mock("../config/io.js", () => ({ getRuntimeConfig: () => ({}) }));
vi.mock("../agents/agent-tools.before-tool-call.js", () => ({
  runBeforeToolCallHook: async ({ params }: { params: unknown }) => ({ blocked: false, params }),
}));
vi.mock("./tool-resolution.js", () => ({ resolveGatewayScopedTools: resolveTools }));

const config = { plugins: { enabled: false }, tools: { allow: ["memory_probe"] } };
const captureKey = "memory-audience-capture";
const admittedRuns: ReturnType<typeof prepareSystemAgentRunAdmission>[] = [];
const grants: string[] = [];

async function request(token: string, method: "tools/list" | "tools/call") {
  const runtime = getActiveMcpLoopbackRuntime();
  if (!runtime) {
    throw new Error("expected active MCP loopback runtime");
  }
  const response = await fetch(`http://127.0.0.1:${runtime.port}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-openclaw-cli-capture-key": captureKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(method === "tools/call" ? { params: { name: "memory_probe", arguments: {} } } : {}),
    }),
  });
  return { status: response.status, ...(await response.json()) } as {
    status: number;
    result?: {
      tools?: Array<{ name: string }>;
      content?: Array<{ text?: string }>;
      isError?: boolean;
    };
  };
}

async function mintGrant(params: {
  memoryAudience?: import("../plugins/memory-provider-types.js").MemoryAudience;
  runId: string;
}) {
  const runtime = getActiveMcpLoopbackRuntime();
  if (!runtime) {
    throw new Error("expected active MCP loopback runtime");
  }
  const admission = prepareSystemAgentRunAdmission(
    config,
    params.runId,
    "main",
    "mcp-memory-audience-test",
  );
  admittedRuns.push(admission);
  const admittedRunContext = await admission.admit("gateway");
  const grant = mintMcpLoopbackClientGrant({
    context: {
      sessionKey: AUDIENCE_CHILD_KEY,
      senderIsOwner: false,
      toolsAllow: ["memory_probe"],
    },
    runtimeOwnerToken: runtime.ownerToken,
    admittedRunContext,
    ...(params.memoryAudience ? { memoryAudience: params.memoryAudience } : {}),
  });
  grants.push(grant.token);
  expect(
    bindMcpLoopbackClientGrantAdmission({
      token: grant.token,
      runtimeOwnerToken: runtime.ownerToken,
      admittedRunContext,
    }),
  ).toBe(true);
  expect(
    activateMcpLoopbackClientGrantCapture({
      token: grant.token,
      runtimeOwnerToken: runtime.ownerToken,
      captureKey,
    }),
  ).toBeTruthy();
  return grant;
}

describe("MCP HTTP memory audience", () => {
  beforeEach(async () => {
    resolveTools.mockReset().mockImplementation(async ({ memoryAudience }) => ({
      agentId: "main",
      tools: memoryAudience
        ? [
            {
              name: "memory_probe",
              label: "Memory probe",
              description: "Read synthetic audience-gated data",
              parameters: { type: "object", properties: {} },
              execute: async () => {
                assertMemoryAudienceCurrent(memoryAudience);
                return { content: [{ type: "text", text: "synthetic memory" }] };
              },
            },
          ]
        : [],
    }));
    await ensureMcpLoopbackServer();
  });

  afterEach(async () => {
    for (const token of grants.splice(0)) {
      revokeMcpLoopbackClientGrant(token);
    }
    for (const admission of admittedRuns.splice(0)) {
      admission.close();
    }
    await closeMcpLoopbackServer();
  });

  it("projects a host audience through HTTP list/call and rejects a released audience", async () => {
    await withChildAudience(true, async ({ audience, release }) => {
      const grant = await mintGrant({ memoryAudience: audience, runId: "mcp-audience-owner" });
      expect(await request(grant.token, "tools/list")).toMatchObject({
        result: { tools: [{ name: "memory_probe" }] },
      });
      expect(resolveTools.mock.calls.at(-1)?.[0].memoryAudience).toBe(audience);
      expect(await request(grant.token, "tools/call")).toMatchObject({
        result: { content: [{ text: "synthetic memory" }], isError: false },
      });

      release();
      expect(await request(grant.token, "tools/call")).toMatchObject({ status: 500 });
    });
  });

  it("keeps the audience-gated tool hidden when the grant carries no audience", async () => {
    const grant = await mintGrant({ runId: "mcp-audience-denied" });
    expect(await request(grant.token, "tools/list")).toMatchObject({ result: { tools: [] } });
    expect(resolveTools.mock.calls.at(-1)?.[0].memoryAudience).toBeUndefined();
    expect((await request(grant.token, "tools/call")).result?.isError).toBe(true);
  });
});
