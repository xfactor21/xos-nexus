import type { ReactNode } from 'react';
import Icon from '../../../design-system/icons/Icon';

/**
 * Amendment v0.4 item 2 (New Project modal redesign) — Amendment v0.3
 * Section B's "Show More" utility tools all share one visual shell so 11+
 * small, genuinely-functional tools (QR generator, meme generator, palette
 * generator, …) don't each reinvent a topbar/exit-button/title, matching
 * the shape DrawPaint/Wireframe already use for their own topbars.
 */
export default function ToolShell({
  title,
  onExit,
  children,
  actions,
}: {
  title: string;
  onExit: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="toolShell">
      <div className="toolShellBar">
        <button className="chip" onClick={onExit}>
          <Icon name="chevronLeft" size={12} /> ALL BOARDS
        </button>
        <h3 className="toolShellTitle">{title}</h3>
        <div className="toolShellActions">{actions}</div>
      </div>
      <div className="toolShellBody">{children}</div>
    </div>
  );
}
