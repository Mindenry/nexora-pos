import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.UI_BASE ?? 'http://localhost:5173';
const outDir = 'test-results/ui';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'th-TH' });
const page = await context.newPage();
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => {
  const failure = request.failure();
  if (!request.url().includes('favicon')) errors.push(`requestfailed: ${request.url()} ${failure?.errorText ?? ''}`);
});

async function shot(name) {
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
  console.log(`captured ${name} -> ${page.url()}`);
}

await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await shot('01-login');

await page.fill('#email', 'owner@demo.nexora.local');
await page.fill('#password', 'NexoraDemo!2026');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard', { timeout: 20000 });
await page.getByText('ยอดขายรวม').first().waitFor({ timeout: 20000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);
await shot('02-dashboard');

const routes = [
  ['products', '03-products'],
  ['inventory', '04-inventory'],
  ['sales', '05-sales'],
  ['shifts', '06-shifts'],
  ['reports', '07-reports'],
  ['customers', '08-customers'],
  ['purchasing', '09-purchasing'],
  ['promotions', '10-promotions'],
  ['employees', '11-employees'],
  ['settings', '12-settings'],
];

for (const [route, name] of routes) {
  await page.goto(`${base}/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await shot(name);
}

await page.goto(`${base}/pos`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await shot('13-pos');

// The terminal asks for a shift. Open one, then ring a demo item.
const openShift = page.getByRole('button', { name: 'เปิดกะ' }).last();
if (await openShift.count()) {
  await openShift.click();
  await page.waitForTimeout(1200);
}
await page.waitForTimeout(400);
await shot('13b-pos-ready');

const productButton = page.locator('button.group').first();
if (await productButton.count()) {
  await productButton.click();
  await page.waitForTimeout(400);
  await shot('14-pos-cart');

  // Customer-facing display in a second window.
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'จอลูกค้า' }).click();
  const display = await popupPromise;
  await display.waitForLoadState('networkidle');
  await display.waitForTimeout(900);
  await display.screenshot({ path: `${outDir}/14b-customer-display.png` });
  await display.close();

  const payButton = page.getByRole('button', { name: /ชำระเงิน/ }).last();
  if (await payButton.count()) {
    await payButton.click();
    await page.waitForTimeout(500);
    await shot('15-pos-checkout');
  }
}

// Dark mode + mobile dashboard
await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.setItem('nexora.theme', 'dark');
});
await page.reload({ waitUntil: 'networkidle' });
await shot('16-dashboard-dark');
await page.evaluate(() => localStorage.setItem('nexora.theme', 'light'));

// Cashier terminal at 1024x768 and a wide 1920 dashboard.
await page.setViewportSize({ width: 1024, height: 768 });
await page.goto(`${base}/pos`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('20-pos-1024');
await page.setViewportSize({ width: 1920, height: 1080 });
await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot('21-dashboard-1920');

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'th-TH', isMobile: true, hasTouch: true });
const mobilePage = await mobile.newPage();
await mobilePage.goto(`${base}/login`, { waitUntil: 'networkidle' });
await mobilePage.fill('#email', 'owner@demo.nexora.local');
await mobilePage.fill('#password', 'NexoraDemo!2026');
await mobilePage.click('button[type="submit"]');
await mobilePage.waitForURL('**/dashboard', { timeout: 20000 });
await mobilePage.getByText('ยอดขายรวม').first().waitFor({ timeout: 20000 });
await mobilePage.waitForLoadState('networkidle');
await mobilePage.waitForTimeout(800);
await mobilePage.screenshot({ path: `${outDir}/17-mobile-dashboard.png` });
await mobilePage.goto(`${base}/pos`, { waitUntil: 'networkidle' });
await mobilePage.waitForTimeout(800);
await mobilePage.screenshot({ path: `${outDir}/18-mobile-pos.png` });

// Platform admin
const platform = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'th-TH' });
const platformPage = await platform.newPage();
platformPage.on('pageerror', (error) => errors.push(`platform pageerror: ${error.message}`));
await platformPage.goto(`${base}/login`, { waitUntil: 'networkidle' });
await platformPage.fill('#email', 'admin@nexora.local');
await platformPage.fill('#password', 'NexoraAdmin!2026');
await platformPage.click('button[type="submit"]');
await platformPage.waitForURL('**/platform', { timeout: 20000 });
await platformPage.waitForLoadState('networkidle');
await platformPage.screenshot({ path: `${outDir}/19-platform.png` });

console.log('\nERRORS:');
if (errors.length === 0) console.log('none');
else console.log(errors.slice(0, 30).join('\n'));

await browser.close();
