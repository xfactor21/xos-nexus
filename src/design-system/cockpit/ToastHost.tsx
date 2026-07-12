import { useToastStore } from '../../stores/toastStore';
import Icon from '../icons/Icon';

/** Mounted once in Shell.tsx — renders whatever's currently in the shared
 * toast store. Positioned above the bottom status bar, left-aligned so it
 * doesn't compete with the xAI hologram's bottom-right corner. */
export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (!toasts.length) return null;
  return (
    <div className="toastHost">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          <Icon name={t.kind === 'warn' ? 'warning' : t.kind === 'success' ? 'check' : 'xai'} size={13} glow={t.kind === 'warn' ? 'amber' : t.kind === 'success' ? 'cyan' : 'cyan'} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
