//const puppeteer = require("puppeteer-extra");
//const StealthPlugin = require("puppeteer-extra-plugin-stealth");
//const createStealthContext = require("jfins-stealth-context");
const { connect } = require("puppeteer-real-browser");
const fs = require("fs");
const path = require("path");

//puppeteer.use(StealthPlugin());

const GPT_URL = "https://chat.openai.com/?temporary-chat=true";
const GPT_ORIGIN = "https://chat.openai.com";

const PROFILE_DIR = path.resolve(__dirname, ".puppeteer-profile");
fs.mkdirSync(PROFILE_DIR, { recursive: true });

let browserPromise = null;
getBrowser();

/**
 * Launches (once) and returns the shared Puppeteer browser.
 * Auto-resets if the browser crashes.
 */
async function getBrowser() {
    if (!browserPromise) {
        const { browser, page } = await connect({
            headless: false,

            args: [],

            customConfig: { userDataDir: PROFILE_DIR },

            turnstile: true,

            connectOption: {},

            disableXvfb: false,
            ignoreAllFlags: false,
            // proxy:{
            //     host:'<proxy-host>',
            //     port:'<proxy-port>',
            //     username:'<proxy-username>',
            //     password:'<proxy-password>'
            // }
        });
        browserPromise = browser;
    }

    return browserPromise;
}

const BLOCKED_RESOURCE_TYPES = new Set([
    "image",
    "media",
    "font"
]);

const BLOCKED_URL_PATTERNS = [
    "doubleclick",
    "googlesyndication",
    "google-analytics",
    "analytics",
    "facebook.com/tr",
    "hotjar",
    "clarity.ms"
];

/**
 * Creates a hardened Puppeteer page with sane defaults
 */
async function newPage() {
    const browser = await getBrowser();
    const page = await browser.newPage();

    //await createStealthContext(page, "US");

    const context = await browser.defaultBrowserContext();
    await context.overridePermissions(GPT_ORIGIN, [
        "clipboard-read",
        "clipboard-write"
    ]);

    // Faster + safer defaults
    await page.setBypassCSP(true);
    await page.setJavaScriptEnabled(true);
    await page.setViewport({ width: 1280, height: 800 });

    // Request blocking
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        const type = req.resourceType();
        const url = req.url();

        if (
            BLOCKED_RESOURCE_TYPES.has(type) ||
            BLOCKED_URL_PATTERNS.some(p => url.includes(p))
        ) {
            return req.abort();
        }

        req.continue();
    });

    // Reduce noise / memory leaks
    page.on("pageerror", () => { });
    page.on("error", () => { });
    page.setDefaultNavigationTimeout(30_000);
    page.setDefaultTimeout(30_000);

    return page;
}

function sanitizeCss(css) {
    return css
        .replace(/```css/gi, "")
        .replace(/```/g, "")
        .replace('Copy code', '')
        .replace('css', '')
        .replaceAll('\n', '')
        .trim();
}

async function setComposerText(page, text) {
    await page.waitForSelector("#prompt-textarea", { visible: true });
    await page.click("#prompt-textarea");

    await page.evaluate((t) => {
        const el = document.querySelector("#prompt-textarea");
        if (!el) return;

        el.focus();
        el.textContent = "";         // clear
        el.textContent = t;          // set

        // Let ProseMirror/React know content changed
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }, text);
}

async function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}


async function uploadTxtOnce(page, txtPath) {
  const abs = path.resolve(txtPath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);

  // Open the attachment UI (forces the generic file input to mount)
  await page.waitForSelector("#composer-plus-btn", { visible: true });
  await page.click("#composer-plus-btn");

  // Find a file input that is NOT restricted to images
  const selector = 'input[type="file"]:not([accept="image/*"])';

  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.waitForSelector(selector, { visible: false });

    // React sometimes leaves multiple; use the newest one
    const inputs = await page.$$(selector);
    const input = inputs[inputs.length - 1];
    if (!input) throw new Error("Generic file input not found");

    try {
      await input.uploadFile(abs);

      // Confirm the browser thinks the input has a file selected
      await page.waitForFunction(
        (sel) => {
          const els = Array.from(document.querySelectorAll(sel));
          return els.some((el) => el.files && el.files.length > 0);
        },
        { timeout: 5000 },
        selector
      );

      return; // success
    } catch (e) {
      if (attempt === 2) throw e;
      // UI likely re-mounted; reopen + and retry
      await page.click("#composer-plus-btn");
      await delay(200);
    }
  }
}

