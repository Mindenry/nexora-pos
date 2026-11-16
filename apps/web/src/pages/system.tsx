import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BadgeCheck,
  Clock,
  Database,
  HardDrive,
  RefreshCw,
  Server,
  TriangleAlert,
  Webhook,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useFormat } from '../lib/format';
import { useLang } from '../lib/i18n';
import { PageBody, PageHeader } from '../components/shell';
import { Badge, Button, Card, Skeleton, cn } from '../components/ui';

interface SystemHealth {
  status: 'ok' | 'warning' | 'critical';
  checkedAt: string;
  api: { uptimeSeconds: number; nodeVersion: string; memoryUsedBytes: number };
  database: { latencyMs: number; sizeBytes: number };
  counts: {
    pendingSessions: number;
    paidUnlinked: number;
    expiredSessions: number;
    rejectedWebhookEvents: number;
    promptPayAccounts: number;
    openShifts: number;
    salesToday: number;
    lowStockVariants: number;
  };
  integrations: {
    promptPay: {
      providerActive: boolean;
      autoConfirm: boolean;
      lastEventAt: string | null;
    };
  };
  checks: Array<{
    key: string;
    labelTh: string;
    labelEn: string;
    status: 'ok' | 'warning' | 'critical' | 'info';
    detail: string;
  }>;
}

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function duration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function SystemPage() {
  const { t } = useLang();
  const { dateTime, number } = useFormat();
  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api<SystemHealth>('/system/health'),
    refetchInterval: 30_000,
  });
  const data = health.data?.data;
  const status = data?.status ?? 'ok';

  return (
    <PageBody>
      <PageHeader
        title={t('สถานะระบบ', 'System health')}
        description={t(
          'ตรวจ API, ฐานข้อมูล, การชำระเงิน และคิวที่ต้องกระทบยอด',
          'Check API, database, payments and items that need reconciliation.',
        )}
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className={cn('h-4 w-4', health.isFetching && 'animate-spin')} />}
            onClick={() => void health.refetch()}
          >
            {t('ตรวจอีกครั้ง', 'Check again')}
          </Button>
        }
      />

      {health.isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Card
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 border-l-4 p-4',
              status === 'critical'
                ? 'border-l-danger bg-danger-soft/30'
                : status === 'warning'
                  ? 'border-l-amber bg-amber-soft/25'
                  : 'border-l-jade bg-jade-soft/20',
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-xl',
                  status === 'critical'
                    ? 'bg-danger-soft text-danger'
                    : status === 'warning'
                      ? 'bg-amber-soft text-amber'
                      : 'bg-jade-soft text-jade',
                )}
              >
                {status === 'ok' ? <BadgeCheck className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}
              </span>
              <div>
                <p className="text-[14px] font-semibold">
                  {status === 'critical'
                    ? t('มีรายการต้องแก้ไขทันที', 'Action required')
                    : status === 'warning'
                      ? t('ระบบทำงาน แต่มีรายการควรตรวจ', 'Running with warnings')
                      : t('ระบบปกติ', 'All systems operational')}
                </p>
                <p className="text-[11px] text-muted">
                  {t('ตรวจล่าสุด', 'Checked')} {dateTime(data.checkedAt)} · {data.api.nodeVersion}
                </p>
              </div>
            </div>
            <Badge tone={status === 'critical' ? 'danger' : status === 'warning' ? 'amber' : 'jade'} dot>
              {status.toUpperCase()}
            </Badge>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              icon={Server}
              label={t('API ทำงานต่อเนื่อง', 'API uptime')}
              value={duration(data.api.uptimeSeconds)}
              hint={`${bytes(data.api.memoryUsedBytes)} RSS`}
            />
            <Metric
              icon={Database}
              label={t('ฐานข้อมูล', 'Database')}
              value={`${data.database.latencyMs} ms`}
              hint={`${bytes(data.database.sizeBytes)}`}
            />
            <Metric
              icon={Clock}
              label={t('QR รอยืนยัน', 'Pending QR')}
              value={number(data.counts.pendingSessions)}
              hint={`${data.counts.openShifts} ${t('กะเปิด', 'open shifts')}`}
            />
            <Metric
              icon={HardDrive}
              label={t('รอตรวจกระทบยอด', 'Needs review')}
              value={number(data.counts.paidUnlinked)}
              hint={t('รับเงินแล้วแต่ยังไม่ผูกบิล', 'paid but not linked to a sale')}
              tone={data.counts.paidUnlinked > 0 ? 'danger' : 'jade'}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <Activity className="h-4 w-4 text-faint" />
                <p className="text-[12.5px] font-semibold">{t('รายการตรวจ', 'Health checks')}</p>
              </div>
              <div className="divide-y divide-line/70">
                {data.checks.map((check) => (
                  <div key={check.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div>
                      <p className="text-[12px] font-medium">{t(check.labelTh, check.labelEn)}</p>
                      <p className="text-[10.5px] text-faint">{check.detail}</p>
                    </div>
                    <Badge
                      tone={
                        check.status === 'critical'
                          ? 'danger'
                          : check.status === 'warning'
                            ? 'amber'
                            : check.status === 'info'
                              ? 'info'
                              : 'jade'
                      }
                      dot={check.status === 'critical' || check.status === 'warning'}
                    >
                      {check.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-faint" />
                <p className="text-[12.5px] font-semibold">{t('พร้อมเพย์', 'PromptPay')}</p>
              </div>
              <div className="mt-3 space-y-2 text-[11.5px]">
                <div className="flex justify-between">
                  <span className="text-muted">{t('บัญชีรับเงิน', 'Receiving accounts')}</span>
                  <span className="num font-medium">{data.counts.promptPayAccounts}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t('ผู้ให้บริการ', 'Provider')}</span>
                  <span className={data.integrations.promptPay.providerActive ? 'text-jade' : 'text-amber'}>
                    {data.integrations.promptPay.providerActive
                      ? t('เปิดใช้งาน', 'Active')
                      : t('ยังไม่เปิด', 'Inactive')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t('ยืนยันอัตโนมัติ', 'Auto-confirm')}</span>
                  <span>{data.integrations.promptPay.autoConfirm ? t('เปิด', 'On') : t('ปิด', 'Off')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t('Webhook ล่าสุด', 'Last event')}</span>
                  <span className="text-right">
                    {data.integrations.promptPay.lastEventAt
                      ? dateTime(data.integrations.promptPay.lastEventAt)
                      : '—'}
                  </span>
                </div>
              </div>
              <Link
                to="/promptpay"
                className="mt-3 flex h-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-[12px] font-medium text-text hover:border-jade-border"
              >
                {t('เปิดหน้าพร้อมเพย์', 'Open PromptPay')}
              </Link>
            </Card>
          </div>

          {data.counts.paidUnlinked > 0 ? (
            <Card className="border-danger/30 bg-danger-soft/20 p-4">
              <p className="text-[12px] font-semibold text-danger">
                {t('มีรายการรับเงินแล้วแต่ยังไม่ผูกบิล', 'Payments received but not linked to a sale')}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                {t(
                  'ควรตรวจในประวัติพร้อมเพย์และกระทบยอดหรือคืนเงินให้ถูกต้อง',
                  'Review PromptPay history and reconcile or refund these payments.',
                )}
              </p>
            </Card>
          ) : null}
        </div>
      )}
    </PageBody>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'jade',
}: {
  icon: typeof Server;
  label: string;
  value: string;
  hint: string;
  tone?: 'jade' | 'danger';
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-jade-soft text-jade',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-faint">{label}</p>
        <p className="num truncate text-[18px] font-semibold">{value}</p>
        <p className="truncate text-[10px] text-faint">{hint}</p>
      </div>
    </Card>
  );
}
