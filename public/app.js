const els = {
  statusChip: document.getElementById("statusChip"),
  hint: document.getElementById("hint"),
  worldList: document.getElementById("worldList"),
  refreshBtn: document.getElementById("refreshBtn"),
  regenBtn: document.getElementById("regenBtn"),
};

let worlds = [];
let pollTimer = null;

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function formatProgress(progress) {
  if (progress == null || Number.isNaN(Number(progress))) return "—";
  return `${Math.round(Number(progress) * 100)}%`;
}

function isReady(world) {
  return Boolean(world?.plyPath || world?.spzPath || world?.lodMetaPath);
}

function pickContentUrl(world) {
  return world.plyPath || world.lodMetaPath || world.spzPath || null;
}

function statusLabel(world) {
  if (isReady(world)) return "可漫游";
  if (["FAILED", "CANCELED", "TIMEOUT", "REJECTED"].includes(world.status)) {
    return world.status;
  }
  return world.status || "UNKNOWN";
}

function enterWorld(world) {
  const content = pickContentUrl(world);
  if (!content) {
    els.hint.textContent = `${world.name || world.worldId} 还没有可查看产物。`;
    return;
  }
  const url = new URL("/walk.html", window.location.origin);
  url.searchParams.set("content", content);
  if (world.panoUrl) url.searchParams.set("poster", world.panoUrl);
  window.location.href = url.href;
}

function renderList(items) {
  worlds = items;
  if (!items.length) {
    els.worldList.innerHTML = `<p class="empty">还没有世界任务。</p>`;
    return;
  }

  // Prefer the newest "完整可玩" world at the top when present.
  const preferredId = "3FO4K4RFDA2T";
  const sorted = [...items].sort((a, b) => {
    if (a.worldId === preferredId) return -1;
    if (b.worldId === preferredId) return 1;
    return 0;
  });
  worlds = sorted;

  els.worldList.innerHTML = worlds
    .map((world, index) => {
      const ready = isReady(world);
      const recommended = world.worldId === preferredId || /完整可玩/.test(world.name || "");
      const cover = world.panoUrl
        ? `<img class="world-cover" src="${world.panoUrl}" alt="" loading="lazy" />`
        : `<div class="world-cover placeholder">${ready ? "可进入" : "生成中…"}</div>`;
      return `
        <article class="world-card ${recommended ? "recommended" : ""}" data-index="${index}">
          ${recommended ? `<span class="badge">推荐完整场景</span>` : ""}
          ${cover}
          <div class="world-body">
            <h2>${world.name || "未命名世界"}</h2>
            <p class="world-id"><code>${world.worldId}</code></p>
            <div class="world-meta">
              <span>${statusLabel(world)}</span>
              <span>进度 ${formatProgress(world.progress)}</span>
              <span>上轴 ${world.upAxis || "—"}</span>
            </div>
            <div class="world-actions">
              <button type="button" class="btn primary" data-enter="${index}" ${ready ? "" : "disabled"}>
                ${ready ? "进入游玩" : "生成中…"}
              </button>
              ${
                world.panoUrl
                  ? `<a class="btn ghost" href="${world.panoUrl}" target="_blank" rel="noreferrer">全景图</a>`
                  : ""
              }
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  els.worldList.querySelectorAll("[data-enter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-enter"));
      enterWorld(worlds[i]);
    });
  });
}

async function refreshList() {
  try {
    els.statusChip.textContent = "同步中…";
    const data = await fetchJson("/api/worlds");
    renderList(data.worlds || []);
    const readyCount = (data.worlds || []).filter(isReady).length;
    const running = (data.worlds || []).some(
      (w) => !isReady(w) && !["FAILED", "CANCELED", "TIMEOUT", "REJECTED", "SUCCEEDED"].includes(w.status),
    );
    els.statusChip.textContent = `${data.totalCount ?? worlds.length} 个任务 · ${readyCount} 可漫游`;
    els.hint.textContent = running
      ? "仍有任务在进行；列表会自动刷新。进入后点击画面，鼠标即可转向。"
      : "点「进入漫游」后：点击画面锁定鼠标转向，WASD 移动。";
    return running;
  } catch (err) {
    els.statusChip.textContent = "接口错误";
    els.hint.textContent = err instanceof Error ? err.message : String(err);
    return false;
  }
}

async function regenerate() {
  els.regenBtn.disabled = true;
  els.statusChip.textContent = "提交生成…";
  try {
    const created = await fetchJson("/api/world/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    els.hint.textContent = `已创建 ${created.worldId}，刷新列表中…`;
    if (!pollTimer) pollTimer = setInterval(poll, 8000);
    await refreshList();
  } catch (err) {
    els.hint.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    els.regenBtn.disabled = false;
  }
}

async function poll() {
  const running = await refreshList();
  if (!running && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

els.refreshBtn.addEventListener("click", () => refreshList());
els.regenBtn.addEventListener("click", regenerate);

refreshList().then((running) => {
  if (running) pollTimer = setInterval(poll, 8000);
});
