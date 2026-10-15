import fs from "node:fs/promises";
import path from "node:path";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { createOpenClawTestState } from "openclaw/plugin-sdk/test-state";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  configureMemoryCoreDreamingStateForTests,
  resetMemoryCoreDreamingStateForTests,
} from "../test-helpers.js";
import { runInMemoryTestBackgroundContext } from "./background-context.test-support.js";
import { MemoryIndexManager } from "./manager.js";

// A detached search sync borrows the CLI manager's published database. Standalone
// process teardown must drain it before that shared connection is disposed, while
// still keeping the wait bounded.
type DrainFields = {
  activeBackgroundSearchSyncs: Set<Promise<void>>;
  awaitManagerIdle: () => Promise<void>;
};

describe("MemoryIndexManager detached search sync teardown", () => {
  let state: Awaited<ReturnType<typeof createOpenClawTestState>>;
  const managers: MemoryIndexManager[] = [];

  beforeAll(async () => {
    state = await createOpenClawTestState({ label: "memory-cli-detached-sync-drain" });
    await configureMemoryCoreDreamingStateForTests();
    await fs.mkdir(path.join(state.workspaceDir, "memory"));
    await fs.writeFile(path.join(state.workspaceDir, "memory", "note.md"), "Alpha memory.");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await Promise.allSettled(managers.map((manager) => manager.close()));
    resetMemoryCoreDreamingStateForTests();
    await state.cleanup();
  });

  async function open(purpose: "cli" | "default"): Promise<DrainFields> {
    const agentId = `detached-drain-${purpose}`;
    const cfg: OpenClawConfig = {
      plugins: { enabled: false },
      agents: { defaults: { workspace: state.workspaceDir }, entries: { [agentId]: {} } },
      memory: {
        search: {
          provider: "none",
          sources: ["memory"],
          store: { vector: { enabled: false } },
        },
      },
    };
    const manager = await MemoryIndexManager.get({
      runInBackgroundContext: runInMemoryTestBackgroundContext,
      cfg,
      agentId,
      purpose,
    });
    if (!manager) {
      throw new Error("Expected a Memory manager");
    }
    managers.push(manager);
    return manager as unknown as DrainFields;
  }

  function addPendingSync(fields: DrainFields) {
    const gate = createDeferred<void>();
    fields.activeBackgroundSearchSyncs.add(gate.promise.then(() => undefined));
    return gate;
  }

  it("reports completion immediately when no detached sync is pending", async () => {
    const fields = await open("cli");
    await expect(fields.drainDetachedSearchSyncs(50)).resolves.toBe(true);
  });

  it("waits for a pending detached sync and reports completion", async () => {
    const fields = await open("cli");
    const gate = addPendingSync(fields);
    let settled = false;
    const drain = fields.drainDetachedSearchSyncs(5_000).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    gate.resolve();
    await expect(drain).resolves.toBe(true);
  });

  it("reports an expired budget instead of waiting indefinitely", async () => {
    const fields = await open("cli");
    const gate = addPendingSync(fields);
    await expect(fields.drainDetachedSearchSyncs(20)).resolves.toBe(false);
    gate.resolve();
    await Promise.allSettled(Array.from(fields.activeBackgroundSearchSyncs));
  });

  it("drains a pending detached sync before CLI idle completes", async () => {
    const fields = await open("cli");
    const gate = addPendingSync(fields);
    let idleSettled = false;
    const idle = fields.awaitManagerIdle().then(() => {
      idleSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(idleSettled).toBe(false);
    gate.resolve();
    await idle;
    expect(idleSettled).toBe(true);
  });
});
