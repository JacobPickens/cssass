chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || typeof msg !== "object") return;

      // =========================
      // STYLE_REQUEST (existing)
      // =========================
      if (msg.type === "STYLE_REQUEST") {
        const res = await fetch("http://localhost:3333/api/style", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(msg.payload)
        });

        const text = await res.text();

        // Try JSON first; fall back to raw text
        let css = "";
        try {
          const data = JSON.parse(text);
          css = data?.css || "";
        } catch {
          css = text || "";
        }

        sendResponse({ ok: res.ok, status: res.status, css, raw: text });
        return;
      }

      // =========================
      // JOB_CANCEL (NEW)
      // =========================
      if (msg.type === "JOB_CANCEL") {
        const res = await fetch("http://localhost:3333/job/cancel", {
          method: "POST"
        });

        const text = await res.text();

        // Optional JSON parse (server may return JSON or plain text)
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }

        if (!res.ok) {
          sendResponse({
            ok: false,
            status: res.status,
            error: data?.error || text || "Cancel failed"
          });
          return;
        }

        sendResponse({ ok: true, status: res.status, result: data || text || "" });
        return;
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true; // keep the message channel open
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "SHOW_PANEL_ACTIVE_TAB") return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, { type: "DEV_PANEL_SHOW" });
  });

  sendResponse({ ok: true });
});

const MENU_ID = "devpanel-edit-styles-ai";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Edit Styles with AI",
    contexts: ["page", "selection", "image", "link", "editable"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab?.id) return;

  // Tell the content script to show the panel
  chrome.tabs.sendMessage(tab.id, { type: "DEV_PANEL_SHOW_FROM_CONTEXT" });
});
