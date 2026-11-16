import { formatDateTime, formatMoney } from '@nexora/shared';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const thb = (value: number | null | undefined) => formatMoney(Number(value ?? 0), 'th');

export interface ShiftPrintSummary {
  businessName: string;
  storeName: string;
  cashier: string;
  mode: 'X' | 'Z';
  openedAt: string;
  closedAt?: string | null;
  businessDate: string;
  salesCount: number;
  salesTotalSatang: number;
  discountSatang: number;
  taxSatang: number;
  refundTotalSatang: number;
  openingCashSatang: number;
  cashSalesSatang: number;
  cashInSatang: number;
  cashOutSatang: number;
  expectedCashSatang: number;
  countedCashSatang?: number | null;
  varianceSatang?: number | null;
  payments: Array<{ methodName: string; count: number; amountSatang: number }>;
  topItems: Array<{ name: string; qty: number; amountSatang: number }>;
}

export function printShiftReport(summary: ShiftPrintSummary): void {
  const payments = summary.payments
    .map(
      (payment) =>
        `<div class="row"><span>${escapeHtml(payment.methodName)} (${payment.count})</span><span>${escapeHtml(thb(payment.amountSatang))}</span></div>`,
    )
    .join('');
  const items = summary.topItems
    .map(
      (item) =>
        `<div class="row"><span>${escapeHtml(item.name)} × ${item.qty}</span><span>${escapeHtml(thb(item.amountSatang))}</span></div>`,
    )
    .join('');

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${summary.mode} report</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    body { font-family: 'IBM Plex Sans Thai','Noto Sans Thai','Segoe UI',sans-serif; font-size: 11px; color:#000; margin:0; }
    .center { text-align:center; }
    .brand { font-size:15px; font-weight:700; letter-spacing:.08em; }
    .muted { color:#444; font-size:10px; line-height:1.45; }
    h1 { font-size:14px; margin:7px 0 2px; }
    hr { border:0; border-top:1px dashed #999; margin:7px 0; }
    .row { display:flex; justify-content:space-between; gap:10px; font-size:10.5px; padding:1.5px 0; }
    .row strong { font-size:12px; }
    .section { margin-top:6px; font-weight:700; font-size:10.5px; }
    .footer { margin-top:10px; text-align:center; font-size:9px; color:#444; }
  </style></head><body>
    <div class="center">
      <div class="brand">${escapeHtml(summary.businessName)}</div>
      <div class="muted">${escapeHtml(summary.storeName)}</div>
      <h1>${summary.mode === 'Z' ? 'รายงานปิดกะ / Z REPORT' : 'รายงานระหว่างกะ / X REPORT'}</h1>
      <div class="muted">${escapeHtml(summary.businessDate)} · ${escapeHtml(summary.cashier)}</div>
    </div>
    <hr />
    <div class="row"><span>เปิดกะ</span><span>${escapeHtml(formatDateTime(summary.openedAt, 'th'))}</span></div>
    ${summary.closedAt ? `<div class="row"><span>ปิดกะ</span><span>${escapeHtml(formatDateTime(summary.closedAt, 'th'))}</span></div>` : ''}
    <hr />
    <div class="row"><span>จำนวนบิล</span><span>${summary.salesCount}</span></div>
    <div class="row"><span>ยอดขาย</span><span>${escapeHtml(thb(summary.salesTotalSatang))}</span></div>
    <div class="row"><span>ส่วนลด</span><span>${escapeHtml(thb(summary.discountSatang))}</span></div>
    <div class="row"><span>VAT</span><span>${escapeHtml(thb(summary.taxSatang))}</span></div>
    <div class="row"><span>คืนสินค้า</span><span>${escapeHtml(thb(summary.refundTotalSatang))}</span></div>
    <hr />
    <div class="section">เงินสดในลิ้นชัก</div>
    <div class="row"><span>เงินสดเริ่มต้น</span><span>${escapeHtml(thb(summary.openingCashSatang))}</span></div>
    <div class="row"><span>ขายเงินสด</span><span>${escapeHtml(thb(summary.cashSalesSatang))}</span></div>
    <div class="row"><span>รับเข้า</span><span>${escapeHtml(thb(summary.cashInSatang))}</span></div>
    <div class="row"><span>จ่ายออก</span><span>${escapeHtml(thb(summary.cashOutSatang))}</span></div>
    <div class="row"><strong>ควรมี</strong><strong>${escapeHtml(thb(summary.expectedCashSatang))}</strong></div>
    ${summary.countedCashSatang != null ? `<div class="row"><strong>นับได้</strong><strong>${escapeHtml(thb(summary.countedCashSatang))}</strong></div>` : ''}
    ${summary.varianceSatang != null ? `<div class="row"><strong>ผลต่าง</strong><strong>${escapeHtml(thb(summary.varianceSatang))}</strong></div>` : ''}
    ${payments ? `<hr /><div class="section">ช่องทางชำระ</div>${payments}` : ''}
    ${items ? `<hr /><div class="section">สินค้าขายดี</div>${items}` : ''}
    <div class="footer">
      ${summary.mode === 'Z' ? 'เอกสารปิดกะ · เก็บไว้เพื่อตรวจสอบ' : 'เอกสารระหว่างกะ · ไม่ใช่เอกสารปิดบัญชี'}<br />
      NEXORA POS · ${escapeHtml(summary.businessDate)}
    </div>
  </body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 800);
  }, 200);
}
