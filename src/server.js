const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();
const port = 3333;

const sendPrompt = require("./scrape");

const snapshotDir = path.join(__dirname, "..", 'snapshots');

try {
  fs.mkdirSync(snapshotDir, { recursive: true });
} catch (error) {
  if (error.code !== 'EEXIST') {
      console.error(`Error creating snapshot directory: ${error.message}`);
  }
}

var requestIndex = 0;

// Allow extension/page to POST to localhost (CORS + preflight)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // If you later add auth headers, include them above too.

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ✅ REQUIRED: parse JSON bodies
app.use(express.json({ limit: "5mb" }));

app.post("/api/style", async (req, res) => {
  try {
    const { url, prompt, selection, dom, css } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const snapshotPath = buildSnapshotBlock({ url, selection, dom, css });

    if(!snapshotPath) {
      return res.status(400).json({ error: "Failed to save snapshot" });
    }

    const systemPrompt = `
You are a CSS generator.\n\n

Output ONLY valid CSS in codeblocks. No explanations. No markdown. No <style> tags.\n
The uploaded file is the source file. Use the code and any available links for reference.\n\n

Rules:\n
- Prefer minimal patches.\n
- Do not invent selectors not present in the snapshot.\n
- If MODE is element and SELECTOR is provided, every rule MUST be scoped under that selector.
`.trim();

    const userPrompt = `
=== INSTRUCTION ===\n
${prompt}\n\n

=== CONTRACT ===\n
${systemPrompt}
`.trim();

    const cssPatch = await withTimeout(
      sendPrompt(`${systemPrompt}\n\n${userPrompt}`, snapshotPath),
      120_000,
      "GPT request"
    );

    console.log(cssPatch);
    res.json({ css: cssPatch[1] || "" });

  } catch (e) {
    console.error("PROMPT ERROR:", e.message);

    if (String(e.message).includes("timed out")) {
      return res.status(504).json({ error: "Model timeout (2 minutes)" });
    }

    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

function buildSnapshotBlock({ url, selection, dom, css }) {
  const selector = selection?.selector || "";
  const mode = selection?.mode || "full";

  let fileString = [
    "=== WEBSITE REFERENCE ===",
    `URL: ${url || ""}`,
    `MODE: ${mode}`,
    `SELECTOR: ${selector || "(full page)"}`,
    "",
    "=== HTML (target) ===",
    dom?.targetHtml || "",
    "",
    "=== HTML (context) ===",
    dom?.contextHtml || "",
    "",
    "=== CSS (inline) ===",
    css?.inline || "",
    "",
    "=== CSS (links) ===",
    (css?.links || []).join("\n"),
    "=== END SNAPSHOT ==="
  ].join("\n");

  try {
    let filePath = path.join(snapshotDir, `request-${requestIndex++}.txt`);
    fs.writeFileSync(filePath, fileString);
    return filePath;
  } catch (e) {
    console.log(e);
    return false;
  }
}

function withTimeout(promise, ms, label = "Operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}