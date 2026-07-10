import { createClient } from '@supabase/supabase-js';

/**
 * Supabase JS client — singleton (Engineering Bible: "Supabase JS client
 * as a singleton"). Values come from the deployed project referenced in
 * the handoff doc (`hkfasnoxhowjjfpnnvqb`) and match the public anon key
 * already embedded in xos-prototype.html's liveClassify() call — these
 * are safe to ship client-side. Override via .env for other environments.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://hkfasnoxhowjjfpnnvqb.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_vBzvJRy-DPCwCSr8-BW5OQ_RTvhqnSY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
