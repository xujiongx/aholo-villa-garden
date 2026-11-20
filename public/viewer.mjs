import * as THREE from "three";
import * as GaussianSplats3D from "/vendor/gaussian-splats-3d/gaussian-splats-3d.module.js";

const params = new URLSearchParams(location.search);
const plyUrl = params.get("ply");
const upAxis = (params.get("up") || "Z").toUpperCase();
const statusEl = document.getElementById("status");
const host = document.getElementById("host");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = !text;
}

if (!plyUrl) {
  setStatus("缺少 ply 地址", true);
  throw new Error("missing ply");
}

// AHOLO Spatial Gen is Z-up. Initial guess is overridden after load by fitting bounds.
const cameraUp = upAxis === "Z" ? [0, 0, 1] : [0, 1, 0];

setStatus("正在加载 3DGS（约 33MB，请稍候）…");

const viewer = new GaussianSplats3D.Viewer({
  rootElement: host,
  cameraUp,
  initialCameraPosition: [0, -6, 2],
  initialCameraLookAt: [0, 0, 1.5],
  sharedMemoryForWorkers: false,
  gpuAcceleratedSort: true,
});

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
}

function fitCameraToSplats() {
  const splatMesh = viewer.splatMesh;
  if (!splatMesh) return false;

  const count = splatMesh.getSplatCount();
  if (!count) return false;

  const step = Math.max(1, Math.floor(count / 8000));
  const xs = [];
  const ys = [];
  const zs = [];
  const tmp = new THREE.Vector3();

  for (let i = 0; i < count; i += step) {
    splatMesh.getSplatCenter(i, tmp, true);
    xs.push(tmp.x);
    ys.push(tmp.y);
    zs.push(tmp.z);
  }

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);

  // Robust center (avoid outlier spikes that make LOD forwardBox.z → 800+)
  const cx = percentile(xs, 0.5);
  const cy = percentile(ys, 0.5);
  const cz = percentile(zs, 0.5);
  const xSpan = percentile(xs, 0.9) - percentile(xs, 0.1);
  const ySpan = percentile(ys, 0.9) - percentile(ys, 0.1);
  const zSpan = percentile(zs, 0.9) - percentile(zs, 0.1);
  const radius = Math.max(8, 0.35 * Math.max(xSpan, ySpan, zSpan));

  const lookAt = new THREE.Vector3(cx, cy, cz);
  const position = lookAt.clone();

  if (upAxis === "Z") {
    // Stand back along -Y, slight elevation along +Z (eye height)
    position.y -= radius;
    position.z += Math.min(4, radius * 0.15);
  } else {
    position.z -= radius;
    position.y += Math.min(4, radius * 0.15);
  }

  if (viewer.camera) {
    viewer.camera.near = 0.05;
    viewer.camera.far = Math.max(5000, radius * 40);
    viewer.camera.position.copy(position);
    viewer.camera.up.fromArray(cameraUp).normalize();
    viewer.camera.lookAt(lookAt);
    viewer.camera.updateProjectionMatrix();
  }

  for (const controls of [viewer.controls, viewer.perspectiveControls, viewer.orthographicControls]) {
    if (!controls) continue;
    controls.target.copy(lookAt);
    controls.minDistance = 0.5;
    controls.maxDistance = Math.max(200, radius * 20);
    controls.update();
  }

  console.info("[viewer] fitted camera", {
    count,
    lookAt: lookAt.toArray(),
    position: position.toArray(),
    radius,
  });
  return true;
}

try {
  await viewer.addSplatScene(plyUrl, {
    showLoadingUI: true,
    progressiveLoad: true,
    splatAlphaRemovalThreshold: 1,
    format: GaussianSplats3D.SceneFormat.Ply,
  });
  viewer.start();

  // Progressive load: refit a few times as more splats arrive.
  const tryFit = () => {
    try {
      fitCameraToSplats();
    } catch (e) {
      console.warn(e);
    }
  };
  tryFit();
  setTimeout(tryFit, 1500);
  setTimeout(tryFit, 4000);
  setTimeout(tryFit, 8000);

  setStatus("已对准场景 · 拖拽旋转 · 滚轮缩放。若仍偏暗可继续拖动/滚轮拉近。");
  setTimeout(() => {
    statusEl.hidden = true;
  }, 8000);
} catch (err) {
  console.error(err);
  setStatus(`加载失败：${err?.message || err}`, true);
}
