import { useEffect, useState } from 'react';
import Boot from './components/Boot';
import Shell from './components/Shell';
import AuthGate from './modules/auth/AuthGate';
import { useAuthStore } from './stores/authStore';

/** Step 1 ("Auth + Real Ownership"): the app now gates on a real Supabase
 * session before anything else. Order is loading → (signed-out: AuthGate) →
 * (signed-in: Boot, once per session, then Shell) — Boot's "Welcome back,
 * Captain" line only makes sense once we actually know who's logged in. */
function App() {
  const init = useAuthStore((s) => s.init);
  const status = useAuthStore((s) => s.status);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

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

  return (
    <>
      {!booted && <Boot onDone={() => setBooted(true)} />}
      <Shell />
    </>
  );
}

export default App;
