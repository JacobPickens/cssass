const PANEL_HOST_ID = "devpanel-root";

let state = {
  visible: false,
  minimized: false,
  picking: false,
  activeTab: "edit",
  selection: { mode: "full", selector: "" },
  drag: { on: false, sx: 0, sy: 0, bx: 20, by: 20, x: 20, y: 20 },
  loading: { on: false, startTs: 0, timer: null }
};

let lastRightClickSelector = "";

/* ---------- mount helpers ---------- */

function ensureHost() {
  let host = document.getElementById(PANEL_HOST_ID);
  if (host) return host;

  host = document.createElement("div");
  host.id = PANEL_HOST_ID;
  host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);
  return host;
}

async function mountPanel() {
  const host = ensureHost();
  const shadow = host.shadowRoot;

  if (shadow.__mounted) return host;

  const cssUrl = chrome.runtime.getURL("panel/panel.css");
  const htmlUrl = chrome.runtime.getURL("panel/panel.html");

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssUrl;

  const htmlText = await fetch(htmlUrl).then(r => r.text());
  const container = document.createElement("div");
  container.innerHTML = htmlText;

  container.querySelectorAll("img[data-src]").forEach((img) => {
    img.src = chrome.runtime.getURL(img.getAttribute("data-src"));
  });

  shadow.append(link, container);

  const wrap = shadow.getElementById("wrap");
  if (wrap) wrap.style.transform = `translate3d(${state.drag.x}px, ${state.drag.y}px, 0)`;

  wire(host);
  shadow.__mounted = true;
  return host;
}

function q(host, sel) {
  return host?.shadowRoot?.querySelector(sel) || null;
}

function setVisible(visible) {
  state.visible = visible;
  mountPanel().then((host) => {
    host.style.display = visible ? "block" : "none";
    if (!visible) stopPicking();
    if (!visible) stopLoading();
    if (!visible) hideTooltip(host);
  });
}

/* ---------- UI state ---------- */

function setMinimized(host, minimized) {
  state.minimized = minimized;
  const panelRoot = q(host, "#panelRoot");
  const minBtn = q(host, "#minimize");
  if (!panelRoot || !minBtn) return;

  panelRoot.classList.toggle("minimized", minimized);
  minBtn.classList.toggle("isInverted", minimized);
}

function setHint(host, text) {
  const hint = q(host, "#hint");
  if (hint) hint.textContent = text;
}

function setActiveTab(host, tabId) {
  state.activeTab = tabId;

  const tabs = host.shadowRoot.querySelectorAll(".tabBtn[data-tab]");
  tabs.forEach((b) => b.classList.toggle("isActive", b.getAttribute("data-tab") === tabId));

  const panes = host.shadowRoot.querySelectorAll(".pane[data-pane]");
  panes.forEach((p) => p.classList.toggle("isActive", p.getAttribute("data-pane") === tabId));
}

function updateSelectionUI(host) {
  const selText = q(host, "#selText");
  const resetBtn = q(host, "#reset");

  const label =
    state.selection.mode === "full"
      ? "full page"
      : (state.selection.selector || "element");

  if (selText) {
    selText.textContent = label;
    selText.setAttribute("data-tip", `Target: ${label}`);
  }

  if (resetBtn) resetBtn.style.display = (state.selection.mode === "full") ? "none" : "inline-block";

  const pickBtn = q(host, "#select");
  const styleBtn = q(host, "#styleBtn");
  if (pickBtn) pickBtn.setAttribute("data-tip", `Pick an element to target (current: ${label})`);
  if (styleBtn) styleBtn.setAttribute("data-tip", `Generate and apply CSS (target: ${label})`);
}

function resetSelection(host) {
  state.selection = { mode: "full", selector: "" };
  updateSelectionUI(host);
}

/* ---------- selector helpers ---------- */

