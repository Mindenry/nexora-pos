import { Badge } from './ui';
import { useLang } from '../lib/i18n';

const SALE_LABELS: Record<string, { th: string; en: string; tone: 'jade' | 'amber' | 'danger' | 'neutral' }> = {
  completed: { th: 'สำเร็จ', en: 'Completed', tone: 'jade' },
  partially_refunded: { th: 'คืนบางส่วน', en: 'Partially refunded', tone: 'amber' },
  refunded: { th: 'คืนแล้ว', en: 'Refunded', tone: 'amber' },
  voided: { th: 'ยกเลิก', en: 'Voided', tone: 'danger' },
  draft: { th: 'ฉบับร่าง', en: 'Draft', tone: 'neutral' },
};

export function SaleStatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const item = SALE_LABELS[status] ?? { th: status, en: status, tone: 'neutral' as const };
  return (
    <Badge tone={item.tone} dot>
      {t(item.th, item.en)}
    </Badge>
  );
}

const PURCHASE_LABELS: Record<string, { th: string; en: string; tone: 'jade' | 'amber' | 'danger' | 'neutral' | 'info' }> = {
  draft: { th: 'ฉบับร่าง', en: 'Draft', tone: 'neutral' },
  submitted: { th: 'รออนุมัติ', en: 'Submitted', tone: 'info' },
  approved: { th: 'อนุมัติแล้ว', en: 'Approved', tone: 'jade' },
  partially_received: { th: 'รับบางส่วน', en: 'Partially received', tone: 'amber' },
  received: { th: 'รับครบแล้ว', en: 'Received', tone: 'jade' },
  closed: { th: 'ปิดใบสั่งซื้อ', en: 'Closed', tone: 'neutral' },
  cancelled: { th: 'ยกเลิก', en: 'Cancelled', tone: 'danger' },
};

export function PurchaseStatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const item = PURCHASE_LABELS[status] ?? { th: status, en: status, tone: 'neutral' as const };
  return <Badge tone={item.tone}>{t(item.th, item.en)}</Badge>;
}

const TRANSFER_LABELS: Record<string, { th: string; en: string; tone: 'jade' | 'amber' | 'danger' | 'neutral' }> = {
  draft: { th: 'ฉบับร่าง', en: 'Draft', tone: 'neutral' },
  dispatched: { th: 'ส่งออกแล้ว', en: 'Dispatched', tone: 'amber' },
  received: { th: 'รับแล้ว', en: 'Received', tone: 'jade' },
  cancelled: { th: 'ยกเลิก', en: 'Cancelled', tone: 'danger' },
};

export function TransferStatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const item = TRANSFER_LABELS[status] ?? { th: status, en: status, tone: 'neutral' as const };
  return <Badge tone={item.tone}>{t(item.th, item.en)}</Badge>;
}

export function ShiftStatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  return status === 'open' ? (
    <Badge tone="jade" dot>
      {t('เปิดอยู่', 'Open')}
    </Badge>
  ) : (
    <Badge tone="neutral">{t('ปิดแล้ว', 'Closed')}</Badge>
  );
}
