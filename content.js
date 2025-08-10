// ChatGPT DOM Trimmer – Rev 5.1 (defensive UI binding + selector audit)
// Robust to missing buttons/IDs in panel.html, reports missing controls instead of crashing.

const DEFAULT_MAX_TURNS = 50;
const MAX_THIN_CAP = 200;
const ATTR_THIN = "data-cgt-thin";
const ATTR_SCRUBBED = "data-cgt-scrubbed";
const ATTR_ULTRA = "data-cgt-ultra";

let maxTurns = DEFAULT_MAX_TURNS;
let totalThinned = 0;
let lastTrimTs = 0;
let paused = false;
let trimTimer = null;
let ui = null;

const GC_CLASS = "cgt-gc";
const GC_STYLE_ID = "cgt-gc-style";
const KILL_LAYERS_STYLE_ID = "cgt-kill-layers";

// ---------------- Selector Registry (audited) ----------------
const SELECTORS = {
  thread: ["#thread", "main"],
  composer: ["#composer", 'form[aria-label="Send message"]', "form"],
  articles: [
    '[data-testid^="conversation-turn"]',
    "article[data-turn]",
    'article[data-testid*="conversation-turn"]',
  ],
  wrappers: [
    ".composer-parent.flex.h-full.flex-col",
    ".relative.flex.basis-auto.flex-col",
    ".flex.h-full.flex-col.overflow-y-auto",
    ".@thread-xl\\/thread\\:pt-header-height",
    '[class*="overflow-"]',
    '[class*="contain-inline-size"]',
  ],
  markdown: [".markdown", "div.markdown", ".markdown-new-styling"],
};

function resolveSelectors(registry) {
  const found = {};
  const missing = [];
  for (const [key, list] of Object.entries(registry)) {
    let nodes = null;
    for (const sel of list) {
      try {
        const n = document.querySelectorAll(sel);
        if (n && n.length) {
          nodes = n;
          if (!found[key]) found[key] = { selector: sel, count: n.length };
          break;
        }
      } catch {}
    }
    if (!nodes || !nodes.length) {
      missing.push(key);
      found[key] = { selector: null, count: 0 };
    }
  }
  return { found, missing };
}

// ---------------- Boot ----------------
chrome.storage.sync.get({ maxTurns: DEFAULT_MAX_TURNS }, (res) => {
  maxTurns = clampInt(res.maxTurns, 5, 5000);
  setup();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.maxTurns) {
    maxTurns = clampInt(changes.maxTurns.newValue, 5, 5000);
    scheduleTrim(0);
    updateStatsUI();
  }
});

chrome.runtime.onMessage.addListener((m) => {
  if (m && m.type === "cgt:toggle") {
    if (!document.getElementById("cgt-trimmer-host")) injectUI();
    toggleModal();
  }
});

function setup() {
  injectUI();

  setInterval(() => scheduleTrim(0), 5000);
  const obs = new MutationObserver(() => scheduleTrim(250));
  obs.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(updateStatsUI, 1000);
  scheduleTrim(0);
}

