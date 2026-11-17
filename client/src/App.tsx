// The site's pages, chosen by the address: /, /screen (the Host's Screen) and /play (a phone).
import "./pages/pages.css";
import { HomePage } from "./pages/HomePage.js";
import { PlayPage } from "./pages/PlayPage.js";
import { ScreenPage } from "./pages/ScreenPage.js";

export function App({ path = typeof location === "undefined" ? "/" : location.pathname }: { path?: string }) {
  if (path.startsWith("/screen")) return <ScreenPage />;
  if (path.startsWith("/play")) return <PlayPage />;
  return <HomePage />;
}
