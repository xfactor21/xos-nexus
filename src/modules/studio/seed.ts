import type { StudioSnapshot } from './types';

export const SEED_STUDIO: StudioSnapshot = {
  items: [
    { id: 'it-1', type: 'frame', name: 'SPLASH — v2', x: 320, y: 200, w: 230, h: 300, visible: true, variant: 'splash' },
    { id: 'it-2', type: 'frame', name: 'ONBOARDING 01', x: 600, y: 240, w: 230, h: 260, visible: true, variant: 'onboarding' },
    { id: 'it-3', type: 'mood', name: 'DEEP / NEON', x: 920, y: 190, w: 150, h: 110, visible: true, bg: 'linear-gradient(135deg,#05080D,#0B2830)', fg: 'var(--cyan)' },
    { id: 'it-4', type: 'mood', name: 'VIOLET HAZE', x: 1090, y: 230, w: 150, h: 110, visible: true, bg: 'linear-gradient(135deg,#1a0b2e,#3b1f6e)', fg: '#c9b6ff' },
    { id: 'it-5', type: 'stickyM', name: 'Bee mascot idea', x: 330, y: 580, w: 170, h: 100, visible: true, text: 'Bee mascot should FLY between onboarding steps' },
    { id: 'it-6', type: 'sticky', name: 'Logo glow note', x: 540, y: 620, w: 170, h: 100, visible: true, text: 'Logo glow state for dark mode — routed here by the Core' },
  ],
  arrows: [],
  ink: [],
  comments: [],
  links: [],
  components: [],
};
