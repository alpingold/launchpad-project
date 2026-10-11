import { usePageTitle } from '../usePageTitle.js';

export default function NotFound() {
  usePageTitle('Page not found');
  return (
    <main className="page">
      <h1>Page not found</h1>
      <p>There's nothing at this address.</p>
      <p>
        <a href="/">Go to the home page</a>
      </p>
    </main>
  );
}