function cssEscape(s) {
  return String(s).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function buildSelector(el) {
  if (!el || el.nodeType !== 1) return "";
  if (el.id) return `#${cssEscape(el.id)}`;

  const parts = [];
  let cur = el;

  for (let i = 0; i < 5 && cur && cur.nodeType === 1; i++) {
    const tag = cur.tagName.toLowerCase();
    const cls = (cur.className && typeof cur.className === "string")
      ? cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      : [];

    let part = tag;
    if (cls.length) part += "." + cls.map(cssEscape).join(".");

    const parent = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }

    parts.unshift(part);
    cur = parent;
    if (part === "body" || part === "html") break;
  }

  return parts.join(" > ");
}

function isInsidePanel(host, eventTarget) {
  const path = typeof eventTarget?.composedPath === "function" ? eventTarget.composedPath() : null;
  return path ? path.includes(host) : host.contains(eventTarget);
}

/* ---------- tooltip (fixed + accurate) ---------- */

function showTooltip(host, anchorEl) {
  const tipNode = q(host, "#tooltip");
  if (!tipNode) return;

  const text = anchorEl.getAttribute("data-tip");
  if (!text) return;

  const r = anchorEl.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.bottom + 10; // centered under element, small gap

  tipNode.textContent = text;
  tipNode.style.left = `${x}px`;
  tipNode.style.top = `${y}px`;
  tipNode.classList.add("on");
}

function hideTooltip(host) {
  const tipNode = q(host, "#tooltip");
  if (!tipNode) return;
  tipNode.classList.remove("on");
}

function enableTooltips(host) {
  const root = q(host, "#panelRoot");
  if (!root) return;

  let currentAnchor = null;

  const getAnchor = (e) => {
    const path = e.composedPath?.() || [];
    for (const n of path) {
      if (n && n.nodeType === 1 && typeof n.getAttribute === "function" && n.getAttribute("data-tip")) return n;
    }
    return null;
  };

  root.addEventListener("mousemove", (e) => {
    const a = getAnchor(e);
    if (a !== currentAnchor) {
      currentAnchor = a;
      if (!a) return hideTooltip(host);
      showTooltip(host, a);
    }
  }, true);

  root.addEventListener("mouseleave", () => {
    currentAnchor = null;
    hideTooltip(host);
  }, true);

  window.addEventListener("scroll", () => {
    if (!currentAnchor) return;
    showTooltip(host, currentAnchor);
  }, true);

  window.addEventListener("resize", () => {
    if (!currentAnchor) return;
    showTooltip(host, currentAnchor);
  }, true);
}

/* ---------- picking + loading ---------- */

function startPicking(host) {
  state.picking = true;
  const clip = q(host, "#panelClip");
  if (clip) clip.classList.add("pickingMode");
  document.documentElement.style.cursor = "crosshair";
  setHint(host, "Click an element on the page to select it…\n(ESC to cancel)");
}

function stopPicking() {
  state.picking = false;
  document.documentElement.style.cursor = "";

  const hostEl = document.getElementById(PANEL_HOST_ID);
  if (!hostEl) return;

  const clip = q(hostEl, "#panelClip");
  if (clip) clip.classList.remove("pickingMode");

  setHint(hostEl, "Tip: Use crosshairs to target an element.");
}

function setPanelCursorDefault(host, on) {
  const root = q(host, "#panelRoot");
  if (!root) return;
  root.classList.toggle("panelCursorDefault", !!on);
}

function startLoading(host) {
  if (state.loading.on) return;
  state.loading.on = true;
  state.loading.startTs = performance.now();

  const clip = q(host, "#panelClip");
  if (clip) clip.classList.add("loadingOn");

  const elapsedEl = q(host, "#elapsed");
  if (elapsedEl) elapsedEl.textContent = "0.0s";

  state.loading.timer = window.setInterval(() => {
    const now = performance.now();
    const sec = Math.max(0, (now - state.loading.startTs) / 1000);
    if (elapsedEl) elapsedEl.textContent = `${sec.toFixed(1)}s`;
  }, 100);
}

function stopLoading() {
  if (!state.loading.on) return;
  state.loading.on = false;

  if (state.loading.timer) {
    window.clearInterval(state.loading.timer);
    state.loading.timer = null;
  }

  const hostEl = document.getElementById(PANEL_HOST_ID);
  if (!hostEl) return;

  const clip = q(hostEl, "#panelClip");
  if (clip) clip.classList.remove("loadingOn");
}

