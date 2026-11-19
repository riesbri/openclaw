import { describe, expect, it } from "vitest";
import { resolveCodexClientVersion } from "./client-version-api.js";
import { CODEX_APP_SERVER_VERSION } from "./src/app-server/version.js";

describe("Codex client version public surface", () => {
  it("exposes the retained plugin's managed pin to host model discovery", async () => {
    await expect(resolveCodexClientVersion()).resolves.toBe(CODEX_APP_SERVER_VERSION);
  });
});
