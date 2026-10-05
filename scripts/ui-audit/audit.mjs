// Visual and accessibility audit of every page, across phone and desktop
// sizes and both themes. Run through scripts/ui-audit/run.sh, which starts a
// seeded instance and this script in the official Playwright image - nothing
// here is a project dependency.
//
// What it produces, in $OUT:
//   report.json      one entry per (page, viewport, theme) with measured
//                    findings: horizontal overflow, elements leaving the
//                    screen, touch targets under 44px on phones, axe-core
//                    WCAG 2.1 AA violations, console and hydration errors.
//   shots/*.png      full-page screenshots, for a human (or Claude) to read.
//
// The measurements catch what can be asserted; the screenshots are for what
// cannot - alignment, density, hierarchy - and are taken for a subset of
// combinations so they stay reviewable.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";

// Required: run.sh sets it to the throwaway instance it starts.
const BASE = process.env.BASE_URL;
if (!BASE) throw new Error("Set BASE_URL to the instance to audit (run.sh does).");
const OUT = process.env.OUT ?? "/out";
const PASSWORD = process.env.AUDIT_PASSWORD;
mkdirSync(`${OUT}/shots`, { recursive: true });

// Phones first, then every common desktop class: small laptop to 1440p.
const VIEWPORTS = [
  { name: "phone-360", width: 360, height: 780, mobile: true },
  { name: "phone-390", width: 390, height: 844, mobile: true },
  { name: "tablet-768", width: 768, height: 1024, mobile: true },
  { name: "laptop-1366", width: 1366, height: 768, mobile: false },
  { name: "desktop-1920", width: 1920, height: 1080, mobile: false },
  { name: "wide-2560", width: 2560, height: 1440, mobile: false },
];
const THEMES = ["dark", "light"];

// Screenshots for a reviewable subset: every page on a phone and a laptop in
// dark, plus light and the extreme widths on the pages people open daily.
const SHOT_ALWAYS = new Set(["phone-390|dark", "laptop-1366|dark"]);
const SHOT_KEY_PAGES = new Set(["phone-390|light", "laptop-1366|light", "phone-360|dark", "wide-2560|dark"]);
const KEY_PAGES = new Set(["dashboard", "accounts", "account-checking", "transactions", "budgets", "analytics"]);

// Three small measurements rather than one large one: each runs in the page
// through its own evaluate, so each carries its own tiny helpers.

/** Horizontal overflow, and elements that leave the screen outside a scroller. */
function measureOverflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const label = (el) => el.tagName.toLowerCase() + " " + (el.innerText || "").trim().slice(0, 50);
    // Allowed past the edge when an ancestor scrolls or clips horizontally:
    // that is the documented pattern for wide tables.
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    const offscreen = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > vw + 1 || r.left < -1);
      })
      .filter((el) => !clipped(el))
      .slice(0, 15)
      .map(label);
    return { pageOverflow: document.documentElement.scrollWidth - vw, offscreen };
  });
}

/** Interactive elements under 44px on a phone, measured with their label. */
function measureTargets(page) {
  return page.evaluate(() => {
    const selector = "a[href], button, [role=button], select, input:not([type=hidden]), summary, [role=tab]";
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    // Visually hidden until focused (the skip link), and WCAG's inline
    // exception for a link inside running text, are not touch targets.
    const exempt = (el) => el.closest(".sr-only") || (el.tagName === "A" && el.closest("p, li") && !el.closest("nav"));
    const size = (el) => {
      const r = el.getBoundingClientRect();
      const lbl = el.id ? document.querySelector('label[for="' + el.id + '"]') : el.closest("label");
      const lr = lbl ? lbl.getBoundingClientRect() : r;
      return [Math.round(Math.max(r.width, lr.width)), Math.round(Math.max(r.height, lr.height))];
    };
    return [...document.querySelectorAll(selector)]
      .filter((el) => shown(el) && !exempt(el))
      .map((el) => [size(el), el])
      .filter(([[w, h]]) => w < 44 || h < 44)
      .map(([[w, h], el]) => w + "x" + h + " " + el.tagName.toLowerCase() + " " + (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 50));
  });
}

/** Text cut by an ellipsis with nothing to reveal the rest. */
function measureClipped(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".truncate, [class*=line-clamp]")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && !el.getAttribute("title"))
      .slice(0, 10)
      .map((el) => el.tagName.toLowerCase() + " " + (el.innerText || "").trim().slice(0, 50))
  );
}

