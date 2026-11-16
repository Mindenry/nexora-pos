import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'ui_crash',
        message: error.message,
        componentStack: info.componentStack,
      }),
    );
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-6">
        <div className="max-w-md text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-jade text-sm font-bold text-white">
            N
          </span>
          <h1 className="mt-4 text-[22px] font-semibold tracking-tight">
            หน้าจอนี้เกิดข้อผิดพลาด
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            This screen failed to render. Your saved data is unaffected.
          </p>
          <pre className="mt-3 max-h-24 overflow-hidden rounded-lg border border-line bg-surface p-2 text-left text-[10px] text-faint">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              className="h-10 rounded-lg bg-jade px-4 text-sm font-medium text-white hover:bg-jade-hover"
            >
              โหลดหน้าใหม่ / Reload
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="h-10 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-text hover:bg-surface-2"
            >
              กลับหน้าหลัก / Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
