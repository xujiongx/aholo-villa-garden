import { createViewer } from "@playcanvas/supersplat-viewer/viewer";
import { defaultSettings } from "@playcanvas/supersplat-viewer/settings";

const params = new URLSearchParams(location.search);
const contentUrl = params.get("content");
const posterUrl = params.get("poster") || undefined;
const hint = document.getElementById("hint");
const host = document.getElementById("host");

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
  setTimeout(() => {
    location.replace(url.href);
  }, 3000);
}

if (!contentUrl) {
  setHint("缺少 content 地址", { error: true });
  throw new Error("missing content");
}

try {
  localStorage.setItem("gamingControls", "true");
} catch {
  /* ignore */
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

const enablePlayControls = () => {
  viewer.state.gamingControls = true;
  viewer.state.cameraMode = "fly";
};

const onReady = () => {
  try {
    viewer.frameScene();
  } catch (err) {
    console.warn(err);
  }

  setTimeout(() => {
    enablePlayControls();
    setHint(
      "已对准场景。点击画面锁定鼠标转向，WASD 移动，Esc 解锁。",
      { hideAfterMs: 12000 },
    );
  }, 600);
};

// Safety: if first frame never arrives, fall back.
const loadWatchdog = setTimeout(() => {
  if (!viewer.state.loaded) {
    fallbackToSsv("加载超时（PLY 约 30MB，或模块加载失败）");
  }
}, 90000);

const markReady = () => {
  clearTimeout(loadWatchdog);
  onReady();
};

if (viewer.state.loaded) markReady();
else viewer.events.once("loaded:changed", markReady);

viewer.events.on("progress:changed", (progress) => {
  if (!viewer.state.loaded) {
    setHint(`正在加载资源 ${Math.round(progress)}%…`);
  }
});

host.addEventListener("pointerdown", () => {
  enablePlayControls();
});
