// The site's pages, chosen by the address: /, /screen (the Host's Screen), /play (a phone),
// signing in: /sign-in, /sign-in/confirm (the emailed link's page) and /sign-in/name, and the
// Creator's: /my/games and /my/games/<id>; the Library: /library and /library/<id>.
import "./pages/pages.css";
import { ConfirmPage } from "./pages/ConfirmPage.js";
import { HomePage } from "./pages/HomePage.js";
import { LibraryGamePage } from "./pages/LibraryGamePage.js";
import { LibraryPage } from "./pages/LibraryPage.js";
import { MyGamePage } from "./pages/MyGamePage.js";
import { MyGamesPage } from "./pages/MyGamesPage.js";
import { NamePage } from "./pages/NamePage.js";
import { PlayPage } from "./pages/PlayPage.js";
import { ScreenPage } from "./pages/ScreenPage.js";
import { SignInPage } from "./pages/SignInPage.js";

export function App({ path = typeof location === "undefined" ? "/" : location.pathname }: { path?: string }) {
  if (path.startsWith("/screen")) return <ScreenPage />;
  if (path.startsWith("/play")) return <PlayPage />;
  if (path === "/sign-in/confirm") return <ConfirmPage />;
  if (path === "/sign-in/name") return <NamePage />;
  if (path === "/sign-in") return <SignInPage />;
  if (path === "/my/games") return <MyGamesPage />;
  const game = /^\/my\/games\/([^/]+)$/.exec(path)?.[1];
  if (game !== undefined) return <MyGamePage id={decodeURIComponent(game)} />;
  if (path === "/library") return <LibraryPage />;
  const inLibrary = /^\/library\/([^/]+)$/.exec(path)?.[1];
  if (inLibrary !== undefined) return <LibraryGamePage id={decodeURIComponent(inLibrary)} />;
  return <HomePage />;
}
