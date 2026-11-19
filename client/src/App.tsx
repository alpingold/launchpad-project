// The site's pages, chosen by the address: /, /screen (the Host's Screen), /play (a phone),
// signing in: /sign-in, /sign-in/confirm (the emailed link's page) and /sign-in/name, and the
// Creator's: /my/games, /my/games/<id> and /make (writing a Game with any AI); the site's own AI
// maker: /make/ai (an idea), /my/generations/<id> (its Concept and Track), /my/genai-key; the Library:
// /library and /library/<id>; /privacy. Every page has the privacy page's link at its foot.
import "./pages/pages.css";
import { AiMakePage } from "./pages/AiMakePage.js";
import { ConfirmPage } from "./pages/ConfirmPage.js";
import { GenerationPage } from "./pages/GenerationPage.js";
import { HomePage } from "./pages/HomePage.js";
import { KeyPage } from "./pages/KeyPage.js";
import { LibraryGamePage } from "./pages/LibraryGamePage.js";
import { LibraryPage } from "./pages/LibraryPage.js";
import { MakePage } from "./pages/MakePage.js";
import { MyGamePage } from "./pages/MyGamePage.js";
import { MyGamesPage } from "./pages/MyGamesPage.js";
import { NamePage } from "./pages/NamePage.js";
import { PlayPage } from "./pages/PlayPage.js";
import { PrivacyPage, SiteFoot } from "./pages/PrivacyPage.js";
import { ScreenPage } from "./pages/ScreenPage.js";
import { SignInPage } from "./pages/SignInPage.js";

export function App({ path = typeof location === "undefined" ? "/" : location.pathname }: { path?: string }) {
  // The Screen and a phone are filled by a Match while one is on: their own Lobby and join pages
  // carry the foot themselves. Every other page gets it here.
  if (path.startsWith("/screen")) return <ScreenPage />;
  if (path.startsWith("/play")) return <PlayPage />;
  return (
    <>
      <Page path={path} />
      <SiteFoot />
    </>
  );
}

function Page({ path }: { path: string }) {
  if (path === "/sign-in/confirm") return <ConfirmPage />;
  if (path === "/sign-in/name") return <NamePage />;
  if (path === "/sign-in") return <SignInPage />;
  if (path === "/my/games") return <MyGamesPage />;
  if (path === "/make") return <MakePage />;
  if (path === "/make/ai") return <AiMakePage />;
  const made = /^\/my\/generations\/([^/]+)$/.exec(path)?.[1];
  if (made !== undefined) return <GenerationPage id={decodeURIComponent(made)} />;
  if (path === "/my/genai-key") return <KeyPage />;
  if (path === "/privacy") return <PrivacyPage />;
  const game = /^\/my\/games\/([^/]+)$/.exec(path)?.[1];
  if (game !== undefined) return <MyGamePage id={decodeURIComponent(game)} />;
  if (path === "/library") return <LibraryPage />;
  const inLibrary = /^\/library\/([^/]+)$/.exec(path)?.[1];
  if (inLibrary !== undefined) return <LibraryGamePage id={decodeURIComponent(inLibrary)} />;
  return <HomePage />;
}
