import { expect, test, type Page } from '@playwright/test';

// iPad Pro 11" landscape with touch input, matching the tablet the shop will use.
test.use({
  viewport: { width: 1194, height: 834 },
  hasTouch: true,
  deviceScaleFactor: 2,
});

async function login(page: Page, email = 'owner@demo.nexora.local', password = 'NexoraDemo!2026') {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
  await expect(page.getByText('ยอดขายรวม').first()).toBeVisible();
}

async function openTerminal(page: Page) {
  await page.goto('/pos');
  await page.waitForTimeout(1200);
  const modalTitle = page.getByRole('heading', { name: 'เปิดกะ' });
  if (await modalTitle.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'เปิดกะ' }).last().click();
    await expect(modalTitle).toBeHidden({ timeout: 15_000 });
  }
  await expect(page.getByPlaceholder(/สแกนบาร์โค้ด/)).toBeVisible({ timeout: 10_000 });
}

test.describe('iPad Pro touch terminal', () => {
  test('tap product, edit quantity on the keypad and pay by touch', async ({ page }) => {
    await login(page);
    await openTerminal(page);

    const firstProduct = page.locator('button.group').first();
    await expect(firstProduct).toBeEnabled();
    await firstProduct.tap();
    await expect(page.getByText(/1\s*ชิ้น/).first()).toBeVisible();

    await page.getByRole('button', { name: 'แก้จำนวน' }).tap();
    await expect(page.getByText('ใส่จำนวนด้วยแป้นตัวเลข')).toBeVisible();
    await page.getByRole('button', { name: 'C', exact: true }).tap();
    await page.getByRole('button', { name: '4', exact: true }).tap();
    await page.getByRole('button', { name: 'ยืนยันจำนวน' }).tap();
    await expect(page.getByText(/4\s*ชิ้น/).first()).toBeVisible();

    await page.getByRole('button', { name: /ชำระเงิน/ }).last().tap();
    await expect(page.getByRole('heading', { name: 'ชำระเงิน' })).toBeVisible();
    await page.getByRole('button', { name: 'ยืนยันการชำระเงิน' }).tap();
    await expect(page.getByRole('heading', { name: 'ชำระเงินสำเร็จ' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'บิลใหม่' }).tap();
    await expect(page.getByRole('heading', { name: 'ชำระเงินสำเร็จ' })).toBeHidden();
  });

  test('tablet layout keeps cart, sound and customer display reachable', async ({ page }) => {
    await login(page);
    await openTerminal(page);
    await expect(page.getByRole('heading', { name: 'ตะกร้า' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ปิดเสียง' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'จอลูกค้า' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'เต็มจอ' })).toBeVisible();
  });

  test('pins a favourite product and shows the quick strip', async ({ page }) => {
    await login(page);
    await openTerminal(page);

    const firstProduct = page.locator('button.group').first();
    const name = (await firstProduct.locator('p').first().innerText()).trim();
    await page.getByRole('button', { name: 'เพิ่มในรายการโปรด' }).first().tap();
    await expect(page.getByText('รายการโปรด')).toBeVisible();
    const strip = page.locator('div.rounded-xl.border').filter({ hasText: 'รายการโปรด' }).first();
    await expect(strip.getByText(name).first()).toBeVisible();

    // Favourites survive a reload on the same device.
    await page.reload();
    await expect(page.getByText('รายการโปรด')).toBeVisible({ timeout: 15_000 });
  });

  test('counts the drawer by denomination and prints the X report', async ({ page }) => {
    await login(page);
    await openTerminal(page);
    await page.getByRole('button', { name: 'กะเปิดอยู่' }).tap();
    await expect(page.getByText('นับเงินแยกแบงก์/เหรียญ')).toBeVisible();

    await page.getByLabel('จำนวน 1,000').fill('2');
    await page.getByLabel('จำนวน 100').fill('3');
    await expect(page.getByText('รวมที่นับได้')).toBeVisible();
    await expect(page.getByText('฿2,300.00').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'พิมพ์ X' })).toBeVisible();
    await page.getByRole('button', { name: 'ปิด', exact: true }).tap();
  });

  test('hardware scanner types a barcode into the terminal', async ({ page }) => {
    await login(page);
    await openTerminal(page);

    // The global capture only fires outside form fields, exactly like a keyboard
    // wedge scanner. COF-001 is part of the demo catalogue.
    await page.keyboard.type('8850000000001', { delay: 15 });
    await page.keyboard.press('Enter');
    await expect(page.getByText('อเมริกาโน่ เย็น').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/1\s*ชิ้น/).first()).toBeVisible();
  });
});

test.describe('scan-assisted stock tasks', () => {
  test('scan-to-count increments the counted quantity', async ({ page }) => {
    await login(page);
    await page.goto('/inventory');
    await expect(page.getByText('ภาพรวมสต๊อก')).toBeVisible();
    await page.getByRole('button', { name: 'ตรวจนับสต๊อก' }).click();
    await expect(page.getByText('สแกนเพื่อนับ')).toBeVisible();

    const scanInput = page.locator('input[placeholder*="บาร์โค้ด"]');
    await scanInput.fill('8850000000013');
    await scanInput.press('Enter');
    await expect(page.getByText('นับแล้ว 1 รายการ')).toBeVisible();
    await page.locator('[role="dialog"] button[aria-label="Close"]').click();
  });

  test('scan-to-receive counts an approved purchase order item', async ({ page }) => {
    await login(page);
    await page.goto('/purchasing');
    await page.locator('tbody tr').filter({ hasText: 'PO-DEMO-002' }).click();
    await expect(page.getByRole('button', { name: 'อนุมัติ' })).toBeVisible();
    await page.getByRole('button', { name: 'อนุมัติ' }).click();
    await expect(page.getByText('สแกนรับสินค้า')).toBeVisible();

    const scanInput = page.locator('input[placeholder*="บาร์โค้ด"]');
    await scanInput.fill('8850000000006');
    await scanInput.press('Enter');
    await expect(page.getByText('รับสินค้า · ฿9.00')).toBeVisible();
  });
});
