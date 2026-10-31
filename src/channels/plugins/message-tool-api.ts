import { loadOptionalBundledChannelPublicArtifact } from "./optional-public-artifact.js";
import type { ChannelMessageActionAdapter } from "./types.public.js";

export type ChannelMessageToolDiscoveryAdapter = Pick<
  ChannelMessageActionAdapter,
  "describeMessageTool"
>;

/**
 * Resolves a bundled channel's message-tool discovery adapter without loading the full plugin.
 */
export function resolveBundledChannelMessageToolDiscoveryAdapter(
  channelId: string,
): ChannelMessageToolDiscoveryAdapter | undefined {
  // System-agent turns use this internal transport, not a channel plugin.
  // Looking it up as a facade can instead match unrelated plugin folder names.
  if (channelId.trim() === "openclaw") {
    return undefined;
  }
  const api: Partial<ChannelMessageToolDiscoveryAdapter> | undefined =
    loadOptionalBundledChannelPublicArtifact({
      channelId,
      artifactBasename: "message-tool-api.js",
    });
  const describeMessageTool = api?.describeMessageTool;
  if (typeof describeMessageTool !== "function") {
    return undefined;
  }
  return { describeMessageTool };
}
