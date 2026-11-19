import { CODEX_APP_SERVER_VERSION } from "./src/app-server/version.js";

/**
 * Model discovery must report this retained bridge's managed package pin, not
 * the host's independent Codex pin or a global CLI. This bridge selects its
 * bundled package for ordinary stdio turns. As with the host's public contract,
 * custom commands, remote servers, and desktop-first retain the bundled pin;
 * this API does not attest the version of an externally managed executable.
 */
export async function resolveCodexClientVersion(): Promise<string> {
  return CODEX_APP_SERVER_VERSION;
}
