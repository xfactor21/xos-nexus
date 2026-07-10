import { useEffect } from 'react';
import { useUiStore } from '../stores/uiStore';
import { ROOMS, ROOM_NAME, DOCK_CONTENT } from '../core/rooms';
import RoomOutlet from './RoomOutlet';

/** App chrome — ported 1:1 from xos-prototype.html's #hud/#sb/#dock markup
 * and body.sb / body.nodock toggle classes. */
export default function Shell() {
  const room = useUiStore((s) => s.room);
  const go = useUiStore((s) => s.go);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const dockOpen = useUiStore((s) => s.dockOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const toggleDock = useUiStore((s) => s.toggleDock);

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
    const onGo = (e: Event) => go((e as CustomEvent).detail);
    window.addEventListener('xos-go', onGo);
    return () => window.removeEventListener('xos-go', onGo);
  }, [go]);

  const flow = ROOMS.filter((r) => r.section === 'FLOW');
  const systems = ROOMS.filter((r) => r.section === 'SYSTEMS');
  const dock = DOCK_CONTENT[room];

  return (
    <>
      {/* HUD */}
      <div id="hud">
        <button id="menuBtn" onClick={toggleSidebar}>☰</button>
        <span className="brand">
          xOS<em>//</em>
        </span>
        <span id="roomName">{ROOM_NAME[room]}</span>
        <span className="pill">v0.5.0 · SPRINT 002</span>
      </div>

      {/* SIDEBAR */}
      <div id="sbShade" onClick={closeSidebar} />
      <nav id="sb">
        <div className="sec">FLOW</div>
        {flow.map((r) => (
          <div key={r.id} className={`nav ${room === r.id ? 'on' : ''}`} onClick={() => go(r.id)}>
            <span className="ic">{r.icon}</span>
            {r.name}
          </div>
        ))}
        <div className="sec">SYSTEMS</div>
        {systems.map((r) => (
          <div key={r.id} className={`nav ${room === r.id ? 'on' : ''}`} onClick={() => go(r.id)}>
            <span className="ic">{r.icon}</span>
            {r.name}
          </div>
        ))}
      </nav>

      {/* xAI DOCK */}
      <button id="tgDock" onClick={toggleDock}>◈</button>
      <div id="dock">
        <h3 onClick={() => useUiStore.setState({ dockOpen: false })}>
          ◈ xAI <span>▾</span>
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
    </>
  );
}
