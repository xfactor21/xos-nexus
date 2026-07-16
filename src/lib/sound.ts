import { useUiStore } from '../stores/uiStore';

/**
 * Sound design — synthesized UI audio via the Web Audio API. Deliberately
 * NOT sourced audio files: no royalty-free sample library is available in
 * this environment, and shipping unlicensed audio assets would be a real
 * problem, not just a shortcut. Every sound here is a couple of oscillators
 * with a short gain envelope — cheap, tiny (zero asset weight), and easy to
 * keep consistent with the cockpit's glow-not-noise aesthetic (soft sine
 * tones, nothing harsh, nothing that runs longer than ~300ms).
 *
 * Respects the Settings > Sound toggle and volume (see uiStore) and stays
 * completely silent until the user's first interaction, per browser
 * autoplay policy — the AudioContext is created lazily on first playSound()
 * call, not at module load.
 */
export type SoundName = 'capture' | 'notice' | 'error' | 'toast' | 'toast-warn' | 'xai' | 'nav';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One short tone: sine (or square for the error buzz) with a quick
 * attack/decay envelope so nothing clicks or lingers. */
function tone(c: AudioContext, freq: number, startAt: number, duration: number, gain: number, type: OscillatorType = 'sine') {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  g.gain.setValueAtTime(0, startAt);
  g.gain.linearRampToValueAtTime(gain, startAt + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

export function playSound(name: SoundName) {
  const { soundEnabled, soundVolume } = useUiStore.getState();
  if (!soundEnabled || soundVolume <= 0) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  const v = soundVolume;
  switch (name) {
    case 'capture':
      // Soft ascending two-note confirm — "logged."
      tone(c, 660, t, 0.14, 0.09 * v);
      tone(c, 880, t + 0.09, 0.16, 0.08 * v);
      break;
    case 'notice':
      tone(c, 440, t, 0.18, 0.07 * v);
      break;
    case 'error':
      tone(c, 220, t, 0.22, 0.08 * v, 'square');
      break;
    case 'toast':
      tone(c, 880, t, 0.08, 0.045 * v);
      break;
    case 'toast-warn':
      tone(c, 523, t, 0.1, 0.055 * v, 'triangle');
      break;
    case 'xai':
      // Shimmering two-oscillator chime — the hologram arriving on its own.
      tone(c, 523, t, 0.22, 0.06 * v);
      tone(c, 784, t + 0.03, 0.26, 0.05 * v);
      break;
    case 'nav':
      tone(c, 1046, t, 0.05, 0.03 * v);
      break;
  }
}
