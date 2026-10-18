import Home from './pages/Home.jsx';
import Host from './pages/Host.jsx';
import Join from './pages/Join.jsx';
import NotFound from './pages/NotFound.jsx';
import Login from './pages/Login.jsx';
import Admin from './pages/Admin.jsx';
import Kit from './pages/Kit.jsx';
import Games from './pages/Games.jsx';
import Create from './pages/Create.jsx';
import CreateGame from './pages/CreateGame.jsx';
import Account from './pages/Account.jsx';
import GamePage from './pages/GamePage.jsx';
import Profile from './pages/Profile.jsx';
import Report from './pages/Report.jsx';
import HomeLink from './components/HomeLink.jsx';
import SiteNav from './components/SiteNav.jsx';
import DemoBadge from './components/DemoBadge.jsx';
import SiteFooter from './components/SiteFooter.jsx';

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
      {/* The top of every page: home on the left (not on the home page itself), then the
          site's pages on the right (plan §16). */}
      <header className="site-header">
        {path !== '/' ? (
          <HomeLink />
        ) : (
          <span className="home-wordmark">
            BoilerGames <span className="demo-tag">(demo)</span>
          </span>
        )}
        <div className="site-header-right">
          <SiteNav />
        </div>
      </header>
      {pageFor(path)}
      <SiteFooter path={path} />
      <DemoBadge />
    </>
  );
}
