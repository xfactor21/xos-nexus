import { useEffect, useState } from 'react';
import Shell from './components/Shell';
import AuthGate from './modules/auth/AuthGate';
import Onboarding from './modules/onboarding/Onboarding';
import { useAuthStore } from './stores/authStore';
import { startSyncEngine } from './lib/offlineSync';

/** Step 1 ("Auth + Real Ownership"): the app now gates on a real Supabase
 * session before anything else. Order is loading → (signed-out: AuthGate) →
 * (signed-in: Onboarding, once per session, then Shell).
 *
 * Step 7 ("Onboarding — Persistent Launch + Returning-Captain Flow")
 * replaces the old placeholder `Boot` component (a minimal text-log boot
 * gate with no real state behind it) with the real flow: every sign-in
 * runs the Onboarding component, and it picks the full 12-scene cinematic
 * or the abbreviated Returning-Captain version based on the Captain's real,
 * persisted `has_completed_onboarding` flag (see authStore.markOnboardingComplete) —
 * not an in-memory toggle. */
function App() {
  const init = useAuthStore((s) => s.init);
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const markOnboardingComplete = useAuthStore((s) => s.markOnboardingComplete);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    init();
    // Step 8: no-ops outside the packaged Tauri shell (the web build has
    // no local SQLite runtime to queue into).
    startSyncEngine();
  }, [init]);

  // A new sign-in (different Captain, same tab) should re-run onboarding
  // rather than reuse the previous Captain's "seen it this session" state.
  useEffect(() => {
    setOnboardingDone(false);
  }, [user?.id]);

  if (status === 'loading') {
    return (
      <div id="authGate">
        <div className="logo">
          xOS <em>//</em> neXus
        </div>
      </div>
    );
  }

  if (status === 'signed-out') {
    return <AuthGate />;
  }

  if (!onboardingDone) {
    const isFirstEver = user?.user_metadata?.has_completed_onboarding !== true;
    return (
      <Onboarding
        mode={isFirstEver ? 'full' : 'returning'}
        onComplete={() => {
          setOnboardingDone(true);
          if (isFirstEver) void markOnboardingComplete();
        }}
      />
    );
  }

  return <Shell />;
}

export default App;
