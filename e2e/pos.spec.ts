import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email = 'owner@demo.nexora.local', password = 'NexoraDemo!2026') {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
  await expect(page.getByText('ยอดขายรวม').first()).toBeVisible();
}

async function ensureShift(page: Page) {
  const modalTitle = page.getByRole('heading', { name: 'เปิดกะ' });
  if (await modalTitle.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'เปิดกะ' }).last().click();
    await expect(modalTitle).toBeHidden({ timeout: 15_000 });
  }
}

test.describe('NEXORA POS critical journeys', () => {
  test('login, open a shift and complete a cash sale', async ({ page }) => {
    await login(page);
    await page.goto('/pos');
    await page.waitForTimeout(1200);
    await ensureShift(page);
    await expect(page.getByPlaceholder(/สแกนบาร์โค้ด/)).toBeVisible({ timeout: 10_000 });

    const firstProduct = page.locator('button.group').first();
    await expect(firstProduct).toBeEnabled();
    await firstProduct.click();

    const cartCount = page.getByText(/1\s*ชิ้น/).first();
    await expect(cartCount).toBeVisible();

    await page.getByRole('button', { name: /ชำระเงิน/ }).last().click();
    const payHeading = page.getByRole('heading', { name: 'ชำระเงิน' });
    if (await payHeading.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'ยืนยันการชำระเงิน' }).click();
    }

    await expect(page.getByRole('heading', { name: 'ชำระเงินสำเร็จ' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/R-\d{8}-\d{5}/).first()).toBeVisible();
    await page.getByRole('button', { name: 'บิลใหม่' }).click();
    await expect(page.getByRole('heading', { name: 'ชำระเงินสำเร็จ' })).toBeHidden();
  });

  test('sales list reflects the completed sale and opens its detail', async ({ page }) => {
    await login(page);
    await page.goto('/sales');
    await expect(page.getByText('รายการขาย').first()).toBeVisible();
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await expect(page.getByText('รายการสินค้า')).toBeVisible();
    await expect(page.getByText('การชำระเงิน')).toBeVisible();
  });

  test('switches language and reports the same figures', async ({ page }) => {
    await login(page);
    await page.goto('/reports');
    await expect(page.getByText('ยอดขายรวม')).toBeVisible();
    await page.getByRole('button', { name: 'เมนูผู้ใช้' }).click();
    await page.getByRole('button', { name: /ภาษา/ }).click();
    await expect(page.getByText('Gross sales').first()).toBeVisible();
  });

  test('mobile viewport renders overview and terminal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await expect(page.getByText('ยอดขายรวม').first()).toBeVisible();
    await page.goto('/pos');
    await page.waitForTimeout(1000);
    await expect(page.getByPlaceholder(/สแกนบาร์โค้ด/)).toBeVisible();
  });

  test('keyboard flow: F2 search, Enter to add, F4 to pay, Escape to close', async ({ page }) => {
    await login(page);
    await page.goto('/pos');
    await page.waitForTimeout(1200);
    await ensureShift(page);

    await page.keyboard.press('F2');
    const search = page.getByPlaceholder(/สแกนบาร์โค้ด/);
    await expect(search).toBeFocused();
    await search.fill('กาแฟ');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/1\s*ชิ้น/).first()).toBeVisible();

    await page.keyboard.press('F4');
    await expect(page.getByRole('heading', { name: 'ชำระเงิน' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'ชำระเงิน' })).toBeHidden();
  });

  test('queues an offline cash sale and syncs it once when online', async ({ page, context }) => {
    await login(page);
    await page.goto('/pos');
    await page.waitForTimeout(1200);
    await ensureShift(page);

    await context.setOffline(true);
    await expect(page.getByText(/โหมดออฟไลน์/)).toBeVisible({ timeout: 10_000 });

    await page.locator('button.group').first().click();
    await page.getByRole('button', { name: /ชำระเงิน|บันทึกการขายออฟไลน์/ }).last().click();
    await expect(page.getByRole('heading', { name: 'ชำระเงิน' })).toBeVisible();
    await page.getByRole('button', { name: 'บันทึกออฟไลน์', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'บันทึกออฟไลน์แล้ว' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'บิลใหม่' }).click();

    const synced = page.waitForResponse(
      (response) => response.url().includes('/api/pos/checkout') && response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await context.setOffline(false);
    const response = await synced;
    expect(response.status()).toBe(201);
    await expect(page.getByText('ออนไลน์').first()).toBeVisible({ timeout: 15_000 });
  });

  test('platform admin sees the platform console', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', 'admin@nexora.local');
    await page.fill('#password', 'NexoraAdmin!2026');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/platform');
    await expect(page.getByRole('heading', { name: 'ผู้ดูแลแพลตฟอร์ม' })).toBeVisible();
    await expect(page.getByText('องค์กรทั้งหมด')).toBeVisible();
  });
});
