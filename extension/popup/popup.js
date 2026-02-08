const HEALTH_URL = "http://localhost:3333/health";
const $ = (id) => document.getElementById(id);

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Any response = connected. No response (throw) = disconnected.
async function pingHealth() {
  try {
    const res = await fetch(HEALTH_URL, { method: "GET" });
    return !!res;
  } catch {
    return false;
  }
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "No active tab" };

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, message, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ ok: false, error: err.message });
      resolve(resp || { ok: true });
    });
  });
}

function showDisconnected() {
  $("msg").textContent = "Start the server first!";
  $("status").textContent = "No response from /health.";

  $("openBtn").style.display = "none";
  $("connectBtn").style.display = "block";
  $("connectBtn").disabled = false;
}

function showConnected() {
  $("msg").textContent = "Server is reachable.";
  $("status").textContent = "Connected ✓";

  $("connectBtn").style.display = "none";
  $("openBtn").style.display = "block";
  $("openBtn").disabled = false;
}

async function openPanel(fromContext = false) {
  $("openBtn").disabled = true;
  $("status").textContent = fromContext ? "Opening (context)…" : "Opening…";

  const resp = await sendToActiveTab({
    type: fromContext ? "DEV_PANEL_SHOW_FROM_CONTEXT" : "DEV_PANEL_SHOW"
  });

  if (!resp.ok) {
    console.error("Open failed:", resp.error);
    $("status").textContent = "Connected, but cannot inject on this page.";
    $("openBtn").disabled = false;
    return;
  }

  window.close();
}

async function connectFlow() {
  $("connectBtn").disabled = true;
  $("status").textContent = "Pinging /health…";

  const ok = await pingHealth();
  if (!ok) {
    showDisconnected();
    return;
  }

  await chrome.storage.local.set({ serverConnected: true });
  showConnected();
  await openPanel(false);
}

async function init() {
  $("connectBtn").addEventListener("click", connectFlow);
  $("openBtn").addEventListener("click", () => openPanel(false));

  // Every popup open: ping /health
  const ok = await pingHealth();
  if (!ok) {
    showDisconnected();
    return;
  }

  await chrome.storage.local.set({ serverConnected: true });
  showConnected();

  // NOTE: we do NOT auto-close anymore; user can click Open panel.
}

init().catch(showDisconnected);
