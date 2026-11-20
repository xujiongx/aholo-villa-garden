import {
  Asset,
  Entity,
  Vec3,
  Quat,
  math,
  AnimComponentSystem,
  AnimationComponentSystem,
} from "playcanvas";
import { createViewer } from "@playcanvas/supersplat-viewer/viewer";
import { defaultSettings } from "@playcanvas/supersplat-viewer/settings";

const params = new URLSearchParams(location.search);
const contentUrl = params.get("content");
const posterUrl = params.get("poster") || undefined;
const upAxis = (params.get("up") || "Z").toUpperCase();
const hint = document.getElementById("hint");
const host = document.getElementById("host");
const toolbarHint = document.querySelector("#toolbar span");

const CHAR_URL = "/models/Soldier.glb";
const MOVE_SPEED = 4.5;
const SPRINT_MULT = 1.85;
const MOUSE_SENS = 0.0025;
const CAM_DIST = 4.2;
const CAM_HEIGHT = 1.7;
const CAM_LOOK_Y = 1.2;

function setHint(text, { error = false, hideAfterMs = 0 } = {}) {
  hint.hidden = false;
  hint.classList.toggle("error", error);
  hint.textContent = text;
  if (hideAfterMs > 0) {
    setTimeout(() => {
      hint.hidden = true;
    }, hideAfterMs);
  }
}

function fallbackToSsv(reason) {
  const url = new URL("/ssv/index.html", location.origin);
  url.searchParams.set("content", contentUrl);
  url.searchParams.set("webgl", "1");
  url.searchParams.set("lang", "zh-CN");
  if (posterUrl) url.searchParams.set("poster", posterUrl);
  setHint(`${reason}，3 秒后改用备用查看器…`, { error: true });
  setTimeout(() => location.replace(url.href), 3000);
}

function findGsplatEntities(entity, out = []) {
  if (entity?.gsplat) out.push(entity);
  for (const child of entity?.children || []) findGsplatEntities(child, out);
  return out;
}

function correctAholoZUp(app) {
  if (upAxis !== "Z") return false;
  const entities = findGsplatEntities(app.root);
  for (const entity of entities) {
    // SuperSplat maps +Z-up (LCC2) with (270,0,0); AHOLO PLY is also +Z-up.
    entity.setLocalEulerAngles(270, 0, 0);
  }
  return entities.length > 0;
}

function ensureAnimSystems(app) {
  if (!app.systems.animation) {
    try {
      app.systems.add(new AnimationComponentSystem(app));
    } catch (err) {
      console.warn("AnimationComponentSystem", err);
    }
  }
  if (!app.systems.anim) {
    try {
      app.systems.add(new AnimComponentSystem(app));
    } catch (err) {
      console.warn("AnimComponentSystem", err);
    }
  }
}

function getSceneAabb(app) {
  const box = { min: new Vec3(Infinity, Infinity, Infinity), max: new Vec3(-Infinity, -Infinity, -Infinity) };
  let any = false;
  const visit = (entity) => {
    if (entity.gsplat?.instance?.meshInstances) {
      for (const mi of entity.gsplat.instance.meshInstances) {
        const b = mi?.aabb;
        if (!b) continue;
        any = true;
        box.min.min(b.getMin());
        box.max.max(b.getMax());
      }
    }
    // unified gsplat may expose different paths — also use render aabbs
    if (entity.render?.meshInstances) {
      for (const mi of entity.render.meshInstances) {
        const b = mi?.aabb;
        if (!b) continue;
        any = true;
        box.min.min(b.getMin());
        box.max.max(b.getMax());
      }
    }
    for (const child of entity.children || []) visit(child);
  };
  visit(app.root);
  if (!any) return null;
  const center = new Vec3().add2(box.min, box.max).mulScalar(0.5);
  const half = new Vec3().sub2(box.max, box.min).mulScalar(0.5);
  return { center, half, min: box.min, max: box.max };
}

