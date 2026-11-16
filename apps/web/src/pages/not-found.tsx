import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { useLang } from '../lib/i18n';

export function NotFoundPage() {
  const { t } = useLang();
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface text-faint">
          <Compass className="h-6 w-6" />
        </div>
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-jade">404</p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-tight">
          {t('ไม่พบหน้าที่คุณกำลังหา', 'This page does not exist')}
        </h1>
        <p className="mt-2 text-[13px] text-muted">
          {t('ลิงก์อาจถูกย้าย หรือคุณไม่มีสิทธิ์เข้าถึง', 'The link may have moved, or you may not have access.')}
        </p>
        <Link
          to="/"
          className="mt-5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-jade hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('กลับหน้าหลัก', 'Back to home')}
        </Link>
      </div>
    </div>
  );
}
