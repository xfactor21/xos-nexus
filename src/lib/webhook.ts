import { isTauri } from './localDb';

export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface WebhookSpec {
  url: string;
  method: WebhookMethod;
  headers?: Record<string, string>;
  body?: string;
}

export interface WebhookResult {
  ok: boolean;
  status?: number;
  message: string;
}

/**
 * Fires a Custom Command's webhook (Settings > CUSTOM COMMANDS — see
 * stores/uiStore.ts's CustomCommand type and the command palette's wiring
 * of it). This is the "scripting hook" half of the Captain's ask: a
 * command-palette entry that reaches OUTSIDE xOS (Zapier, n8n, Discord,
 * a home-grown endpoint) instead of only running an internal action.
 *
 * Desktop: routed through the Rust process via the `fire_webhook` command
 * (src-tauri/src/lib.rs) — the same reqwest client Knowledge Matrix's
 * "ADD TO MATRIX" snapshot fetch already uses. Genuinely server-side, so
 * it isn't subject to browser CORS at all and method/headers/body are
 * honored exactly as configured, unlike a plugin-http shim would need
 * capability-scoped allowlisting for.
 *
 * Web build fallback: a plain browser `fetch`. That works for any receiver
 * that itself allows cross-origin requests (Discord/Slack incoming
 * webhooks, Zapier, n8n, and most custom endpoints do); one that doesn't
 * fails with a clear error surfaced as a toast by the caller, not a silent
 * no-op.
 */
export async function fireWebhook(spec: WebhookSpec): Promise<WebhookResult> {
  const url = spec.url.trim();
  if (!url) return { ok: false, message: 'No URL configured.' };

  try {
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{ status: number; body: string }>('fire_webhook', {
        req: {
          url,
          method: spec.method,
          headers: spec.headers && Object.keys(spec.headers).length ? spec.headers : null,
          body: spec.method === 'GET' ? null : (spec.body?.trim() || null),
        },
      });
      return { ok: res.status >= 200 && res.status < 300, status: res.status, message: `HTTP ${res.status}` };
    }
    const res = await fetch(url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.method === 'GET' ? undefined : spec.body,
    });
    return { ok: res.ok, status: res.status, message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Webhook request failed.' };
  }
}
