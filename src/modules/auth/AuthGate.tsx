import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuthStore } from '../../stores/authStore';

type Mode = 'signin' | 'signup' | 'magic';

/** AUTH GATE — Step 1 ("Auth + Real Ownership"). Blocks the app until a
 * Captain is signed in; every node this session writes from here on carries
 * a real owner_id instead of null. No prototype screen exists for this (the
 * HTML prototypes assume a signed-in Captain already), so it's built new —
 * matching #boot's full-screen centered treatment and the .bigbtn/token
 * vocabulary rather than inventing a different visual language. */
export default function AuthGate() {
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword);
  const signUpWithPassword = useAuthStore((s) => s.signUpWithPassword);
  const sendMagicLink = useAuthStore((s) => s.sendMagicLink);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError('Enter an email address.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'magic') {
        const { error } = await sendMagicLink(email.trim());
        if (error) setError(error);
        else setNotice(`◈ LINK SENT — check ${email.trim()} to sign in.`);
      } else if (mode === 'signin') {
        const { error } = await signInWithPassword(email.trim(), password);
        if (error) setError(error);
        // success: authStore's onAuthStateChange listener flips App past the gate
      } else {
        const { error, needsConfirmation } = await signUpWithPassword(email.trim(), password);
        if (error) setError(error);
        else if (needsConfirmation) setNotice(`◈ ACCOUNT CREATED — check ${email.trim()} to confirm, then sign in.`);
        // else: confirmation is off for this project, session started immediately
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="authGate">
      <div className="logo">
        xOS <em>//</em> neXus
      </div>
      <div className="tag">IDENTIFY YOURSELF, CAPTAIN</div>
      <form className="authcard" onSubmit={submit}>
        <div className="authtabs">
          {(['signin', 'signup', 'magic'] as Mode[]).map((m) => (
            <span
              key={m}
              className={`authtab ${mode === m ? 'on' : ''}`}
              onClick={() => {
                setMode(m);
                setError(null);
                setNotice(null);
              }}
            >
              {m === 'signin' ? 'SIGN IN' : m === 'signup' ? 'SIGN UP' : 'MAGIC LINK'}
            </span>
          ))}
        </div>

        <input
          className="authfield"
          type="email"
          autoComplete="email"
          placeholder="captain@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {mode !== 'magic' && (
          <input
            className="authfield"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}

        {error && <div className="autherr">⚠ {error}</div>}
        {notice && <div className="authok">{notice}</div>}

        <button className="bigbtn" type="submit" disabled={busy}>
          {busy ? 'WORKING…' : mode === 'signin' ? 'ENTER HEADQUARTERS ▸' : mode === 'signup' ? 'CREATE ACCOUNT ▸' : 'SEND MAGIC LINK ▸'}
        </button>

        <div className="authswitch">
          {mode === 'signin' ? (
            <>
              New here? <span onClick={() => setMode('signup')}>Create an account</span>
            </>
          ) : mode === 'signup' ? (
            <>
              Already have one? <span onClick={() => setMode('signin')}>Sign in</span>
            </>
          ) : (
            <>
              No password needed — we&apos;ll email you a one-tap link.
            </>
          )}
        </div>
      </form>
    </div>
  );
}
