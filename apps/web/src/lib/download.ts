import { getStoredStoreId } from './api';

export async function downloadFile(path: string, filename: string): Promise<void> {
  const storeId = getStoredStoreId();
  const response = await fetch(`/api${path}`, {
    headers: {
      'x-nexora-client': 'web',
      ...(storeId ? { 'x-store-id': storeId } : {}),
    },
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
