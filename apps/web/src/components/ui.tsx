import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Search,
  X,
  XCircle,
} from 'lucide-react';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ── Button ──────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-jade text-white border border-transparent hover:bg-jade-hover active:translate-y-px shadow-sm',
  secondary:
    'bg-surface text-text border border-line hover:bg-surface-2 hover:border-line-strong active:translate-y-px',
  outline:
    'bg-transparent text-text border border-line-strong hover:bg-surface-2 active:translate-y-px',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-surface-3 hover:text-text',
  danger: 'bg-danger text-white border border-transparent hover:opacity-90 active:translate-y-px',
  subtle: 'bg-jade-soft text-jade border border-jade-border hover:bg-jade-soft/80',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-5 text-[15px] gap-2.5 rounded-xl',
  icon: 'h-10 w-10 justify-center rounded-lg',
  'icon-sm': 'h-8 w-8 justify-center rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export function Button({
  className,
  variant = 'secondary',
  size = 'md',
  loading,
  leftIcon,
  rightIcon,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

// ── Form primitives ──────────────────────────────────────────────────────────
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="flex items-center gap-1 text-[13px] font-medium text-text">
          {label}
          {required ? <span className="text-danger">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[12px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

const controlBase =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm text-text placeholder:text-faint ' +
  'transition-[border-color,box-shadow] hover:border-line-strong focus:border-jade focus:outline-none ' +
  '[&:focus]:shadow-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leadingIcon, invalid, ...props },
  ref,
) {
  return (
    <div className="relative">
      {leadingIcon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
          {leadingIcon}
        </span>
      ) : null}
      <input
        ref={ref}
        className={cn(
          controlBase,
          'h-10',
          leadingIcon && 'pl-9',
          invalid && 'border-danger focus:border-danger [&:focus]:shadow-[0_0_0_3px_rgb(179_38_30_/_0.18)]',
          className,
        )}
        aria-invalid={invalid || undefined}
        {...props}
      />
    </div>
  );
});

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={cn(controlBase, 'h-10 cursor-pointer pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlBase, 'min-h-20 py-2', className)} {...props} />;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3', disabled && 'opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors',
          checked ? 'border-jade bg-jade' : 'border-line-strong bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-[left]',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label ? <span className="block text-sm font-medium text-text">{label}</span> : null}
          {description ? <span className="block text-[12px] text-muted">{description}</span> : null}
        </span>
      )}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(controlBase, 'h-10 pl-9 pr-8')}
        type="search"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-text"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

// ── Surfaces ────────────────────────────────────────────────────────────────
export function Card({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface card-shadow', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pb-3 pt-5', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-text">{title}</h3>
        {description ? <p className="mt-0.5 text-[12px] text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

type BadgeTone = 'neutral' | 'jade' | 'amber' | 'danger' | 'info' | 'violet';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-muted border-line',
  jade: 'bg-jade-soft text-jade border-jade-border',
  amber: 'bg-amber-soft text-amber border-amber/25',
  danger: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-info-soft text-info border-info/20',
  violet: 'bg-violet/10 text-violet border-violet/20',
};

export function Badge({
  children,
  tone = 'neutral',
  dot,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px] font-medium leading-5',
        badgeTones[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

// ── Modal / Drawer ──────────────────────────────────────────────────────────
function useDialogBehavior(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      const target =
        panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
        panelRef.current?.querySelector<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        );
      target?.focus();
    }, 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
      previouslyFocused?.focus?.();
    };
    // Deliberately only re-run when the dialog opens/closes. Depending on
    // onClose (usually an inline function) restarted the focus trap on every
    // keystroke and stole focus from the field being typed into.
  }, [open]);
  return panelRef;
}

const modalSizes = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeLabel = 'Close',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof modalSizes;
  closeLabel?: string;
}) {
  const panelRef = useDialogBehavior(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface overlay-shadow sm:rounded-2xl',
          modalSizes[size],
        )}
      >
        {title ? (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id={titleId} className="text-[16px] font-semibold text-text">
                {title}
              </h2>
              {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-3 hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panelRef = useDialogBehavior(open, onClose);
  const titleId = useId();
  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          'relative z-10 flex h-full w-full flex-col border-l border-line bg-surface overlay-shadow',
          widths[width],
        )}
      >
        {title ? (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id={titleId} className="text-[16px] font-semibold">
                {title}
              </h2>
              {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-faint hover:bg-surface-3 hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{description}</div>
    </Modal>
  );
}

// ── Tabs / Empty / Skeleton ─────────────────────────────────────────────────
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: ReactNode; count?: number }>;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-line', className)} role="tablist">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
              active
                ? 'border-jade text-text'
                : 'border-transparent text-muted hover:border-line-strong hover:text-text',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="num rounded bg-surface-3 px-1.5 py-0.5 text-[10.5px] text-muted">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-faint">
        {icon ?? <Info className="h-5 w-5" />}
      </div>
      <p className="text-sm font-medium text-text">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[12.5px] text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-3', className)} />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export function TH({
  children,
  className,
  align = 'left',
}: {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-line bg-surface-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
  align = 'left',
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'border-b border-line/70 px-4 py-3 align-middle text-text',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function TR({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn('transition-colors hover:bg-surface-2/80', onClick && 'cursor-pointer', className)}
    >
      {children}
    </tr>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
  labels,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
  labels?: { previous: string; next: string; of: string };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[12px] text-muted">
      <span className="num">
        {total} {labels?.of ?? 'records'}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={labels?.previous ?? 'Previous'}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="num px-2 tabular-nums">
          {page} / {Math.max(1, totalPages)}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label={labels?.next ?? 'Next'}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Toasts ──────────────────────────────────────────────────────────────────
type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const toastIcons: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-jade" />,
  error: <XCircle className="h-4 w-4 text-danger" />,
  info: <Info className="h-4 w-4 text-info" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((prev) => [...prev.slice(-4), { id, title, description, tone }]);
      window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const apiValue = useMemo<ToastApi>(
    () => ({
      success: (title, description) => push('success', title, description),
      error: (title, description) => push('error', title, description),
      info: (title, description) => push('info', title, description),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={apiValue}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed right-4 top-16 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3 elevated"
            >
              <span className="mt-0.5">{toastIcons[toast.tone]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-[12px] text-muted">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded p-0.5 text-faint hover:text-text"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-jade', className)} />;
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded border transition-colors',
          checked ? 'border-jade bg-jade text-white' : 'border-line-strong bg-surface',
        )}
      >
        {checked ? <Check className="h-3 w-3" /> : null}
      </button>
      {label}
    </label>
  );
}

export function InlineAlert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'border-info/20 bg-info-soft text-info',
    warning: 'border-amber/25 bg-amber-soft text-amber',
    danger: 'border-danger/20 bg-danger-soft text-danger',
  };
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border p-3 text-[12.5px]', tones[tone])}>
      {tone === 'warning' ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : tone === 'danger' ? (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div>
        {title ? <p className="font-medium">{title}</p> : null}
        <div className="opacity-90">{children}</div>
      </div>
    </div>
  );
}
