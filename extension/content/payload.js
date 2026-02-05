(function () {
  function safeQuerySelector(sel) {
    try { return document.querySelector(sel); }
    catch { return null; }
  }

  function safeQuerySelectorAll(sel) {
    try { return document.querySelectorAll(sel); }
    catch { return []; }
  }

  function minifyHtml(raw) {
    if (!raw) return "";
    raw = raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    raw = raw.replace(/<!--[\s\S]*?-->/g, "");
    raw = raw.replace(/>\s+</g, "><");
    raw = raw.replace(/\s{2,}/g, " ");
    return raw.trim();
  }

  function minifyCss(raw) {
    if (!raw) return "";
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    raw = raw.replace(/\s{2,}/g, " ");
    raw = raw.replace(/\s*([{}:;,])\s*/g, "$1");
    raw = raw.replace(/;}/g, "}");
    return raw.trim();
  }

  function getComputedStyleSubset(el) {
    const cs = getComputedStyle(el);
    const keys = [
      "display","position","color","background","font","fontSize","fontWeight",
      "padding","margin","border","borderRadius","boxShadow","width","height"
    ];
    const out = {};
    for (const k of keys) out[k] = cs[k];
    return out;
  }

  function collectInlineCss() {
    return Array.from(safeQuerySelectorAll("style"))
      .map(s => s.textContent || "")
      .filter(Boolean)
      .join("\n");
  }

  function collectCssLinks() {
    return Array.from(safeQuerySelectorAll('link[rel="stylesheet"][href]'))
      .map(l => l.href)
      .filter(Boolean);
  }

  function clampText(s, maxChars) {
    if (!s) return "";
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars) + `\n/* …TRUNCATED ${s.length - maxChars} chars… */`;
  }

  function buildDomSnapshot(selection) {
    if (selection?.mode === "element" && selection.selector) {
      const el = safeQuerySelector(selection.selector);
      if (el) {
        const parent = el.parentElement;
        return {
          targetHtml: el.outerHTML,
          contextHtml: parent ? parent.outerHTML : ""
        };
      }
    }
    return {
      targetHtml: document.body ? document.body.outerHTML : document.documentElement.outerHTML,
      contextHtml: ""
    };
  }

  function promptNeedsComputed(prompt) {
    const p = String(prompt || "").toLowerCase();
    return /padding|margin|gap|space|align|center|layout|grid|flex|font|text|size|width|height|color|background|radius|shadow|border/.test(p);
  }

  function maybeComputed(selection, prompt) {
    if (!selection || selection.mode !== "element" || !selection.selector) return null;
    if (!promptNeedsComputed(prompt)) return null;

    const el = safeQuerySelector(selection.selector);
    if (!el) return null;

    return getComputedStyleSubset(el);
  }

  function buildPayload({ prompt, selection }) {
    const DOM_MAX = 250_000;
    const CSS_MAX = 200_000;
    const CTX_MAX = 120_000;

    const domRaw = buildDomSnapshot(selection);
    const htmlMin = minifyHtml(domRaw.targetHtml);
    const ctxMin = minifyHtml(domRaw.contextHtml);

    const cssInlineMin = minifyCss(collectInlineCss());
    const cssLinks = collectCssLinks();

    return {
      url: location.href,
      prompt,
      selection,
      dom: {
        targetHtml: clampText(htmlMin, DOM_MAX),
        contextHtml: clampText(ctxMin, CTX_MAX)
      },
      css: {
        inline: clampText(cssInlineMin, CSS_MAX),
        links: cssLinks
      },
      meta: {
        ts: Date.now(),
        ua: navigator.userAgent
      },
      computed: maybeComputed(selection, prompt)
    };
  }

  // ✅ Make it available to later content scripts
  window.buildPayload = buildPayload;
})();
