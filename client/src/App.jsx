import Home from './pages/Home.jsx';
import Host from './pages/Host.jsx';
import Join from './pages/Join.jsx';
import NotFound from './pages/NotFound.jsx';
import Login from './pages/Login.jsx';
import Admin from './pages/Admin.jsx';
import { SettingsProvider } from './settings/SettingsContext.jsx';
import SettingsMenu from './settings/SettingsMenu.jsx';

// The site's pages, by URL path. Plain links (<a href>) do a full page load, which is all a
// handful of pages needs (decision D12: no router library). Adding a page = one line here.
const PAGES = {
  '/': Home,
  '/host': Host,
  '/join': Join,
  '/login': Login,
  '/admin': Admin,
};

/** "/join/" and "/join" are the same page. */
function currentPath() {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

export default function App() {
  const path = currentPath();
  const Page = Object.hasOwn(PAGES, path) ? PAGES[path] : NotFound;
  return (
    <SettingsProvider>
      <SettingsMenu />
      <Page />
    </SettingsProvider>
  );
}
