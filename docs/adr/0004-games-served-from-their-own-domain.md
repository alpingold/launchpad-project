# Games are served from their own domain

Decided 2026-10-30. The Game frame and each SDK version's frozen runtime are served from
boilergames-play.party, a separate registrable domain, not from boilergames.party or a subdomain.
Browsers treat a subdomain as the same site, so cookies can reach it. A frame with no
`allow-same-origin` already gets a null origin, so the domain is a second wall: it still holds if
someone adds `allow-same-origin` "to fix a bug". It also makes each frozen runtime a plain static
file that can be cached. Never add `allow-same-origin` to the Game frame.
