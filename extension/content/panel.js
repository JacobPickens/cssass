const PANEL_HOST_ID = "devpanel-root";
const STORAGE_KEY = "serverConnected";

const SERVER_BASE = "http://localhost:3333";
const PROMPT_URL = `${SERVER_BASE}/api/style`;

let state = {
  visible: false,
  minimized: false,
  picking: false,
  waiting: false,
  selection: { mode: "full", selector: "" },
  drag: { on: false, sx: 0, sy: 0, bx: 20, by: 20, x: 20, y: 20 }
};

function ensureHost() {
  let host = document.getElementById(PANEL_HOST_ID);
  if (host) return host;

  host = document.createElement("div");
  host.id = PANEL_HOST_ID;

  const shadow = host.attachShadow({ mode: "open" });
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
    const p = img.getAttribute("data-src");
    img.src = chrome.runtime.getURL(p);
  });
  shadow.append(link, container);

  // initial transform
  const wrap = shadow.getElementById("wrap");
  if (wrap) wrap.style.transform = `translate3d(${state.drag.x}px, ${state.drag.y}px, 0)`;

  wire(host);
  shadow.__mounted = true;
  return host;
}

function q(host, sel) {
  return host?.shadowRoot?.querySelector(sel) || null;
}

function qall(host, sel) {
  return host?.shadowRoot?.querySelectorAll(sel) || null;
}


function setVisible(visible) {
  state.visible = visible;
  mountPanel().then((host) => {
    host.style.display = visible ? "block" : "none";
    if (!visible) stopPicking();
  });
}

function updateSelectionUI(host) {
  const selText = q(host, "#selText");
  const resetBtn = q(host, "#reset");

  if (!selText || !resetBtn) return;

  if (state.selection.mode === "full") {
    selText.textContent = "Selected: full page";
    resetBtn.style.display = "none";
  } else {
    selText.textContent = `Selected: ${state.selection.selector}`;
    resetBtn.style.display = "grid";
  }
}

function setMinimized(host, minimized) {
  state.minimized = minimized;

  const panelRoot = q(host, "#panelRoot");
  const minBtn = q(host, "#minimize");
  if (!panelRoot || !minBtn) return;

  panelRoot.classList.toggle("minimized", minimized);

  // swap icon image
  const icon = minimized ? "img/maximize.svg" : "img/minimize.svg";
  minBtn.src = chrome.runtime.getURL(icon);
}

function startPicking(host) {
  state.picking = true;
  document.documentElement.style.cursor = "pointer";
  const hint = q(host, "#hint");
  const panelRoot = q(host, "#panelRoot");
  if (hint) hint.textContent = "Click an element on the page to select it…";
  if (panelRoot) panelRoot.classList.add("pickingOn");
}

function stopPicking() {
  state.picking = false;
  document.documentElement.style.cursor = "";
  const host = document.getElementById(PANEL_HOST_ID);
  if (!host) return;
  const hint = q(host, "#hint");
  const panelRoot = q(host, "#panelRoot");
  if (hint) hint.textContent = "Tip: Use crosshairs to target an element.";
  if (panelRoot) panelRoot.classList.remove("pickingOn");
}

function resetSelection(host) {
  state.selection = { mode: "full", selector: "" };
  updateSelectionUI(host);
}

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

