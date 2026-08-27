import { useCoreGraph } from '../stores/coreGraph';
import { pushToast } from '../stores/toastStore';

/** Shared by Settings' "DATA EXPORT" panel and the "Export data as JSON"
 * entry in the internal action registry (core/actionRegistry.ts), so it's
 * bindable from the command palette / a custom command instead of being
 * something you can only reach by scrolling to the bottom of Settings.
 * One real implementation instead of two copies that'd drift apart.
 * Non-hook accessor (`getState()`) so it can run from a plain `run()`
 * callback, not just from inside a React component body. */
export function exportGraphData(): void {
  const { nodes, edges, memories } = useCoreGraph.getState();
  const payload = { exportedAt: new Date().toISOString(), nodes, edges, memories };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xos-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  pushToast('Export downloaded.', 'success');
}
