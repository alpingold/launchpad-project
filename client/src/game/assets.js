// The art library (plan §4b). Games refer to pictures by id ("go-sign"); the manifest at
// /game-assets/manifest.json says which file each id is. A frame game gets the id → URL
// list when it starts (party.asset(id)), and its security policy only lets it load
// pictures from /game-assets/, so only art that's been added to the library can be shown
// from our site.

let manifestPromise = null;

/** Loads the manifest once and shares it: Map of id → { id, file, alt, ... }. */
export function loadManifest() {
  manifestPromise ??= fetch('/game-assets/manifest.json')
    .then((res) => res.json())
    .then((data) => new Map(data.assets.map((asset) => [asset.id, asset])))
    .catch(() => new Map()); // no manifest: party.asset() finds nothing
  return manifestPromise;
}
