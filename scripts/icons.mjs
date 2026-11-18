// Renders public/icons/icon.svg to the PNG sizes the manifest names. Run with: npm run icons
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
// Playwright is pre-installed globally on the build machine; fall back to a local install.
const req = createRequire(import.meta.url);
let pw;
try { pw = req("playwright"); } catch { pw = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); }
const { chromium } = pw;
import { readFileSync } from "node:fs";

const svg = readFileSync(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [["icon-192", 192, 0], ["icon-512", 512, 0], ["maskable-512", 512, 0.12]]) {
  // The maskable one fills its square with red and shrinks the glyph into the safe zone.
  const inner = pad ? svg.replace('rx="24"', 'rx="0"').replace("<g ", `<g transform="translate(${108 * pad} ${108 * pad}) scale(${1 - pad * 2})" `) : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${inner.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/icons/${name}.png`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