function loadSoldier(app) {
  return new Promise((resolve, reject) => {
    const asset = new Asset("soldier", "container", { url: CHAR_URL });
    app.assets.add(asset);
    asset.on("error", (err) => reject(err || new Error("character load failed")));
    asset.on("load", () => {
      try {
        const entity = asset.resource.instantiateRenderEntity();
        entity.name = "Player";
        resolve({ entity, asset });
      } catch (err) {
        reject(err);
      }
    });
    app.assets.load(asset);
  });
}

function setupCharacterAnimation(entity, asset) {
  const animations = asset.resource?.animations || [];
  if (!animations.length) return null;
  try {
    if (!entity.animation) {
      entity.addComponent("animation", {
        assets: animations,
        speed: 1,
      });
    }
    return entity.animation;
  } catch (err) {
    console.warn("animation component failed", err);
    return null;
  }
}

let _clipCache = {};
function playClip(animation, name) {
  if (!animation) return;
  const key = name.toLowerCase();
  if (!_clipCache[key]) {
    const dict = animation.dictionary || {};
    const names = Object.keys(dict);
    _clipCache[key] =
      names.find((n) => n.toLowerCase() === key) ||
      names.find((n) => n.toLowerCase().includes(key)) ||
      name;
  }
  const clip = _clipCache[key];
  try {
    if (animation.currAnim === clip) return;
    animation.play(clip, 0.12);
  } catch (err) {
    console.warn("play clip failed", clip, err);
  }
}

function startThirdPerson(app, viewer, character) {
  // Take over input from SuperSplat fly mode.
  viewer.state.gamingControls = false;
  viewer.state.inputEnabled = false;
  try {
    viewer.state.cameraMode = "orbit";
  } catch {
    /* ignore */
  }

  const keys = new Set();
  let yaw = 0;
  let pitch = 0.25;
  let pointerLocked = false;

  const camEntity =
    app.root.findOne((n) => n.camera) ||
    app.root.children?.find?.((n) => n.camera);

  if (!camEntity?.camera) {
    console.warn("camera entity not found");
    return;
  }

  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  const canvas = host.querySelector("canvas") || host;
  canvas.addEventListener("click", () => {
    if (!pointerLocked) canvas.requestPointerLock?.();
  });
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
  });
  document.addEventListener("mousemove", (e) => {
    if (!pointerLocked) return;
    yaw -= e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    pitch = math.clamp(pitch, -0.9, 0.85);
  });

  const forward = new Vec3();
  const right = new Vec3();
  const move = new Vec3();
  const camPos = new Vec3();
  const lookAt = new Vec3();
  let groundedY = character.getPosition().y;
  let anim = character.animation;

  app.on("update", (dt) => {
    if (!character.parent) return;

    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const speed = MOVE_SPEED * (sprint ? SPRINT_MULT : 1) * Math.max(character.getLocalScale().x, 0.01);

    // Camera-relative planar move
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    move.set(0, 0, 0);
    if (keys.has("KeyW")) move.add(forward);
    if (keys.has("KeyS")) move.sub(forward);
    if (keys.has("KeyD")) move.add(right);
    if (keys.has("KeyA")) move.sub(right);

    const moving = move.lengthSq() > 0.0001;
    if (moving) {
      move.normalize().mulScalar(speed * dt);
      const p = character.getPosition();
      p.add(move);
      p.y = groundedY;
      character.setPosition(p);

      // Face move direction
      const faceYaw = Math.atan2(move.x, move.z);
      character.setLocalEulerAngles(0, faceYaw * math.RAD_TO_DEG, 0);
      playClip(anim, sprint ? "Run" : "Walk");
    } else {
      playClip(anim, "Idle");
    }

    // Third-person camera
    const cp = character.getPosition();
    const horiz = Math.cos(pitch) * CAM_DIST * Math.max(character.getLocalScale().x, 1);
    const vert = Math.sin(pitch) * CAM_DIST * Math.max(character.getLocalScale().x, 1) + CAM_HEIGHT * Math.max(character.getLocalScale().y, 1);
    camPos.set(
      cp.x + Math.sin(yaw) * horiz,
      cp.y + vert,
      cp.z + Math.cos(yaw) * horiz,
    );
    lookAt.set(cp.x, cp.y + CAM_LOOK_Y * Math.max(character.getLocalScale().y, 1), cp.z);
    camEntity.setPosition(camPos);
    camEntity.lookAt(lookAt);
  });
}

