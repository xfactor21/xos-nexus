import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * authStore — Step 1 of the handoff ("Auth + Real Ownership").
 *
 * Wraps Supabase Auth (email/password + magic link, per the handoff's "email
 * or magic link — simplest for a solo Captain to start"). Every room that
 * needs the current user's id (to stamp owner_id, or to scope a Supabase
 * query) reads it from here rather than threading it through props — this
 * mirrors how coreGraph is the one place rooms read domain data from.
 */

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthState {
  session: Session | null;
  user: User | null;
  status: AuthStatus;
  init: () => void;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  sendMagicLink: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

let initialized = false;

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  status: 'loading',

  /** Idempotent — safe to call from multiple components; only wires the
   * listener once per page load. */
  init: () => {
    if (initialized) return;
    initialized = true;

    supabase.auth.getSession().then(({ data }) => {
      set({
        session: data.session,
        user: data.session?.user ?? null,
        status: data.session ? 'signed-in' : 'signed-out',
      });
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        user: session?.user ?? null,
        status: session ? 'signed-in' : 'signed-out',
      });
    });
  },

  signInWithPassword: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },

  signUpWithPassword: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    // Supabase returns a user with an empty identities array (no error) when
    // "Confirm email" is on and the address already has a pending signup —
    // surface that distinctly so the UI doesn't just say "check your email"
    // for what's actually an existing account.
    const needsConfirmation = !error && !data.session;
    return { error: error?.message ?? null, needsConfirmation };
  },

  sendMagicLink: async (email) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
  },
}));
