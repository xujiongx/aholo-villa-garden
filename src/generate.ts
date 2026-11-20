import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getWorldClient, toWalkableAssets } from "./aholo.js";
import { VILLA_GARDEN_PROMPT, WORLD_NAME } from "./prompt.js";

async function main() {
  const world = getWorldClient();
  const existingId = process.env.WORLD_ID?.trim();

  let worldId = existingId;
  if (!worldId) {
    console.log("Creating Spatial Gen world…");
    const created = await world.generations.create({
      name: WORLD_NAME,
      prompt: VILLA_GARDEN_PROMPT,
    });
    worldId = created.worldId;
    console.log(`worldId=${worldId}`);
  } else {
    console.log(`Resuming worldId=${worldId}`);
  }

  console.log("Polling until SUCCEEDED (this can take several minutes)…");
  const detail = await world.waitFor(worldId, {
    intervalMs: 10_000,
    timeoutMs: 45 * 60_000,
  });

  const assets = toWalkableAssets(detail);
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  const outPath = join(process.cwd(), "data", "latest-world.json");
  writeFileSync(outPath, JSON.stringify(assets, null, 2));

  console.log("\nGeneration succeeded.");
  console.log(JSON.stringify(assets, null, 2));
  console.log(`\nSaved ${outPath}`);
  console.log("Start the demo UI: npm run dev");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