async function measure(page, mobile) {
  const overflow = await measureOverflow(page);
  return {
    ...overflow,
    smallTargets: mobile ? await measureTargets(page) : [],
    clipped: await measureClipped(page),
  };
}

async function login(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** Real ids from the seeded data, so detail pages are audited with content. */
async function discoverPages(browser, state) {
  const ctx = await browser.newContext({ storageState: state });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/accounts`);
  await page.waitForTimeout(1500);
  const accountLinks = await page.$$eval("a[href^='/accounts/']", (as) =>
    [...new Set(as.map((a) => a.getAttribute("href")))].filter((h) => /^\/accounts\/[a-z0-9]+$/.test(h))
  );
  await page.goto(`${BASE}/budgets`);
  await page.waitForTimeout(1500);
  const budgetLink = await page.$$eval("a[href^='/budgets/']", (as) => as.map((a) => a.getAttribute("href"))[0] ?? null);
  await ctx.close();

  const pages = [
    ["dashboard", "/"],
    ["accounts", "/accounts"],
    ["transactions", "/transactions"],
    ["budgets", "/budgets"],
    ["recurring", "/recurring"],
    ["income", "/income"],
    ["analytics", "/analytics"],
    ["tax-report", "/tax-report"],
    ...["accounts", "profile", "security", "sharing", "notifications", "display"].map((t) => [`settings-${t}`, `/settings?tab=${t}`]),
  ];
  if (budgetLink) pages.push(["budget-category", budgetLink]);
  // One detail page per account kind the seed has, by visiting a few.
  const kinds = ["account-checking", "account-2", "account-3", "account-4", "account-5"];
  accountLinks.slice(0, kinds.length).forEach((href, i) => pages.push([kinds[i], href]));
  return pages;
}

async function auditOne(browser, state, [name, path], vp, theme, publicPage = false) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.mobile && vp.width < 768,
    hasTouch: vp.mobile,
    colorScheme: theme,
    ...(publicPage ? {} : { storageState: state }),
  });
  await ctx.addCookies([{ name: "THEME", value: theme, url: BASE }]);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));

  let status = null;
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 45000 });
    status = res?.status() ?? null;
  } catch (e) {
    consoleErrors.push(`navigation: ${e.message.slice(0, 150)}`);
  }
  // The realtime SSE stream keeps a connection open forever, so "networkidle"
  // never arrives; give client components a fixed moment to hydrate instead.
  await page.waitForTimeout(1200);

  const m = await measure(page, vp.mobile && vp.width < 768);
  let axe = [];
  try {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    axe = r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      count: v.nodes.length,
      sample: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(" "), summary: (n.failureSummary || "").split("\n").slice(1, 2).join(" ").slice(0, 160) })),
    }));
  } catch (e) {
    axe = [{ id: "axe-failed", impact: "n/a", count: 0, sample: [{ target: e.message.slice(0, 120) }] }];
  }

  const key = `${vp.name}|${theme}`;
  let shot = null;
  if (SHOT_ALWAYS.has(key) || (SHOT_KEY_PAGES.has(key) && (KEY_PAGES.has(name) || publicPage))) {
    shot = `shots/${name}__${vp.name}__${theme}.png`;
    await page.screenshot({ path: `${OUT}/${shot}`, fullPage: true });
  }
  await ctx.close();
  return { page: name, path, viewport: vp.name, theme, status, ...m, axe, consoleErrors, shot };
}

const browser = await chromium.launch();
const state = await login(browser);
const pages = await discoverPages(browser, state);
const publicPages = [["login", "/login"], ["invite-invalid", "/invite/not-a-real-token"]];

const results = [];
for (const p of pages) {
  for (const vp of VIEWPORTS) for (const theme of THEMES) results.push(await auditOne(browser, state, p, vp, theme));
  console.log(`audited ${p[0]}`);
}
for (const p of publicPages) {
  for (const vp of VIEWPORTS) for (const theme of THEMES) results.push(await auditOne(browser, state, p, vp, theme, true));
  console.log(`audited ${p[0]}`);
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
console.log(`done: ${results.length} combinations, ${results.filter((r) => r.shot).length} screenshots`);