async function cancelJob(host) {
  const cancelBtn = q(host, "#cancelJob");
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    const resp = await chrome.runtime.sendMessage({ type: "JOB_CANCEL" });
    if (!resp?.ok) throw new Error(resp?.error || "Cancel failed");
    setHint(host, "Cancel requested…");
  } catch (e) {
    setHint(host, "Cancel failed.\n" + (e?.message || String(e)));
  } finally {
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

/* ---------- CSS patch ---------- */

const PATCH_STYLE_ID = "devpanel-css-patch";
function applyCssPatch(cssText) {
  let styleEl = document.getElementById(PATCH_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = PATCH_STYLE_ID;
    styleEl.setAttribute("data-origin", "devpanel");
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = String(cssText || "").trim();
}

/* ---------- wiring ---------- */

function wire(host) {
  enableTooltips(host);

  const minBtn = q(host, "#minimize");
  const closeBtn = q(host, "#close");
  const logoSlot = q(host, "#logoSlot");

  const tabBar = q(host, "#tabBar");
  const resetBtn = q(host, "#reset");
  const pickBtn = q(host, "#select");
  const cancelBtn = q(host, "#cancelJob");

  const selText = q(host, "#selText");
  const styleBtn = q(host, "#styleBtn");
  const textArea = q(host, "#prompt");

  const panelRoot = q(host, "#panelRoot");

  // logo returns to Edit tab (clickable requires tooltip — present)
  logoSlot?.addEventListener("click", () => {
    if (state.minimized) setMinimized(host, false);
    setActiveTab(host, "edit");
  });

  // tabs (touching + explorer style) — if minimized, expand
  tabBar?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".tabBtn[data-tab]");
    if (!btn) return;

    if (state.minimized) setMinimized(host, false);

    const tab = btn.getAttribute("data-tab");
    setActiveTab(host, tab);
  });

  // header buttons
  closeBtn?.addEventListener("click", () => setVisible(false));
  minBtn?.addEventListener("click", () => setMinimized(host, !state.minimized));

  // edit actions
  resetBtn?.addEventListener("click", () => resetSelection(host));
  pickBtn?.addEventListener("click", () => (state.picking ? stopPicking() : startPicking(host)));
  cancelBtn?.addEventListener("click", () => cancelJob(host));

  selText?.addEventListener("click", () => {
    const label = (state.selection.mode === "full") ? "full page" : state.selection.selector;
    setHint(host, `Target is ${label || "full page"}.`);
  });

  // Drag panel by non-interactive area
  panelRoot?.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;

    const path = e.composedPath?.() || [];
    const isInteractive = (node) => {
      if (!node || node.nodeType !== 1) return false;
      const tag = node.tagName?.toLowerCase?.() || "";
      if (tag === "button" || tag === "textarea" || tag === "input" || tag === "select" || tag === "label" || tag === "a") return true;
      if (node.isContentEditable) return true;
      if (node.classList?.contains("panel-btn") || node.classList?.contains("dev-btn") || node.classList?.contains("tabBtn")) return true;
      if (node.id === "logoSlot" || node.id === "selText") return true;
      return false;
    };
    if (path.some(isInteractive)) return;

    state.drag.on = true;
    state.drag.sx = e.clientX;
    state.drag.sy = e.clientY;
    state.drag.bx = state.drag.x;
    state.drag.by = state.drag.y;

    const hdrEl = q(host, "#hdr");
    if (hdrEl) hdrEl.style.cursor = "grabbing";

    const onMove = (ev) => {
      if (!state.drag.on) return;
      state.drag.x = state.drag.bx + (ev.clientX - state.drag.sx);
      state.drag.y = state.drag.by + (ev.clientY - state.drag.sy);
      const wrap = q(host, "#wrap");
      if (wrap) wrap.style.transform = `translate3d(${state.drag.x}px, ${state.drag.y}px, 0)`;
    };

    const onUp = () => {
      state.drag.on = false;
      if (hdrEl) hdrEl.style.cursor = "grab";
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      chrome.storage.local.set({ devPanelPos: { x: state.drag.x, y: state.drag.y } });
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);

    e.preventDefault();
    e.stopPropagation();
  }, true);

  // During picking: keep normal cursor over panel controls
  panelRoot?.addEventListener("mouseenter", () => {
    if (!state.picking) return;
    setPanelCursorDefault(host, true);
    document.documentElement.style.cursor = "";
  }, true);

  panelRoot?.addEventListener("mouseleave", () => {
    if (!state.picking) return;
    setPanelCursorDefault(host, false);
    document.documentElement.style.cursor = "crosshair";
  }, true);

  // Style button
  styleBtn?.addEventListener("click", async () => {
    const prompt = String(textArea?.value || "").trim();
    if (!prompt) return;

    textArea.disabled = true;
    styleBtn.disabled = true;
    startLoading(host);

    try {
      const payload = await window.buildPayload({ prompt, selection: state.selection });
      const reply = await chrome.runtime.sendMessage({ type: "STYLE_REQUEST", payload });

      if (!reply?.ok) throw new Error(reply?.error || `Server error (${reply?.status || "?"})`);

      const cssPatch = String(reply.css || "");
      if (cssPatch.trim()) applyCssPatch(cssPatch);

      setHint(host, "Applied ✓");
    } catch (e) {
      setHint(host, "No response (server?).\n" + (e?.message || String(e)));
    } finally {
      stopLoading();
      textArea.disabled = false;
      styleBtn.disabled = false;
    }
  });

  // Picker click capture
  document.addEventListener("click", (e) => {
    if (!state.visible) return;
    if (!state.picking) return;
    if (isInsidePanel(host, e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    const sel = buildSelector(e.target);
    state.selection = sel ? { mode: "element", selector: sel } : { mode: "full", selector: "" };
    updateSelectionUI(host);
    stopPicking();
  }, true);

  // ESC cancels picking
  document.addEventListener("keydown", (e) => {
    if (!state.visible) return;
    if (e.key !== "Escape") return;
    if (!state.picking) return;
    stopPicking();
  }, true);

  // Track right-click selector so context menu can select it
  document.addEventListener("contextmenu", (e) => {
    if (!e?.target) return;
    if (isInsidePanel(host, e.target)) return;
    lastRightClickSelector = buildSelector(e.target);
  }, true);

  // init
  setActiveTab(host, state.activeTab);
  updateSelectionUI(host);
}

/* ---------- messages ---------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "DEV_PANEL_SHOW") {
    setVisible(true);
    mountPanel().then((host) => setActiveTab(host, "edit"));
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === "DEV_PANEL_HIDE") {
    setVisible(false);
    sendResponse?.({ ok: true });
    return;
  }

  if (msg.type === "DEV_PANEL_TOGGLE") {
    setVisible(!state.visible);
    sendResponse?.({ ok: true, visible: state.visible });
    return;
  }

  if (msg.type === "DEV_PANEL_SHOW_FROM_CONTEXT") {
    setVisible(true);

    mountPanel().then((host) => {
      if (state.minimized) setMinimized(host, false);
      setActiveTab(host, "edit");

      state.selection = lastRightClickSelector
        ? { mode: "element", selector: lastRightClickSelector }
        : { mode: "full", selector: "" };

      updateSelectionUI(host);
      setHint(host, lastRightClickSelector ? "Target selected from context menu." : "No target found; using full page.");
    });

    sendResponse?.({ ok: true });
    return;
  }
});

/* ---------- boot ---------- */

async function restorePos() {
  const { devPanelPos } = await chrome.storage.local.get(["devPanelPos"]);
  if (devPanelPos && typeof devPanelPos.x === "number" && typeof devPanelPos.y === "number") {
    state.drag.x = devPanelPos.x;
    state.drag.y = devPanelPos.y;
  }
}

(async function boot() {
  await restorePos();
  await mountPanel();
  setVisible(false); // only show when explicitly enabled
})();
