import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { useCoreGraph } from '../stores/coreGraph';
import { ROOMS, ROOM_NAME, DOCK_CONTENT } from '../core/rooms';
import RoomOutlet from './RoomOutlet';
import Icon from '../design-system/icons/Icon';
import CockpitFrame from '../design-system/cockpit/CockpitFrame';
import GlobalParticles from '../design-system/cockpit/GlobalParticles';
import XaiCharacter from '../design-system/cockpit/XaiCharacter';
import { XAIProvider } from '../design-system/cockpit/xai/xAIController-FINAL';
import ToastHost from '../design-system/cockpit/ToastHost';
import CommandPalette from '../design-system/cockpit/CommandPalette';
import { playSound } from '../lib/sound';
import ShortcutsOverlay from '../design-system/cockpit/ShortcutsOverlay';

/** App chrome — ported 1:1 from xos-prototype.html's #hud/#sb/#dock markup
 * and body.sb / body.nodock toggle classes. Also where Step 3's "populated
 * from Supabase, subscribed to Realtime" wiring kicks off — Shell only
 * mounts once a Captain is signed in (see App.tsx), so it's the right place
 * to hydrate coreGraph and open the Realtime subscription for their id. */
export default function Shell() {
  const room = useUiStore((s) => s.room);
  const go = useUiStore((s) => s.go);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const dockOpen = useUiStore((s) => s.dockOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const userId = useAuthStore((s) => s.user?.id);

  // Forces one extra render post-mount so the spine's active-room glow
  // (measured off nav item refs) is correctly positioned from first paint,
  // not just top:0 until some other state change happens to re-render.
  const [, forceSpineLayout] = useState(0);
  useEffect(() => {
    forceSpineLayout((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!userId) return;
    const { hydrate, subscribe, reset } = useCoreGraph.getState();
    hydrate(userId);
    const unsubscribe = subscribe(userId);
    return () => {
      unsubscribe();
      reset();
    };
  }, [userId]);

  useEffect(() => {
    document.body.classList.toggle('sb', sidebarOpen);
  }, [sidebarOpen]);
  useEffect(() => {
    document.body.classList.toggle('nodock', !dockOpen);
  }, [dockOpen]);

  // Neural Core's radial nodes are plain DOM (built outside React, like the
  // prototype's mkNode()) so they navigate by dispatching this event rather
  // than a prop callback.
  useEffect(() => {
    const onGo = (e: Event) => {
      playSound('nav');
      go((e as CustomEvent).detail);
    };
    window.addEventListener('xos-go', onGo);
    return () => window.removeEventListener('xos-go', onGo);
  }, [go]);

  // Amendment v0.6 step 4: real depth via a light-source spotlight. Rather
  // than attaching a pointermove listener to every .gpanel/.card/.cap/.mem/
  // .rel in the app (dozens of instances across 9 rooms), one delegated
  // listener here walks up to the nearest light-catching ancestor and writes
  // the cursor position into --mx/--my as a plain DOM mutation (no React
  // state, no re-render) — design-system.css reads those vars to position a
  // radial-gradient highlight, so the glow reads as light hitting a surface
  // from wherever the cursor is, instead of a flat colored border.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const el = (e.target as HTMLElement | null)?.closest?.('.gpanel, .card, .cap, .mem, .rel') as HTMLElement | null;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      el.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
      el.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
    }
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const flow = ROOMS.filter((r) => r.section === 'FLOW');
  const systems = ROOMS.filter((r) => r.section === 'SYSTEMS');
  const dock = DOCK_CONTENT[room];

  // Amendment v0.6 step 2: "neural spine" sidebar — icons sit on a glowing
  // vertical line instead of a plain list row. A pulse travels along the
  // line to whichever icon is hovered (real, ref-measured Y position, not a
  // static glow), and the active room's icon breathes brighter than the
  // rest. Each section (FLOW/SYSTEMS) gets its own spine segment since a
  // single line can't sensibly run through the section-label text between
  // them.
  const navRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pulseTarget, setPulseTarget] = useState<{ section: 'flow' | 'systems'; y: number } | null>(null);

  function trackSpine(id: string, section: 'flow' | 'systems') {
    const el = navRefs.current[id];
    const parent = el?.parentElement;
    if (el && parent) {
      setPulseTarget({ section, y: el.offsetTop + el.offsetHeight / 2 - parent.offsetTop });
    }
  }
  function clearSpine() {
    setPulseTarget(null);
  }

  function renderSpineSection(rooms: typeof flow, sectionLabel: string, sectionKey: 'flow' | 'systems') {
    const activeIdx = rooms.findIndex((r) => r.id === room);
    return (
      <div className="spineSection">
        <div className="sec">{sectionLabel}</div>
        <div className="spineTrack">
          <div className="spineLine" />
          {pulseTarget?.section === sectionKey && (
            <div className="spinePulse" style={{ top: pulseTarget.y }} />
          )}
          {activeIdx >= 0 && (
            <div
              className="spineActiveGlow"
              style={{ top: (navRefs.current[rooms[activeIdx].id]?.offsetTop ?? 0) + (navRefs.current[rooms[activeIdx].id]?.offsetHeight ?? 0) / 2 }}
            />
          )}
          {rooms.map((r) => (
            <div
              key={r.id}
              ref={(el) => {
                navRefs.current[r.id] = el;
              }}
              className={`nav ${room === r.id ? 'on' : ''}`}
              onClick={() => {
                playSound('nav');
                go(r.id);
              }}
              onMouseEnter={() => trackSpine(r.id, sectionKey)}
              onMouseLeave={clearSpine}
            >
              <span className={`ic ${room === r.id ? 'breathe' : ''}`}>
                <Icon name={r.icon} size={16} glow={room === r.id ? 'cyan' : 'none'} />
              </span>
              <span className="navLabel">{r.name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    // Amendment v1.0: wraps the persistent layout shell (renders in every
    // room) in XAIProvider so any descendant can call useXAI()/setAiStatus()
    // — XaiCharacter's trigger bridge is the first consumer, below.
    <XAIProvider>
      <GlobalParticles />
      <CockpitFrame />

      {/* HUD */}
      <div id="hud">
        <button id="menuBtn" onClick={toggleSidebar}>
          <Icon name="menu" size={18} />
        </button>
        <span className="brand">
          xOS<em>//</em>
        </span>
        <span id="roomName">{ROOM_NAME[room]}</span>
        <span className="pill">v0.5.0 · SPRINT 002</span>
      </div>

      {/* SIDEBAR — "neural spine": icons on a glowing vertical line, not a
          plain list. Collapsed (default) shows icon-dots only; expanded
          (toggled via #menuBtn) adds labels beside them. */}
      <div id="sbShade" onClick={closeSidebar} />
      <nav id="sb">
        {renderSpineSection(flow, 'FLOW', 'flow')}
        {renderSpineSection(systems, 'SYSTEMS', 'systems')}
      </nav>

      {/* xAI DOCK */}
      <button id="tgDock" onClick={toggleDock}>
        <Icon name="xai" size={16} glow="cyan" />
      </button>
      <div id="dock">
        <h3 onClick={() => useUiStore.setState({ dockOpen: false })}>
          <Icon name="xai" size={13} glow="cyan" /> xAI <span><Icon name="chevronDown" size={12} /></span>
        </h3>
        <div id="dockBody">
          {dock?.map((d, i) => (
            <p key={i}>
              {d.tip ? <b>{d.tip}</b> : null}
              {d.body}
            </p>
          ))}
        </div>
      </div>

      <RoomOutlet />

      {/* Bottom status bar — cockpit redesign: emits light upward per the
          brief, mirrors #hud's role at the opposite edge of the frame. */}
      <div id="status">
        <span className="sy"><span className="dot" style={{ background: 'var(--mg)', boxShadow: '0 0 18px var(--mg), 0 0 40px rgba(255,45,120,.5)' }} /> CORE: NOMINAL</span>
        <span className="sy"><span className="dot" style={{ background: 'var(--cy)', boxShadow: '0 0 18px var(--cy), 0 0 40px rgba(0,245,255,.5)' }} /> SYNC: LIVE</span>
      </div>

      {/* xAI character — persistent, autonomous, face-expressive presence,
          every room, outside the right wing (#dock). Fixed position so it
          survives room swaps. Amendment v1.0: real character (Canvas +
          XAIAuto) replacing the old gyroscope-orb hologram and its floating
          caption popup, both fully removed. */}
      <XaiCharacter />

      {/* OS-grade universal directives: reusable toasts, Cmd/Ctrl+K command
          palette, `?` keyboard shortcuts overlay — all global, all mounted
          once here so they work identically from every room. */}
      <ToastHost />
      <CommandPalette />
      <ShortcutsOverlay />
    </XAIProvider>
  );
}
