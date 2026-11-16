import { expect, test, type Page } from '@playwright/test';

const WEB = { 'x-nexora-client': 'web', origin: 'http://localhost:5173' };

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('#email', 'owner@demo.nexora.local');
  await page.fill('#password', 'NexoraDemo!2026');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
  await expect(page.getByText('ยอดขายรวม').first()).toBeVisible();
}

async function openTerminal(page: Page) {
  await page.goto('/pos');
  await page.waitForTimeout(1200);
  if (await page.getByRole('heading', { name: 'เปิดกะ' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'เปิดกะ' }).last().click();
    await expect(page.getByRole('heading', { name: 'เปิดกะ' })).toBeHidden({ timeout: 15_000 });
  }
  await expect(page.getByPlaceholder(/สแกนบาร์โค้ด/)).toBeVisible();
}

async function createAccount(page: Page, displayName: string): Promise<string> {
  const response = await page.request.post('/api/promptpay/accounts', {
    headers: WEB,
    data: {
      identifierType: 'mobile',
      identifier: '0812345678',
      displayName,
      isDefault: true,
    },
  });
  if (response.status() === 201) {
    return (await response.json()).data.id as string;
  }
  const list = await page.request.get('/api/promptpay/accounts', { headers: WEB });
  expect(list.status()).toBe(200);
  const accounts = (await list.json()).data as Array<{ id: string; displayName: string }>;
  const existing = accounts.find((account) => account.displayName === displayName) ?? accounts[0];
  expect(existing, JSON.stringify(accounts)).toBeTruthy();
  return existing!.id;
}

async function deleteAccount(page: Page, id: string) {
  await page.request.delete(`/api/promptpay/accounts/${id}`, { headers: WEB });
}

test('adds a PromptPay account and never displays the full identifier', async ({ page }) => {
  await login(page);
  await page.goto('/promptpay');
  await page.getByRole('tab', { name: /บัญชีรับเงิน/ }).click();
  await page.getByRole('button', { name: /เพิ่มบัญชี/ }).first().click();
  await expect(page.getByRole('heading', { name: 'เพิ่มบัญชีพร้อมเพย์' })).toBeVisible();

  const dialog = page.getByRole('dialog');
  await dialog.locator('input').nth(0).fill('0812345678');
  await dialog.locator('input').nth(1).fill('E2E PromptPay');
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();

  await expect(page.getByText('E2E PromptPay').first()).toBeVisible();
  await expect(page.getByText('081-•••-5678').first()).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('0812345678');

  const list = await page.request.get('/api/promptpay/accounts', { headers: WEB });
  const accounts = (await list.json()).data as Array<{ id: string; displayName: string }>;
  const created = accounts.find((account) => account.displayName === 'E2E PromptPay');
  if (created) await deleteAccount(page, created.id);
});

test('rings a PromptPay sale after staff confirms receipt', async ({ page }) => {
  await login(page);
  const accountId = await createAccount(page, 'E2E Counter PromptPay');
  await openTerminal(page);

  await page.locator('button.group').first().click();
  await expect(page.getByText(/1\s*ชิ้น/).first()).toBeVisible();
  await page.getByRole('button', { name: /ชำระเงิน/ }).last().click();

  await page.getByRole('button', { name: 'พร้อมเพย์', exact: true }).last().click();
  await expect(page.getByText('ต้องสร้าง QR และยืนยันเงินเข้า')).toBeVisible();
  await page.getByRole('button', { name: 'สร้าง QR', exact: true }).click();

  const dialog = page.getByRole('dialog').filter({ hasText: 'รับชำระด้วยพร้อมเพย์' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'QR พร้อมเพย์' })).toBeVisible();
  const reference = (await dialog.innerText()).match(/PP-[0-9A-F]{12}/)?.[0] ?? '';
  expect(reference).toMatch(/^PP-[0-9A-F]{12}$/);

  await dialog.getByRole('button', { name: 'ยืนยันรับชำระเงิน' }).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'ยืนยันว่าได้รับเงินแล้ว' }).click();
  await expect(dialog.getByText('ยืนยันรับเงินเรียบร้อยแล้ว')).toBeVisible();
  await dialog.getByRole('button', { name: 'เสร็จสิ้น' }).click();

  await expect(
    page.getByRole('dialog').filter({ hasText: 'ชำระเงิน' }).getByText('ยืนยันรับเงินแล้ว'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'ยืนยันการชำระเงิน' }).click();
  await expect(page.getByRole('heading', { name: 'ชำระเงินสำเร็จ' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'บิลใหม่' }).click();

  await page.goto('/promptpay');
  const historyRow = page.locator('tbody tr').filter({ hasText: reference });
  await expect(historyRow).toBeVisible();
  await expect(historyRow).toContainText('ชำระแล้ว');

  await deleteAccount(page, accountId);
});

test('keeps checkout disabled until PromptPay receipt is verified', async ({ page }) => {
  await login(page);
  const accountId = await createAccount(page, 'E2E Pending PromptPay');
  await openTerminal(page);

  await page.locator('button.group').first().click();
  await page.getByRole('button', { name: /ชำระเงิน/ }).last().click();
  await page.getByRole('button', { name: 'พร้อมเพย์', exact: true }).last().click();
  await page.getByRole('button', { name: 'สร้าง QR', exact: true }).click();

  const dialog = page.getByRole('dialog').filter({ hasText: 'รับชำระด้วยพร้อมเพย์' });
  await expect(dialog.getByRole('img', { name: 'QR พร้อมเพย์' })).toBeVisible();
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ยืนยันการชำระเงิน' })).toBeDisabled();

  // Reopening the dialog reuses the pending session for the same operation.
  await page.getByRole('button', { name: 'สร้าง QR', exact: true }).click();
  const reopened = page.getByRole('dialog').filter({ hasText: 'รับชำระด้วยพร้อมเพย์' });
  await expect(reopened.getByRole('img', { name: 'QR พร้อมเพย์' })).toBeVisible();
  await reopened.getByRole('button', { name: 'ยกเลิก QR' }).click();
  await expect(reopened).toBeHidden({ timeout: 15_000 });

  await deleteAccount(page, accountId);
});
