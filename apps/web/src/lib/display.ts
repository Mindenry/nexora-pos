export interface DisplayLine {
  name: string;
  qty: number;
  unitPriceSatang: number;
  totalSatang: number;
  imageUrl?: string;
}

interface BaseDisplayState {
  storeName: string;
  businessName: string;
  updatedAt: string;
}

export type DisplayState =
  | (BaseDisplayState & { kind: 'idle' })
  | (BaseDisplayState & {
      kind: 'cart';
      lines: DisplayLine[];
      itemCount: number;
      subtotalSatang: number;
      discountSatang: number;
      taxSatang: number;
      totalSatang: number;
      pricesIncludeTax: boolean;
      vatRateBp: number;
    })
  | (BaseDisplayState & {
      kind: 'paid';
      number: string;
      totalSatang: number;
      changeSatang: number;
    });

const CHANNEL_NAME = 'nexora-customer-display';
const STORAGE_KEY = 'nexora.display.state';
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export function publishDisplay(state: DistributiveOmit<DisplayState, 'updatedAt'>): void {
  const payload = { ...state, updatedAt: new Date().toISOString() } as DisplayState;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // The channel still delivers when storage is unavailable.
  }
  getChannel()?.postMessage(payload);
}

export function readDisplayState(): DisplayState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DisplayState) : null;
  } catch {
    return null;
  }
}

export function subscribeDisplay(onState: (state: DisplayState) => void): () => void {
  const ch = getChannel();
  const onMessage = (event: MessageEvent<DisplayState>) => onState(event.data);
  ch?.addEventListener('message', onMessage);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      onState(JSON.parse(event.newValue) as DisplayState);
    } catch {
      // Ignore malformed external writes.
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    ch?.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
  };
}
