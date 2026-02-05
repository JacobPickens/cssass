chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || msg.type !== "STYLE_REQUEST") return;

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
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true; // keep the message channel open
});