if (!contentUrl) {
  setHint("缺少 content 地址", { error: true });
  throw new Error("missing content");
}

if (toolbarHint) {
  toolbarHint.textContent = "点击画面锁定鼠标 · WASD 控制人物行走 · Shift 奔跑 · Esc 解锁";
}

let viewer;
try {
  viewer = await createViewer({
    container: host,
    settings: defaultSettings("environment"),
    contentUrl,
    posterUrl,
    skyboxUrl: posterUrl,
    renderer: "webgl",
    reticle: true,
    lang: "zh-CN",
    zstdDecoderUrl: "/vendor/supersplat-viewer/zstd-decoder.wasm",
    gsafDecoderUrl: "/vendor/supersplat-viewer/gsaf-decoder.wasm",
  });
} catch (err) {
  console.error(err);
  fallbackToSsv(`查看器启动失败：${err?.message || err}`);
  throw err;
}

const loadWatchdog = setTimeout(() => {
  if (!viewer.state.loaded) fallbackToSsv("加载超时（PLY 约 30MB，或模块加载失败）");
}, 90000);

async function onReady() {
  clearTimeout(loadWatchdog);
  const app = viewer.app;
  ensureAnimSystems(app);

  try {
    correctAholoZUp(app);
  } catch (err) {
    console.warn(err);
  }

  try {
    viewer.frameScene();
  } catch (err) {
    console.warn(err);
  }

  setHint("场景已加载，正在放入可操控角色…");

  try {
    const { entity, asset } = await loadSoldier(app);
    setupCharacterAnimation(entity, asset);

    // Scale character to scene — AHOLO worlds can be huge.
    const aabb = getSceneAabb(app);
    let scale = 1;
    if (aabb) {
      const span = Math.max(aabb.half.x, aabb.half.z) * 2;
      scale = math.clamp(span / 80, 0.8, 12);
    }
    entity.setLocalScale(scale, scale, scale);

    // Spawn near scene center on the lower surface.
    let spawn = new Vec3(0, 0, 0);
    if (aabb) {
      spawn.copy(aabb.center);
      spawn.y = aabb.min.y + scale * 0.05;
    } else {
      const cam = app.root.findOne((n) => n.camera);
      if (cam) spawn.copy(cam.getPosition());
    }
    entity.setPosition(spawn);
    app.root.addChild(entity);

    // Small delay so AABB/camera settle after Z-up + frame.
    setTimeout(() => {
      const aabb2 = getSceneAabb(app);
      if (aabb2) {
        const p = entity.getPosition();
        p.x = aabb2.center.x;
        p.z = aabb2.center.z;
        p.y = aabb2.min.y + scale * 0.05;
        entity.setPosition(p);
      }
      startThirdPerson(app, viewer, entity);
      setHint(
        "点击画面锁定鼠标。WASD 控制人物行走，鼠标转动视角，Shift 奔跑。",
        { hideAfterMs: 14000 },
      );
    }, 500);
  } catch (err) {
    console.error(err);
    setHint(`角色加载失败：${err?.message || err}。仍可用查看器浏览场景。`, {
      error: true,
      hideAfterMs: 10000,
    });
    // Fallback: fly mode
    viewer.state.gamingControls = true;
    viewer.state.cameraMode = "fly";
  }
}

if (viewer.state.loaded) onReady();
else viewer.events.once("loaded:changed", onReady);

viewer.events.on("progress:changed", (progress) => {
  if (!viewer.state.loaded) setHint(`正在加载资源 ${Math.round(progress)}%…`);
});
