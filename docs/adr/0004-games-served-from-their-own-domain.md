# The Game frame is served from its own domain

Decided 2026-10-30, revised 2026-11-16. The Game frame is served from boilergames-play.party, a
separate registrable domain, not from boilergames.party or a subdomain. Browsers treat a subdomain
as the same site, so cookies can reach it. A frame with no `allow-same-origin` already gets a null
origin, so the domain is a second wall: it still holds if someone adds `allow-same-origin` "to fix a
bug". Never add `allow-same-origin` to the Game frame.

That domain serves one small static page per SDK version, holding that version's frozen Engine. It
serves no Game: the Screen fetches a Game's bundle from the site and hands it to the frame as text,
and the frame starts it in a worker. So the game domain has no API, no database and nothing private.
