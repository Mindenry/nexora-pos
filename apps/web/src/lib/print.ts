import { formatDateTime, formatMoney } from '@nexora/shared';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export interface PrintableReceipt {
  type?: string;
  number: string;
  businessDate?: string;
  issuedAt?: string;
  business?: {
    name?: string;
    legalName?: string;
    taxId?: string;
    address?: string;
    phone?: string;
  };
  store?: { name?: string; address?: string; phone?: string; taxId?: string };
  cashier?: string;
  customer?: { name?: string; phone?: string } | null;
  items?: Array<{
    name: string;
    sku?: string;
    qty: number;
    unitPriceSatang?: number;
    amountSatang?: number;
    totalSatang?: number;
    discountSatang?: number;
  }>;
  subtotalSatang?: number;
  discountSatang?: number;
  taxSatang?: number;
  totalSatang: number;
  changeSatang?: number;
  vatRateBp?: number;
  pricesIncludeTax?: boolean;
  payments?: Array<{ methodName?: string; method?: string; amountSatang: number; reference?: string }>;
  appliedPromotions?: Array<{ name: string; amountSatang: number }>;
  footer?: string;
  reprint?: boolean;
  originalNumber?: string;
  reason?: string;
  restock?: boolean;
}

const thb = (value: number | undefined) => formatMoney(Number(value ?? 0), 'th');

export function printReceipt(receipt: PrintableReceipt): void {
  const isRefund = receipt.type === 'refund';
  const items = (receipt.items ?? [])
    .map((item) => {
      const amount = item.totalSatang ?? item.amountSatang ?? 0;
      return `<tr>
        <td class="name">${escapeHtml(item.name)}${item.sku ? `<div class="sku">${escapeHtml(item.sku)}</div>` : ''}</td>
        <td class="qty">${item.qty}</td>
        <td class="amt">${escapeHtml(thb(amount))}</td>
      </tr>`;
    })
    .join('');

  const payments = (receipt.payments ?? [])
    .map(
      (p) =>
        `<div class="row"><span>${escapeHtml(p.methodName ?? p.method ?? '')}${p.reference ? ` · ${escapeHtml(p.reference)}` : ''}</span><span>${escapeHtml(thb(p.amountSatang))}</span></div>`,
    )
    .join('');

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(receipt.number)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    body { font-family: 'IBM Plex Sans Thai','Noto Sans Thai','Segoe UI',sans-serif; font-size: 11px; color:#000; margin:0; }
    .center { text-align:center; }
    .brand { font-size:16px; font-weight:700; letter-spacing:.08em; margin-bottom:2px; }
    .muted { color:#444; font-size:10px; line-height:1.45; }
    h1 { font-size:14px; margin:6px 0 2px; }
    .meta { display:flex; justify-content:space-between; font-size:10px; margin-top:2px; }
    hr { border:0; border-top:1px dashed #999; margin:8px 0; }
    table { width:100%; border-collapse:collapse; }
    td { vertical-align:top; padding:2px 0; font-size:10.5px; }
    .name { width:60%; }
    .qty { width:12%; text-align:center; }
    .amt { width:28%; text-align:right; }
    .sku { color:#666; font-size:9px; }
    .row { display:flex; justify-content:space-between; font-size:10.5px; padding:1px 0; }
    .row.total { font-size:14px; font-weight:700; margin-top:4px; }
    .row.change { font-size:12px; font-weight:600; }
    .footer { margin-top:10px; text-align:center; font-size:9.5px; color:#333; line-height:1.5; }
    .reprint { border:1px solid #000; padding:2px 4px; font-size:9px; display:inline-block; margin-top:4px; }
    .refund { font-weight:700; text-align:center; font-size:13px; margin:6px 0; }
  </style></head><body>
    <div class="center">
      <div class="brand">${escapeHtml(receipt.business?.name ?? 'NEXORA')}</div>
      <div class="muted">${escapeHtml(receipt.business?.legalName ?? '')}</div>
      <div class="muted">${escapeHtml(receipt.business?.address ?? '')}</div>
      <div class="muted">${escapeHtml(receipt.business?.phone ?? '')}${receipt.business?.taxId ? ` · เลขภาษี ${escapeHtml(receipt.business.taxId)}` : ''}</div>
      ${isRefund ? '<div class="refund">ใบรับคืนสินค้า / REFUND</div>' : ''}
      <h1>${isRefund ? 'ใบรับคืนสินค้า' : 'ใบเสร็จรับเงิน'}</h1>
      <div class="muted">${escapeHtml(receipt.store?.name ?? '')}</div>
      ${receipt.reprint ? '<div class="reprint">พิมพ์ซ้ำ / REPRINT</div>' : ''}
    </div>
    <hr />
    <div class="row"><span>เลขที่</span><span>${escapeHtml(receipt.number)}</span></div>
    ${receipt.originalNumber ? `<div class="row"><span>อ้างอิงบิล</span><span>${escapeHtml(receipt.originalNumber)}</span></div>` : ''}
    <div class="row"><span>วันที่</span><span>${escapeHtml(formatDateTime(receipt.issuedAt ?? new Date(), 'th'))}</span></div>
    <div class="row"><span>พนักงาน</span><span>${escapeHtml(receipt.cashier ?? '')}</span></div>
    ${receipt.customer ? `<div class="row"><span>ลูกค้า</span><span>${escapeHtml(receipt.customer.name ?? '')}</span></div>` : ''}
    <hr />
    <table><tbody>${items}</tbody></table>
    <hr />
    <div class="row"><span>ยอดรวมสินค้า</span><span>${escapeHtml(thb(receipt.subtotalSatang))}</span></div>
    ${Number(receipt.discountSatang ?? 0) > 0 ? `<div class="row"><span>ส่วนลด</span><span>-${escapeHtml(thb(receipt.discountSatang))}</span></div>` : ''}
    <div class="row"><span>ภาษีมูลค่าเพิ่ม ${((receipt.vatRateBp ?? 700) / 100).toFixed(0)}% ${receipt.pricesIncludeTax === false ? '' : '(รวม)'}</span><span>${escapeHtml(thb(receipt.taxSatang))}</span></div>
    <div class="row total"><span>ยอดสุทธิ</span><span>${escapeHtml(thb(receipt.totalSatang))}</span></div>
    ${payments}
    ${Number(receipt.changeSatang ?? 0) > 0 ? `<div class="row change"><span>เงินทอน</span><span>${escapeHtml(thb(receipt.changeSatang))}</span></div>` : ''}
    ${receipt.reason ? `<hr /><div class="muted">เหตุผล: ${escapeHtml(receipt.reason)}</div>` : ''}
    <div class="footer">
      ${escapeHtml(receipt.footer ?? 'ขอบคุณที่ใช้บริการ')}<br />
      NEXORA POS · ${escapeHtml(receipt.businessDate ?? '')}
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
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => document.body.removeChild(iframe), 800);
  }, 200);
}
