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

function showDisconnected() {
  $("msg").textContent = "Start the server first!";
  $("connectBtn").style.display = "block";
  $("status").textContent = "No response from /health.";
  $("connectBtn").disabled = false;
}

async function connectFlow() {
  $("connectBtn").disabled = true;
  $("status").textContent = "Pinging /health…";

  const ok = await pingHealth();
  if (!ok) {
    showDisconnected();
    return;
  }

  $("status").textContent = "Connected ✓";
  await chrome.storage.local.set({ serverConnected: true });

  const tab = await getActiveTab();
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "DEV_PANEL_SHOW" });
    } catch {}
  }

  // Hide popup (close) and show dev panel
  window.close();
}

async function init() {
  $("connectBtn").addEventListener("click", connectFlow);

  // Every popup open: ping /health
  const ok = await pingHealth();
  if (!ok) {
    showDisconnected();
    return;
  }

  // If OK immediately: do not show popup UI — just show dev panel
  await chrome.storage.local.set({ serverConnected: true });

  const tab = await getActiveTab();
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "DEV_PANEL_SHOW" });
    } catch {}
  }

  window.close();
}

init().catch(showDisconnected);
