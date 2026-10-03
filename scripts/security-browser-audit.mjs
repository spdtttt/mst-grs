// Anonymous browser checks; no form submissions or live data mutations.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "https://mst-grs.vercel.app";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of ["/dashboard/admin", "/dashboard/manager", "/dashboard"]) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    const pathname = new URL(page.url()).pathname;
    if (pathname !== "/")
      throw new Error(`Unexpected anonymous destination ${pathname}`);
    results.push({ path, result: "redirected to login in browser" });
  }
  const marker = '<svg onload="window.__securityAuditXss=1"></svg>';
  const params = new URLSearchParams({
    role: marker,
    next: `/dashboard/${marker}`,
  });
  await page.goto(`${base}/?${params}`, { waitUntil: "networkidle" });
  const xss = await page.evaluate(() => window.__securityAuditXss === 1);
  if (xss) throw new Error("Reflected query XSS executed");
  results.push({
    path: "/?role=...&next=...",
    result: "no reflected query script execution",
    payload: marker,
  });
  await page.goto(`${base}/?next=https%3A%2F%2Faudit.invalid`, {
    waitUntil: "networkidle",
  });
  if (new URL(page.url()).origin !== base)
    throw new Error("External return URL followed");
  results.push({
    path: "/?next=https://audit.invalid",
    result:
      "remains on same origin before login; post-login path separately unit tested",
  });
  await page.goto(`${base}/register`, { waitUntil: "networkidle" });
  results.push({
    path: "/register",
    result: "public form accessible",
    passwordFields: await page.locator("input[type=password]").count(),
  });
  mkdirSync("test-results/security", { recursive: true });
  writeFileSync(
    "test-results/security/browser-audit.json",
    JSON.stringify({ date: new Date().toISOString(), base, results }, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
