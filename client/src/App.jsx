import { useEffect, useState } from 'react';
import Host from './pages/Host.jsx';

// Picks a page from the URL path. Plain links (<a href>) cause a full page load,
// which is all we need for a handful of pages (decision D12: no router library).
// M6 replaces the placeholder home page with the real one.
export default function App() {
  switch (window.location.pathname) {
    case '/host':
      return <Host />;
    default:
      return <PlaceholderHome />;
  }
}

function PlaceholderHome() {
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
      <p>
        <a href="/host">Host a game →</a>
      </p>
    </main>
  );
}