function clampInt(v, min, max) {
  v = parseInt(v, 10);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function getTurns() {
  const tries = SELECTORS.articles || [];
  for (const sel of tries) {
    try {
      const list = Array.from(document.querySelectorAll(sel));
      if (list.length) return list;
    } catch {}
  }
  return [];
}

function trimNow() {
  if (paused) return;
  const turns = getTurns();
  if (!turns.length) return;

  const fullStart = Math.max(0, turns.length - maxTurns);
  const fullSlice = turns.slice(fullStart);
  const thinSlice = turns.slice(0, fullStart);

  for (const el of fullSlice) {
    if (el.style.display === "none") el.style.display = "";
  }
  for (const el of thinSlice) {
    if (!el.hasAttribute(ATTR_SCRUBBED)) {
      deepScrub(el);
      el.setAttribute(ATTR_SCRUBBED, "1");
    }
    if (!el.hasAttribute(ATTR_THIN)) {
      el.setAttribute(ATTR_THIN, "1");
      el.style.display = "none";
      totalThinned++;
    }
  }

  if (thinSlice.length > MAX_THIN_CAP) {
    const toUltra = thinSlice.length - MAX_THIN_CAP;
    for (let i = 0; i < toUltra; i++) ultraThin(thinSlice[i]);
  }
}

function scheduleTrim(delayMs) {
  const now = performance.now();
  if (delayMs === 0 && now - lastTrimTs < 200) return;
  if (trimTimer) clearTimeout(trimTimer);
  trimTimer = setTimeout(() => {
    lastTrimTs = performance.now();
    if ("requestIdleCallback" in window) {
      requestIdleCallback(
        () => {
          trimNow();
          updateStatsUI();
        },
        { timeout: 500 }
      );
    } else {
      trimNow();
      updateStatsUI();
    }
  }, delayMs);
}

// ---------------- Scrubbing (non-destructive) ----------------
function deepScrub(article) {
  article.querySelectorAll("img").forEach((img) => {
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
  });
  article.querySelectorAll("video").forEach((v) => {
    try {
      v.pause();
    } catch {}
    v.removeAttribute("autoplay");
    v.preload = "none";
  });
}
function ultraThin(article) {
  if (article.getAttribute(ATTR_ULTRA) === "1") return;
  article.setAttribute(ATTR_ULTRA, "1");
  article.style.display = "none";
}

// ---------------- GC helpers ----------------
function ensureGcStyle() {
  if (document.getElementById(GC_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = GC_STYLE_ID;
  style.textContent = `
    .${GC_CLASS} {
      content-visibility: auto !important;
      contain: content !important;
      contain-intrinsic-size: 1000px 1px !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function applyKillLayersCSS() {
  if (document.getElementById(KILL_LAYERS_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = KILL_LAYERS_STYLE_ID;
  s.textContent = `
    *,*::before,*::after{
      animation:none!important;
      transition:none!important;
      will-change:auto!important;
      filter:none!important;
      backdrop-filter:none!important;
      transform:none!important;
    }
  `;
  document.documentElement.appendChild(s);
}

function loseWebGLContexts() {
  let killed = 0;
  document.querySelectorAll("canvas").forEach((c) => {
    for (const kind of ["webgl2", "webgl", "experimental-webgl"]) {
      try {
        const gl = c.getContext(kind, {
          preserveDrawingBuffer: false,
          powerPreference: "low-power",
        });
        if (gl) {
          const ext = gl.getExtension("WEBGL_lose_context");
          if (ext) ext.loseContext();
          killed++;
          break;
        }
      } catch {}
    }
  });
  return killed;
}

function hasReactRefs(el) {
  try {
    return Object.keys(el).some(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$")
    );
  } catch {
    return false;
  }
}
function isHidden(el) {
  const cs = getComputedStyle(el);
  return (
    cs.display === "none" ||
    cs.contentVisibility === "hidden" ||
    cs.visibility === "hidden"
  );
}
function isOffscreen(el, margin = 300) {
  const r = el.getBoundingClientRect();
  return (
    r.bottom < -margin ||
    r.top > innerHeight + margin ||
    r.right < -margin ||
    r.left > innerWidth + margin
  );
}
function fiberectomyOldTurns(opts = {}) {
  const keepLastN = Number.isInteger(opts.keepLastN) ? opts.keepLastN : 2;
  const consider = opts.consider || "both"; // 'hidden' | 'offscreen' | 'both'
  const margin = opts.margin ?? 300;

  // use same article resolver as trim
  const turns = getTurns();
  if (!turns.length)
    return { candidates: 0, replaced: 0, clonesWithReactRefs: 0 };

  const old = turns.slice(0, -keepLastN);

  const shouldTouch = (el) => {
    const hidden = isHidden(el);
    const off = isOffscreen(el, margin);
    if (consider === "hidden") return hidden;
    if (consider === "offscreen") return off;
    return hidden || off; // both
  };

  const targets = old.filter((el) => shouldTouch(el) && hasReactRefs(el));

  let replaced = 0,
    stillReact = 0;
  for (const el of targets) {
    try {
      const clone = el.cloneNode(true);
      clone.setAttribute("inert", "");
      // preserve hidden state if it was hidden
      if (isHidden(el))
        clone.style.display =
          getComputedStyle(el).display === "none"
            ? "none"
            : clone.style.display;
      el.replaceWith(clone);
      replaced++;
      if (hasReactRefs(clone)) stillReact++;
    } catch {}
  }
  return {
    candidates: targets.length,
    replaced,
    clonesWithReactRefs: stillReact,
  };
}

function attachIOContentVisibility() {
  if (window.__cgt_io) return;

  const ioClass = GC_CLASS;
  const opts = { root: null, rootMargin: "300px", threshold: 0 };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      e.target.classList.toggle(ioClass, !e.isIntersecting);
    }
  }, opts);

  const reg = resolveSelectors(SELECTORS);
  const observed = [];

  const addAll = (sel) => {
    if (!sel) return;
    document.querySelectorAll(sel).forEach((n) => {
      io.observe(n);
      observed.push(n);
    });
  };

  addAll(reg.found.thread?.selector);
  addAll(reg.found.articles?.selector);
  addAll(reg.found.wrappers?.selector);
  addAll(reg.found.markdown?.selector);

  window.__cgt_io = { io, observed };
}

// ---------------- GC (composed) ----------------
async function runGarbageCollect(statusEl) {
  const t0 = performance.now();
  const progress = [];
  const say = (gcLine) => {
    progress.push(gcLine);
    console.log("[CGT GC]", gcLine);
    updateStatus(gcLine, statusEl);
  };
  const cap = (p, ms, label) =>
    Promise.race([
      p,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`timeout ${ms}ms @ ${label}`)), ms)
      ),
    ]);

  const audit = resolveSelectors(SELECTORS);
  say(
    `Running GC… (missing selectors: ${
      audit.missing.length ? audit.missing.join(", ") : "none"
    })`
  );

  // 1) IO + styles
  try {
    ensureGcStyle();
    attachIOContentVisibility();
    say("Step 1/7: IO content-visibility attached");
  } catch (e) {
    console.warn("[CGT GC] Step1 failed:", e);
    say("Step 1/7: IO failed (continuing)");
  }

  // 2) Pause media
  try {
    document.querySelectorAll("video").forEach((v) => {
      try {
        v.pause();
      } catch {}
      v.removeAttribute("autoplay");
      v.preload = "none";
    });
    say("Step 2/7: media paused");
  } catch (e) {
    console.warn("[CGT GC] Step2 failed:", e);
    say("Step 2/7: media pause failed (continuing)");
  }

  // 3) Kill layers
  let webglKilled = 0;
  try {
    applyKillLayersCSS();
    say("Step 3/7: layer/animation killers applied");
  } catch (e) {
    console.warn("[CGT GC] Step3 failed:", e);
    say("Step 3/7: layer killers failed (continuing)");
  }

  // 4) Drop WebGL
  try {
    webglKilled = loseWebGLContexts();
    say(`Step 4/7: WebGL contexts lost: ${webglKilled}`);
  } catch (e) {
    console.warn("[CGT GC] Step4 failed:", e);
    say("Step 4/7: WebGL loss failed (continuing)");
  }

  // 5) Caches/perf (timeboxed)
  try {
    performance.clearResourceTimings?.();
    performance.clearMarks?.();
    performance.clearMeasures?.();
    if ("caches" in window && caches.keys) {
      const keys = await cap(caches.keys(), 400, "caches.keys");
      await cap(
        Promise.all(keys.map((k) => caches.delete(k))),
        600,
        "caches.delete"
      );
    }
    say("Step 5/7: caches cleared");
  } catch (e) {
    console.warn("[CGT GC] Step5 soft-fail:", e.message || e);
    say("Step 5/7: caches clear skipped/timeout (continuing)");
  }

  // 6) Fiberectomy (hidden or offscreen)
  let fiberRes = { candidates: 0, replaced: 0, clonesWithReactRefs: 0 };
  try {
    fiberRes = fiberectomyOldTurns?.({
      keepLastN: 2,
      consider: "both",
      margin: 300,
    }) ||
      fiberectomyHiddenOldTurns?.(2) || {
        candidates: 0,
        replaced: 0,
        clonesWithReactRefs: 0,
      };
    say(
      `Step 6/7: fiber cleanup — candidates:${fiberRes.candidates} replaced:${fiberRes.replaced}`
    );
  } catch (e) {
    console.warn("[CGT GC] Step6 failed:", e);
    say("Step 6/7: fiber cleanup failed (continuing)");
  }

  // 7) Settle
  try {
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
    say("Step 7/7: layout settled");
  } catch (e) {
    console.warn("[CGT GC] Step7 failed:", e);
  }

  const dt = ((performance.now() - t0) / 1000).toFixed(2);
  const finalLine = `GC done in ${dt}s | WebGL lost: ${webglKilled} | Fiber: ${fiberRes.candidates}/${fiberRes.replaced}`;
  say(finalLine);
  window.__cgt_gcProgress = progress;
  return { webglKilled, fiberRes, timeSec: Number(dt) };
}

function undoGarbageCollect(statusEl) {
  const style = document.getElementById(GC_STYLE_ID);
  if (style) style.remove();
  const kill = document.getElementById(KILL_LAYERS_STYLE_ID);
  if (kill) kill.remove();
  document
    .querySelectorAll("." + GC_CLASS)
    .forEach((el) => el.classList.remove(GC_CLASS));

  if (window.__cgt_io) {
    try {
      window.__cgt_io.io.disconnect();
    } catch {}
    window.__cgt_io = null;
  }

  updateStatus(
    `GC visual hints removed. (Fiber replacements remain until reload)`,
    statusEl
  );
}

// ---------------- UI (Shadow DOM, uses panel.html) ----------------
async function injectUI() {
  if (document.getElementById("cgt-trimmer-host")) return;

  const host = document.createElement("div");
  host.id = "cgt-trimmer-host";
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "2147483647",
    bottom: "16px",
    right: "16px",
    width: "0",
    height: "0",
  });
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // Load panel.html safely
  let html = "";
  try {
    const url = chrome.runtime.getURL("panel.html");
    html = await (await fetch(url)).text();
  } catch (e) {
    console.error("Failed to load panel.html", e);
    return; // bail early; nothing to bind
  }
  shadow.innerHTML = html;

  // Helpers: safe select + safe bind
  const missingUI = [];
  const $ = (sel) => {
    const el = shadow.querySelector(sel);
    if (!el) missingUI.push(sel);
    return el;
  };
  const on = (el, evt, fn) => {
    if (el && el.addEventListener)
      el.addEventListener(evt, fn, { passive: true });
  };

  // Elements (may be null; that’s fine)
  const fab = $(".fab");
  const modal = $(".modal");
  const backdrop = $(".backdrop");
  const input = $("#max");
  const saveBtn = $("#save");
  const resetBtn = $("#reset");
  const loadedEl = $("#loaded");
  const fullEl = $("#full");
  const thinEl = $("#thin");
  const thinnedEl = $("#thinned");
  const pauseToggle = $("#pauseToggle");
  const pauseSwitch = $("#pauseSwitch");
  const gcBtn = $("#gc"); // may be missing
  const undoBtn = $("#undoGc"); // may be missing
  const gcStatus = $("#gcStatus");

  const updatePauseUI = () => {
    if (pauseSwitch) pauseSwitch.classList.toggle("on", paused);
  };

  const openModal = () => {
    if (input) input.value = maxTurns;
    if (modal) modal.style.display = "block";
    if (backdrop) backdrop.style.display = "block";
    updatePauseUI();
    updateStatsUI();

    // Show selector audit + missing UI controls
    const audit = resolveSelectors(SELECTORS);
    if (gcStatus) {
      const missingSelectors = audit.missing.length
        ? `Missing selectors: ${audit.missing.join(", ")}`
        : "All selectors matched.";
      const missingControls = missingUI.length
        ? ` | Missing UI controls: ${missingUI.join(", ")}`
        : "";
      gcStatus.textContent = missingSelectors + missingControls;
    }
  };
  const closeModal = () => {
    if (modal) modal.style.display = "none";
    if (backdrop) backdrop.style.display = "none";
  };

  on(fab, "click", openModal);
  on(backdrop, "click", closeModal);

  on(saveBtn, "click", () => {
    const val = input ? input.value : DEFAULT_MAX_TURNS;
    const v = clampInt(val, 5, 5000);
    chrome.storage.sync.set({ maxTurns: v }, () => {
      maxTurns = v;
      scheduleTrim(0);
      updateStatsUI();
      if (saveBtn) {
        saveBtn.textContent = "Saved";
        setTimeout(() => (saveBtn.textContent = "Save"), 900);
      }
    });
  });

  on(resetBtn, "click", () => {
    totalThinned = 0;
    updateStatsUI();
  });

  on(pauseToggle, "click", () => {
    paused = !paused;
    updatePauseUI();
    if (!paused) scheduleTrim(0);
  });

  // IMPORTANT: don’t touch gcBtn directly; use the event target
  on(gcBtn, "click", async (e) => {
    const btn = e.currentTarget;
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Running…";
    try {
      await runGarbageCollect(gcStatus);
    } catch (err) {
      console.error("[CGT GC] unhandled error:", err);
      updateStatus("GC crashed — see console", gcStatus);
    } finally {
      btn.textContent = "Garbage Collect";
      btn.disabled = false;
    }
  });
  on(undoBtn, "click", () => {
    undoGarbageCollect(gcStatus);
  });

  ui = {
    loadedEl,
    fullEl,
    thinEl,
    thinnedEl,
    gcStatus,
    modal,
    backdrop,
    input,
  };
}

function toggleModal() {
  const host = document.getElementById("cgt-trimmer-host");
  const sr = host?.shadowRoot;
  const modal = sr?.querySelector(".modal");
  const backdrop = sr?.querySelector(".backdrop");
  const input = sr?.querySelector("#max");
  if (!modal || !backdrop) return;
  if (modal.style.display === "block") {
    modal.style.display = "none";
    backdrop.style.display = "none";
  } else {
    if (input) input.value = maxTurns;
    modal.style.display = "block";
    backdrop.style.display = "block";
    updateStatsUI();
    const gcStatus = sr?.querySelector("#gcStatus");
    const audit = resolveSelectors(SELECTORS);
    if (gcStatus)
      gcStatus.textContent = audit.missing.length
        ? `Missing selectors: ${audit.missing.join(", ")}`
        : "All selectors matched.";
  }
}

function currentCounts() {
  const turns = getTurns();
  const loaded = turns.length;
  const full = Math.min(loaded, maxTurns);
  const thin = Math.max(0, loaded - full);
  return { loaded, full, thin, thinned: totalThinned, target: maxTurns };
}

function updateStatsUI() {
  if (!ui) return;
  const { loaded, full, thin, thinned } = currentCounts();
  if (ui.loadedEl) ui.loadedEl.textContent = String(loaded);
  if (ui.fullEl) ui.fullEl.textContent = String(full);
  if (ui.thinEl) ui.thinEl.textContent = String(thin);
  if (ui.thinnedEl) ui.thinnedEl.textContent = String(thinned);
}

function updateStatus(msg, node) {
  if (node) node.textContent = msg;
}
