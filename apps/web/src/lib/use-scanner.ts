import { useEffect, useRef } from 'react';

/**
 * Global barcode capture for hardware scanners that "type" into the page and
 * press Enter. It ignores real form fields, so manual typing is never hijacked.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const callback = useRef(onScan);
  callback.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let lastKeyAt = 0;

    const handler = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }

      const now = performance.now();
      if (now - lastKeyAt > 70) buffer = '';
      lastKeyAt = now;

      if (event.key === 'Enter') {
        if (buffer.length >= 4) {
          event.preventDefault();
          const code = buffer;
          buffer = '';
          callback.current(code);
        }
        return;
      }
      if (event.key.length === 1 && /[0-9A-Za-z._-]/.test(event.key)) {
        buffer += event.key;
        if (buffer.length > 80) buffer = buffer.slice(-80);
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled]);
}
