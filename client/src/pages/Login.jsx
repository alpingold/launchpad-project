import { useState } from 'react';
import { signUp, logIn, logOut, useCurrentUser, safeNextPath } from '../net/auth.js';
import { usePageTitle } from '../usePageTitle.js';

// Log in or create a host account. Players never need this: they join with just a code.
export default function Login() {
  const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
  const user = useCurrentUser();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  usePageTitle(mode === 'login' ? 'Log in' : 'Create account');

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = mode === 'login' ? await logIn(username, password) : await signUp(username, password);
    if (result.ok) {
      window.location.assign(next);
      return;
    }
    setError(result.message ?? 'Something went wrong. Please try again.');
    setBusy(false);
  }

  async function handleLogOut() {
    await logOut();
    window.location.reload();
  }

  if (user === undefined) {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (user) {
    return (
      <main className="page">
        <h1>You're logged in</h1>
        <p>
          Logged in as <strong>{user.username}</strong>.
        </p>
        <p>
          <a className="primary-button" href={next}>
            Continue
          </a>{' '}
          <button type="button" className="secondary-button" onClick={handleLogOut}>
            Log out
          </button>
        </p>
      </main>
    );
  }

  const isLogin = mode === 'login';
  return (
    <main className="page auth">
      <h1>{isLogin ? 'Log in to host' : 'Create a host account'}</h1>
      <p className="muted">Only the host needs an account. Players join with a room code.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
          {!isLogin && <span className="muted small">3–20 letters, numbers, or underscores.</span>}
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
          />
          {!isLogin && <span className="muted small">At least 8 characters.</span>}
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={busy}>
          {isLogin ? 'Log in' : 'Create account'}
        </button>
      </form>

      <p>
        {isLogin ? 'No account yet? ' : 'Already have an account? '}
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(isLogin ? 'signup' : 'login');
            setError(null);
          }}
        >
          {isLogin ? 'Create one' : 'Log in'}
        </button>
      </p>
    </main>
  );
}
