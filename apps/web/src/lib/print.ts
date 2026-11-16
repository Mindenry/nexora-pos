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
  pointsRedeemed?: number;
  pointsDiscountSatang?: number;
  loyaltyPoints?: number;
  payments?: Array<{ methodName?: string; method?: string; amountSatang: number; reference?: string }>;
  appliedPromotions?: Array<{ name: string; amountSatang: number }>;
  footer?: string;
  reprint?: boolean;
  originalNumber?: string;
  reason?: string;
  restock?: boolean;
}

const amount = (value: number | undefined) =>
  formatMoney(Number(value ?? 0), 'th', { withSymbol: false });

export function printReceipt(receipt: PrintableReceipt): void {
  const isRefund = receipt.type === 'refund';
  const items = (receipt.items ?? [])
    .map((item) => {
      const total = item.totalSatang ?? item.amountSatang ?? 0;
      const unit = item.unitPriceSatang ?? (item.qty > 0 ? total / item.qty : 0);
      return `<tr>
        <td class="name">
          <div class="item">${escapeHtml(item.name)}</div>
          <div class="unit">${escapeHtml(amount(unit))} × ${item.qty}${item.sku ? ` · ${escapeHtml(item.sku)}` : ''}${Number(item.discountSatang ?? 0) > 0 ? ` · -${escapeHtml(amount(item.discountSatang))}` : ''}</div>
        </td>
        <td class="qty">${item.qty}</td>
        <td class="amt">${escapeHtml(amount(total))}</td>
      </tr>`;
    })
    .join('');

  const payments = (receipt.payments ?? [])
    .map(
      (payment) =>
        `<div class="row"><span>${escapeHtml(payment.methodName ?? payment.method ?? '')}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ''}</span><span>${escapeHtml(amount(payment.amountSatang))}</span></div>`,
    )
    .join('');

  const promotions = (receipt.appliedPromotions ?? [])
    .map((promotion) => `<div class="promo">${escapeHtml(promotion.name)}</div>`)
    .join('');

  const vatPercent = ((receipt.vatRateBp ?? 700) / 100).toFixed(0);
  const title = isRefund ? 'ใบเสร็จคืนสินค้า / REFUND' : 'ใบเสร็จรับเงิน / RECEIPT';
  const stamp = isRefund ? 'REFUND' : receipt.reprint ? 'REPRINT' : '';

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(receipt.number)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: 'IBM Plex Sans Thai','Noto Sans Thai','Sarabun','Segoe UI',sans-serif; color:#000; font-size:10px; line-height:1.45; background:#eef0ed; }
    .paper { width:72mm; margin:0 auto; padding:3mm; background:#fff; box-shadow:0 0 0 1px #d9ddd8, 0 8px 24px rgba(15,21,19,.12); }
    .center { text-align:center; }
    .mark { width: 9mm; height: 9mm; margin: 0 auto 2mm; border: 1.5px solid #000; border-radius: 2mm; font-size: 14px; font-weight: 800; line-height: 9mm; letter-spacing: 0; }
    .brand { font-size: 13px; font-weight: 800; letter-spacing: .24em; }
    .muted { color:#333; font-size: 9px; }
    .business { font-size: 11px; font-weight: 700; margin-top: 3mm; }
    .title { font-size: 11.5px; font-weight: 800; letter-spacing: .04em; margin: 3mm 0 1mm; }
    .stamp { display:inline-block; border:1px solid #000; padding: 1mm 2mm; font-size:8.5px; letter-spacing:.12em; margin-top:1mm; }
    .rule { border:0; border-top:1px solid #000; margin: 2.5mm 0; }
    .rule-soft { border:0; border-top:1px solid #bbb; margin: 2mm 0; }
    .meta { display:flex; justify-content:space-between; gap:3mm; font-size:9.5px; padding:.4mm 0; }
    .meta .label { color:#333; }
    .meta .value { text-align:right; font-weight:600; }
    .number { font-size: 12px; font-weight: 800; letter-spacing: .03em; }
    table { width:100%; border-collapse: collapse; }
    thead th { font-size: 8px; text-transform: uppercase; letter-spacing:.08em; color:#333; text-align:left; padding:0 0 1mm; border-bottom:1px solid #000; font-weight:600; }
    thead th.qty, thead th.amt { text-align:right; }
    tbody td { vertical-align: top; padding: 1.6mm 0; border-bottom:1px solid #ddd; }
    td.name { width: 66%; }
    td.qty { width: 10%; text-align:right; font-size:9px; }
    td.amt { width: 24%; text-align:right; font-weight:700; white-space:nowrap; }
    .item { font-size: 10px; font-weight: 600; }
    .unit { font-size: 8px; color:#444; margin-top: .3mm; }
    .row { display:flex; justify-content:space-between; gap:3mm; font-size:9.5px; padding:.4mm 0; }
    .row .num { font-weight:600; white-space:nowrap; }
    .row.total { font-size: 15px; font-weight: 800; border-top: 1.5px solid #000; margin-top: 1.5mm; padding-top: 2mm; }
    .row.total .num { font-size: 16px; }
    .row.change { font-size: 11px; font-weight: 800; border:1px solid #000; padding:1.2mm 2mm; margin-top:1.5mm; }
    .promo { display:inline-block; border:1px solid #999; padding:0 1.5mm; margin:1mm 1mm 0 0; font-size:8px; }
    .spacer { height: 2mm; }
    .footer { margin-top: 3mm; padding-top: 2.5mm; border-top: 1px solid #000; text-align:center; }
    .footer .thanks { font-size: 10px; font-weight: 600; }
    .footer .fine { margin-top:1mm; font-size:8px; color:#333; line-height:1.5; }
    .footer .serial { margin-top:1.5mm; font-size:7.5px; letter-spacing:.06em; color:#333; }
    .refund { font-weight:800; }
    .print-toolbar { position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:2mm; margin:0 0 3mm; padding:2.5mm 3mm; background:#0f1513; color:#fff; font-size:9px; }
    .print-toolbar strong { letter-spacing:.18em; font-size:9px; }
    .print-toolbar .actions { display:flex; gap:1.5mm; }
    .print-toolbar button { border:1px solid rgba(255,255,255,.25); background:rgba(255,255,255,.08); color:#fff; border-radius:1.5mm; padding:1.2mm 2.5mm; font-size:9px; font-family:inherit; }
    .print-toolbar button.primary { background:#2aa78c; border-color:#2aa78c; font-weight:700; }
    @media print {
      .print-toolbar { display:none !important; }
      body { margin:0; background:#fff; }
      .paper { width:auto; margin:0; padding:0; box-shadow:none; }
    }
  </style></head><body>
    <div class="print-toolbar">
      <strong>NEXORA POS</strong>
      <span class="actions">
        <button class="primary" onclick="window.print()">พิมพ์ / Print</button>
        <button onclick="window.close()">ปิด / Close</button>
      </span>
    </div>
    <div class="paper">
    <div class="center">
      <div class="mark">N</div>
      <div class="brand">NEXORA</div>
      <div class="muted">POINT OF SALE · THAILAND</div>
      <div class="business">${escapeHtml(receipt.business?.name ?? 'NEXORA')}</div>
      ${receipt.business?.legalName ? `<div class="muted">${escapeHtml(receipt.business.legalName)}</div>` : ''}
      <div class="muted">${escapeHtml(receipt.store?.name ?? '')}</div>
      <div class="muted">${escapeHtml(receipt.store?.address ?? receipt.business?.address ?? '')}</div>
      <div class="muted">${escapeHtml(receipt.business?.phone ?? '')}${receipt.business?.taxId ? ` · เลขประจำตัวผู้เสียภาษี ${escapeHtml(receipt.business.taxId)}` : ''}</div>
      <div class="title ${isRefund ? 'refund' : ''}">${title}</div>
      ${stamp ? `<div class="stamp">${stamp}</div>` : ''}
    </div>

    <hr class="rule" />

    <div class="meta"><span class="label">เลขที่ใบเสร็จ</span><span class="number">${escapeHtml(receipt.number)}</span></div>
    ${receipt.originalNumber ? `<div class="meta"><span class="label">อ้างอิงใบเดิม</span><span class="value">${escapeHtml(receipt.originalNumber)}</span></div>` : ''}
    <div class="meta"><span class="label">วันที่ / เวลา</span><span class="value">${escapeHtml(formatDateTime(receipt.issuedAt ?? new Date(), 'th'))}</span></div>
    <div class="meta"><span class="label">พนักงานขาย</span><span class="value">${escapeHtml(receipt.cashier ?? '')}</span></div>
    ${receipt.customer ? `<div class="meta"><span class="label">ลูกค้า</span><span class="value">${escapeHtml(receipt.customer.name ?? '')}</span></div>` : ''}

    <hr class="rule" />

    <table>
      <thead><tr><th>รายการ</th><th class="qty">จำนวน</th><th class="amt">รวม</th></tr></thead>
      <tbody>${items}</tbody>
    </table>

    <hr class="rule" />

    <div class="row"><span>ยอดรวมสินค้า</span><span class="num">${escapeHtml(amount(receipt.subtotalSatang ?? receipt.totalSatang))}</span></div>
    ${Number(receipt.discountSatang ?? 0) > 0 ? `<div class="row"><span>ส่วนลด</span><span class="num">-${escapeHtml(amount(receipt.discountSatang))}</span></div>` : ''}
    ${Number(receipt.pointsRedeemed ?? 0) > 0 ? `<div class="row"><span>ใช้คะแนน ${receipt.pointsRedeemed}</span><span class="num">${Number(receipt.pointsDiscountSatang ?? 0) > 0 ? `-${escapeHtml(amount(receipt.pointsDiscountSatang))}` : 'ในส่วนลด'}</span></div>` : ''}
    <div class="row"><span>ภาษีมูลค่าเพิ่ม ${vatPercent}% ${receipt.pricesIncludeTax === false ? '' : '(รวมในราคา)'}</span><span class="num">${escapeHtml(amount(receipt.taxSatang))}</span></div>
    <div class="row total"><span>ยอดสุทธิ</span><span class="num">${escapeHtml(amount(receipt.totalSatang))}</span></div>
    ${promotions ? `<div class="spacer"></div>${promotions}` : ''}

    <div class="spacer"></div>
    ${payments}
    ${Number(receipt.changeSatang ?? 0) > 0 ? `<div class="row change"><span>เงินทอน</span><span class="num">${escapeHtml(amount(receipt.changeSatang))}</span></div>` : ''}
    ${Number(receipt.loyaltyPoints ?? 0) > 0 ? `<div class="row"><span>คะแนนที่ได้รับ</span><span class="num">+${receipt.loyaltyPoints}</span></div>` : ''}
    ${receipt.reason ? `<hr class="rule-soft" /><div class="muted">เหตุผล: ${escapeHtml(receipt.reason)}</div>` : ''}

    <div class="footer">
      <div class="thanks">${escapeHtml(receipt.footer ?? 'ขอบคุณที่ใช้บริการ')}</div>
      <div class="fine">ใบเสร็จนี้เป็นหลักฐานการชำระเงิน<br/>สินค้าที่ซื้อแล้วสามารถเปลี่ยนหรือคืนได้ตามเงื่อนไขของร้าน</div>
      <div class="serial">${escapeHtml(receipt.number)} · ${escapeHtml(receipt.businessDate ?? '')} · NEXORA POS</div>
    </div>
    </div>
  </body></html>`;

  // Open the print window synchronously from the click. This keeps the user
  // gesture on iOS/Safari and gives a visible receipt page with its own print
  // button, even when the browser declines to open the print sheet itself.
  const win = window.open('', '_blank', 'width=460,height=780');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    let printed = false;
    const doPrint = () => {
      if (printed) return;
      printed = true;
      try {
        win.focus();
        win.print();
      } catch {
        // The visible toolbar button remains available.
      }
    };
    win.addEventListener('load', () => window.setTimeout(doPrint, 150));
    window.setTimeout(doPrint, 600);
    return;
  }

  // Popup blocked: fall back to a hidden iframe (desktop browsers).
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