async function uploadSnapshot(page, filePath) {
    // wait until composer loads
    await page.waitForSelector("#composer-plus-btn", { visible: true });

    // open attachment menu
    await page.click("#composer-plus-btn");
    await delay(1000);
    await page.click("#radix-_R_4lm779il2kltd33ih6kcmH1_ > div.empty\\:hidden.\\[\\:not\\(\\:has\\(div\\:not\\(\\[role\\=group\\]\\)\\)\\)\\]\\:hidden.before\\:bg-token-border-default.content-sheet\\:before\\:my-3.content-sheet\\:before\\:mx-6.before\\:mx-4.before\\:my-1.before\\:block.before\\:h-px.first\\:before\\:hidden.\\[\\&\\:nth-child\\(1_of_\\:has\\(div\\:not\\(\\[role\\=group\\]\\)\\)\\)\\]\\:before\\:hidden.content-sheet\\:content-sheet-inset-section > div > div.flex.min-w-0.items-center.gap-1\\.5 > div.flex.min-w-0.grow.items-center.gap-2\\.5");
    await delay(500);

    // IMPORTANT:
    // wait for the REAL general file input (no accept="image/*")
    await page.waitForSelector('input[type="file"]:not([accept="image/*"])', {
        visible: false
    });

    // grab newest file input (react often mounts multiple)
    const inputs = await page.$$('input[type="file"]:not([accept="image/*"])');
    const fileInput = inputs[inputs.length - 1];
    if (!fileInput) throw new Error("file input not found");

    // upload txt
    await fileInput.uploadFile(filePath);

    // wait until UI shows attachment chip
    await page.waitForFunction(() => {
        const all = document.querySelectorAll('input[type=file]');
        for (const el of all) {
            if (el.files && el.files.length > 0) return true;
        }
        return false;
    });
    await waitForFileAttached(page, 'input[type="file"]:not([accept="image/*"])');
    await waitForUploadUiDone(page);
}

async function waitForResponseDone(page, timeoutMs = 180_000) {
    const stopSel = 'button[aria-label*="Stop"], button[data-testid="stop-button"]';
    const sendSel = 'button[data-testid="send-button"], button[aria-label="Send"]';

    const start = Date.now();
    while (true) {
        const done = await page.evaluate((stopSel, sendSel) => {
            if (document.querySelector(stopSel)) return false;

            const send = document.querySelector(sendSel);
            if (!send) return true;

            const disabled =
                send.hasAttribute("disabled") ||
                send.getAttribute("aria-disabled") === "true";
            return !disabled;
        }, stopSel, sendSel);

        if (done) return;

        if (Date.now() - start > timeoutMs) {
            throw new Error("Timed out waiting for response");
        }
        await delay(400);
    }
}

async function waitForFileAttached(page, inputSel, timeoutMs = 60_000) {
    await page.waitForFunction((sel) => {
        const input = document.querySelector(sel);
        return input && input.files && input.files.length > 0;
    }, { timeout: timeoutMs }, inputSel);
}

async function waitForUploadUiDone(page, timeoutMs = 120_000) {
    const start = Date.now();
    while (true) {
        const ready = await page.evaluate(() => {
            // Heuristics: any attachment chip visible and no progress indicator/spinner nearby.
            // This is intentionally generic so it survives UI changes.
            const hasAttachment =
                document.querySelector('[data-testid*="attachment"], [aria-label*="attachment"], [aria-label*="file"]');

            const hasProgress =
                document.querySelector('progress, [role="progressbar"], .animate-spin');

            return !!hasAttachment && !hasProgress;
        });

        if (ready) return;
        if (Date.now() - start > timeoutMs) throw new Error("Upload UI did not finish");
        await delay(300);
    }
}

/**
 * Waits until the page's scrollHeight stops changing for a given duration.
 * @param {puppeteer.Page} page - Puppeteer page instance
 * @param {number} stableTime - Time in milliseconds the height should stay stable (default 5000ms)
 * @param {number} checkInterval - How often to check height (default 200ms)
 */
async function waitForStableHeight(page, stableTime = 5000, checkInterval = 200) {
    let lastHeight = await page.evaluate(() => document.body.scrollHeight);
    let stableCounter = 0;

    while (stableCounter < stableTime) {
        await delay(200);
        const newHeight = await page.evaluate(() => document.body.scrollHeight);

        if (newHeight === lastHeight) {
            stableCounter += checkInterval;
        } else {
            stableCounter = 0; // reset counter if height changes
            lastHeight = newHeight;
        }
    }
}

async function runPrompt(prompt, snapPath) {
    let page = await newPage();
    await page.goto(GPT_URL, { waitUntil: "networkidle2" });
    // Turn on temp chat
    await page.waitForSelector("#conversation-header-actions > div > span > button", { visible: true });
    await page.click("#conversation-header-actions > div > span > button");

    await page.waitForSelector("#prompt-textarea", { visible: true });

    await uploadTxtOnce(page, snapPath);

    await page.click("#prompt-textarea");

    await page.evaluate((text) => {
        const el = document.querySelector("#prompt-textarea");
        if (!el) return;

        el.focus();

        // Replace contents
        el.textContent = text;

        // Move caret to end
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }, prompt);
    await delay(1000);

    await page.click("#composer-submit-button");
    await delay(3000);
    await waitForResponseDone(page);
    await delay(1000)
    await waitForStableHeight(page, 3000);

    const messages = await page.$$eval("pre, code", els =>
        els.map(e => e.innerText)
    );

    await page.close();
    return messages.map(m => sanitizeCss(m.trim())).filter(Boolean);
}

process.on("SIGINT", async () => {
    const browser = await getBrowser();
    await browser.close();
    process.exit(0);
});

module.exports = runPrompt;