function wire(host) {
  const hdr = q(host, "#hdr");
  const pickBtn = q(host, "#select");
  const resetBtn = q(host, "#reset");
  const minBtn = q(host, "#minimize");
  const closeBtn = q(host, "#close");
  const styleBtn = q(host, "#styleBtn");
  const textArea = q(host, "#prompt");

  // (optional) close button hides panel + clears connected state
  closeBtn?.addEventListener("click", () => {
    chrome.storage.local.set({ [STORAGE_KEY]: false }).then(() => setVisible(false));
  });

  updateSelectionUI(host);

  // Drag by header
  // Drag by clicking anywhere in the panel (except interactive controls)
  const panelRoot = q(host, "#panelRoot");

  panelRoot?.addEventListener("mousedown", (e) => {
    // Ignore right/middle click
    if (e.button !== 0) return;

    // If the down event started on an interactive element, do not drag.
    const path = e.composedPath?.() || [];
    const isInteractive = (node) => {
      if (!node || node.nodeType !== 1) return false;
      const tag = node.tagName?.toLowerCase?.() || "";
      if (tag === "button" || tag === "textarea" || tag === "input" || tag === "select" || tag === "label" || tag === "a") return true;
      if (node.isContentEditable) return true;

      // Also treat anything explicitly marked as no-drag as interactive
      if (typeof node.getAttribute === "function" && node.getAttribute("data-nodrag") === "1") return true;

      return false;
    };

    if (path.some(isInteractive)) return;

    state.drag.on = true;
    state.drag.sx = e.clientX;
    state.drag.sy = e.clientY;
    state.drag.bx = state.drag.x;
    state.drag.by = state.drag.y;

    // Optional: show grabbing cursor while dragging
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

  pickBtn?.addEventListener("click", () => {
    if (!state.picking) startPicking(host);
    else stopPicking();
  });

  resetBtn?.addEventListener("click", () => resetSelection(host));

  minBtn?.addEventListener("click", () => setMinimized(host, !state.minimized));

  styleBtn?.addEventListener("click", async () => {
    const prompt = await String(textArea?.value || "").trim();
    if (!prompt) return;

    // disable UI while waiting
    state.waiting = true;
    textArea.disabled = true;
    styleBtn.disabled = true;

    try {
      const payload = await window.buildPayload({
        prompt,
        selection: state.selection
      });

      const reply = await chrome.runtime.sendMessage({
        type: "STYLE_REQUEST",
        payload
      });

      if (!reply?.ok) {
        throw new Error(reply?.error || `Server error (${reply?.status || "?"})`);
      }

      const cssPatch = String(reply.css || "");
      if (cssPatch.trim()) applyCssPatch(cssPatch);

      const hint = q(host, "#hint");
      if (hint) hint.textContent = "Applied ✓";
    } catch (e) {
      // optional: show status somewhere
      const hint = q(host, "#hint");
      console.error("PROMPT ERROR:", e.message);
      if (hint) hint.textContent = "No response (server?).\n"+e.message;
    } finally {
      state.waiting = false;
      textArea.disabled = false;
      styleBtn.disabled = false;
    }
  });

  // Picker click capture: next click selects element
  document.addEventListener("click", (e) => {
    if (!state.visible) return;
    if (!state.picking) return;
    if (isInsidePanel(host, e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    const sel = buildSelector(el);
    state.selection = sel ? { mode: "element", selector: sel } : { mode: "full", selector: "" };

    updateSelectionUI(host);
    stopPicking();
  }, true);
}

// Messages from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "DEV_PANEL_SHOW") {
    chrome.storage.local.set({ [STORAGE_KEY]: true }).then(() => {
      setVisible(true);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "DEV_PANEL_HIDE") {
    chrome.storage.local.set({ [STORAGE_KEY]: false }).then(() => {
      setVisible(false);
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function restorePos() {
  const { devPanelPos } = await chrome.storage.local.get(["devPanelPos"]);
  if (devPanelPos && typeof devPanelPos.x === "number" && typeof devPanelPos.y === "number") {
    state.drag.x = devPanelPos.x;
    state.drag.y = devPanelPos.y;
  }
}

const PATCH_STYLE_ID = "devpanel-css-patch";

function applyCssPatch(cssText) {
  const doc = document;
  let styleEl = doc.getElementById(PATCH_STYLE_ID);

  if (!styleEl) {
    styleEl = doc.createElement("style");
    styleEl.id = PATCH_STYLE_ID;
    styleEl.setAttribute("data-origin", "devpanel");
    doc.head.appendChild(styleEl);
  }

  styleEl.textContent = String(cssText || "").trim();
}

// Boot: show panel if already connected
(async function boot() {
  await restorePos();
  await mountPanel();
  const { [STORAGE_KEY]: connected } = await chrome.storage.local.get([STORAGE_KEY]);
  setVisible(!!connected);
})();
