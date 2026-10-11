import { useEffect, useState } from 'react';

// M0 placeholder: proves the client can reach the server through the Vite proxy.
// Real pages (Home, Host, Join, Login) replace this in later milestones.
export default function App() {
  const [status, setStatus] = useState('checking…');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.ok ? 'server is up ✅' : 'unexpected reply'))
      .catch(() => setStatus('server unreachable ❌ (is `npm run dev:server` running?)'));
  }, []);

  return (
    <main className="page">
      <h1>LaunchPad Party</h1>
      <p>Status: {status}</p>
    </main>
  );
}
