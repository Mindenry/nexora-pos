const SOUND_KEY = 'nexora.pos.sound';

export function isSoundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== 'off';
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off');
}

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!context) context = new Ctor();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(frequency: number, durationMs: number, type: OscillatorType, gainValue: number): void {
  const audio = ensureContext();
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(gainValue, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + durationMs / 1000);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + durationMs / 1000);
}

export type FeedbackKind = 'success' | 'error' | 'scan';

export function feedback(kind: FeedbackKind): void {
  if (!isSoundEnabled()) {
    if (kind === 'success') navigator.vibrate?.(20);
    return;
  }
  if (kind === 'success') {
    tone(880, 70, 'sine', 0.045);
    navigator.vibrate?.(25);
  } else if (kind === 'scan') {
    tone(1174, 45, 'sine', 0.035);
  } else {
    tone(220, 180, 'square', 0.04);
    navigator.vibrate?.([40, 40, 40]);
  }
}
