import "dotenv/config";
import { createWorldClient, type WorldDetail } from "@manycore/aholo-sdk-world";

function requireApiKey(): string {
  const key = process.env.AHOLO_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing AHOLO_API_KEY. Copy .env.example to .env and set your key.");
  }
  return key;
}

export function getWorldClient() {
  return createWorldClient({
    apiKey: requireApiKey(),
    region: "cn",
  });
}

export type WalkableAssets = {
  worldId: string;
  name?: string | null;
  status: string;
  progress?: number | null;
  plyPath?: string | null;
  spzPath?: string | null;
  lodMetaPath?: string | null;
  panoUrl?: string | null;
  upAxis?: string | null;
  preferredViewerUrl?: string | null;
};

export function toWalkableAssets(detail: WorldDetail): WalkableAssets {
  const urls = detail.assets?.splats?.urls;
  const preferredViewerUrl =
    urls?.spzPath || urls?.plyPath || urls?.lodMetaPath || null;

  return {
    worldId: detail.worldId,
    name: detail.name,
    status: detail.status ?? "UNKNOWN",
    progress: detail.progress ?? null,
    plyPath: urls?.plyPath ?? null,
    spzPath: urls?.spzPath ?? null,
    lodMetaPath: urls?.lodMetaPath ?? null,
    panoUrl: detail.assets?.imagery?.panoUrl ?? null,
    upAxis: detail.assets?.semanticsMetadata?.upAxis ?? null,
    preferredViewerUrl,
  };
}
