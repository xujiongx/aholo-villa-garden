import "dotenv/config";
import express from "express";
import cors from "cors";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getWorldClient, toWalkableAssets } from "./aholo.js";
import { VILLA_GARDEN_PROMPT, WORLD_NAME } from "./prompt.js";

const PORT = Number(process.env.PORT || 3847);
const DATA_DIR = join(process.cwd(), "data");
const LATEST_PATH = join(DATA_DIR, "latest-world.json");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(process.cwd(), "public")));
app.use(
  "/vendor/gaussian-splats-3d",
  express.static(join(process.cwd(), "node_modules/@mkkellogg/gaussian-splats-3d/build")),
);
app.use(
  "/vendor/three",
  express.static(join(process.cwd(), "node_modules/three")),
);
app.use(
  "/vendor/playcanvas-build",
  express.static(join(process.cwd(), "node_modules/playcanvas/build")),
);
// Full package so `playcanvas/scripts/esm/...` imports resolve.
app.use(
  "/vendor/playcanvas",
  express.static(join(process.cwd(), "node_modules/playcanvas")),
);
app.use(
  "/vendor/supersplat-viewer",
  express.static(join(process.cwd(), "node_modules/@playcanvas/supersplat-viewer/dist")),
);

type JobState = {
  worldId: string;
  status: string;
  progress: number | null;
  error?: string;
};

let activeJob: JobState | null = null;

function loadLatest() {
  if (!existsSync(LATEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LATEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveLatest(payload: unknown) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LATEST_PATH, JSON.stringify(payload, null, 2));
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.AHOLO_API_KEY),
    worldId: process.env.WORLD_ID || loadLatest()?.worldId || null,
  });
});

app.get("/api/worlds", async (_req, res) => {
  try {
    const world = getWorldClient();
    const page = await world.list({ pageNum: 0, pageSize: 50 });
    const items = page.result ?? [];
    const worlds = await Promise.all(
      items.map(async (item) => {
        try {
          const detail = await world.retrieve(item.worldId);
          return toWalkableAssets(detail);
        } catch {
          return toWalkableAssets(item as Parameters<typeof toWalkableAssets>[0]);
        }
      }),
    );
    const ready = worlds.find((w) => w.plyPath || w.spzPath || w.lodMetaPath);
    if (ready) saveLatest(ready);
    res.json({
      totalCount: page.totalCount ?? worlds.length,
      worlds,
      job: activeJob,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
      worlds: [],
      job: activeJob,
    });
  }
});

app.get("/api/world/latest", async (_req, res) => {
  try {
    const world = getWorldClient();
    const cached = loadLatest();
    const worldId = process.env.WORLD_ID || cached?.worldId;
    if (!worldId) {
      res.json({ job: activeJob, world: null });
      return;
    }
    const detail = await world.retrieve(worldId);
    const assets = toWalkableAssets(detail);
    if (detail.status === "SUCCEEDED" || assets.preferredViewerUrl) saveLatest(assets);
    activeJob = {
      worldId,
      status: detail.status ?? "UNKNOWN",
      progress: detail.progress ?? null,
    };
    res.json({ job: activeJob, world: assets });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
      job: activeJob,
      world: loadLatest(),
    });
  }
});

app.get("/api/world/:worldId", async (req, res) => {
  try {
    const world = getWorldClient();
    const detail = await world.retrieve(req.params.worldId);
    const assets = toWalkableAssets(detail);
    if (detail.status === "SUCCEEDED" || assets.preferredViewerUrl) saveLatest(assets);
    res.json(assets);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/world/generate", async (req, res) => {
  try {
    if (activeJob && ["PENDING", "PREPROCESSING", "RUNNING"].includes(activeJob.status)) {
      res.status(409).json({ error: "A generation job is already running", job: activeJob });
      return;
    }

    const world = getWorldClient();
    const name = typeof req.body?.name === "string" && req.body.name.trim()
      ? req.body.name.trim()
      : WORLD_NAME;
    const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim()
      ? req.body.prompt.trim()
      : VILLA_GARDEN_PROMPT;

    const { worldId } = await world.generations.create({ name, prompt });
    activeJob = { worldId, status: "PENDING", progress: 0 };
    process.env.WORLD_ID = worldId;
    res.json({ worldId, prompt, name });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/prompt", (_req, res) => {
  res.json({ name: WORLD_NAME, prompt: VILLA_GARDEN_PROMPT });
});

/** Proxy splat / pano downloads so the browser viewer can load cross-origin assets. */
app.get("/api/proxy", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!/^https:\/\//i.test(url)) {
    res.status(400).send("url must be https");
    return;
  }
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.status(upstream.status).send(`upstream ${upstream.status}`);
      return;
    }
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (!upstream.body) {
      res.status(502).send("empty upstream body");
      return;
    }
    const { Readable } = await import("node:stream");
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
  } catch (err) {
    res.status(502).send(err instanceof Error ? err.message : String(err));
  }
});

app.listen(PORT, () => {
  console.log(`AHOLO villa garden demo → http://localhost:${PORT}`);
  console.log(`Tracking WORLD_ID=${process.env.WORLD_ID || "(none yet)"}`);
});
