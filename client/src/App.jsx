import { lazy, Suspense } from 'react';
import Home from './pages/Home.jsx';
import Host from './pages/Host.jsx';
import Join from './pages/Join.jsx';
import NotFound from './pages/NotFound.jsx';
import Login from './pages/Login.jsx';
import Games from './pages/Games.jsx';
import GamePage from './pages/GamePage.jsx';
import Profile from './pages/Profile.jsx';
import Report from './pages/Report.jsx';
import HomeLink from './components/HomeLink.jsx';
import SiteNav from './components/SiteNav.jsx';
import DemoBadge from './components/DemoBadge.jsx';
import SiteFooter from './components/SiteFooter.jsx';

// Pages only some visitors open load when they're opened: a phone joining a game doesn't
// download the admin page or the game maker.
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Kit = lazy(() => import('./pages/Kit.jsx'));
const Create = lazy(() => import('./pages/Create.jsx'));
const CreateGame = lazy(() => import('./pages/CreateGame.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const Privacy = lazy(() => import('./pages/Privacy.jsx'));

// The site's pages, by URL path. Plain links (<a href>) do a full page load, which is all a
// handful of pages needs (decision D12: no router library). Adding a page = one line here.
const PAGES = {
  '/': Home,
  '/host': Host,
  '/join': Join,
  '/login': Login,
  '/admin': Admin,
  '/kit': Kit,
  '/games': Games,
  '/create': Create,
  '/account': Account,
  '/report': Report,
  '/privacy': Privacy,
};

/** "/join/" and "/join" are the same page. */
function currentPath() {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

/** Pages with a name in the address (plan §16, §19): /games/<id>, /u/<username> and /create/<id>. */
const PAGES_WITH_A_NAME = [
  [/^\/games\/([^/]+)$/, (name) => <GamePage id={name} />],
  [/^\/u\/([^/]+)$/, (name) => <Profile username={name} />],
  [/^\/create\/([^/]+)$/, (name) => <CreateGame id={name} />],
];

/** The page for this address. */
function pageFor(path) {
  if (Object.hasOwn(PAGES, path)) {
    const Page = PAGES[path];
    return <Page />;
  }
  for (const [pattern, page] of PAGES_WITH_A_NAME) {
    const match = pattern.exec(path);
    if (match) {
      try {
        return page(decodeURIComponent(match[1]));
      } catch {
        break; // a broken %-escape: not a page
      }
    }
  }
  return <NotFound />;
}

export default function App() {
  const path = currentPath();
  return (
    <>
      {/* The top of every page: the site's name on the left (the link home, except on the
          home page itself), then the site's pages on the right (plan §16, §42). */}
      <header className="site-header">
        <HomeLink home={path === '/'} />
        <div className="site-header-right">
          <SiteNav />
        </div>
      </header>
      <Suspense fallback={<main className="page" aria-busy="true" />}>{pageFor(path)}</Suspense>
      <SiteFooter path={path} />
      <DemoBadge />
    </>
  );
}
