import { useEffect, useState } from 'react';

// The art library (plan §4b). Games refer to pictures by id ("go-sign"); this looks the id
// up in /game-assets/manifest.json to find the file. Games can never point a phone at an
// arbitrary URL, so only art that's been added to the library can ever be shown.

let manifestPromise = null;

/** Loads the manifest once and shares it: Map of id → { id, file, alt, ... }. */
function loadManifest() {
  manifestPromise ??= fetch('/game-assets/manifest.json')
    .then((res) => res.json())
    .then((data) => new Map(data.assets.map((asset) => [asset.id, asset])))
    .catch(() => new Map()); // no manifest: every asset shows as a placeholder
  return manifestPromise;
}

/** The manifest entry for an asset id, or null (unknown id, or still loading). */
function useAsset(id) {
  const [asset, setAsset] = useState(null);
  useEffect(() => {
    if (!id) return undefined;
    let current = true;
    loadManifest().then((manifest) => {
      if (current) setAsset(manifest.get(id) ?? null);
    });
    return () => {
      current = false;
    };
  }, [id]);
  return asset?.id === id ? asset : null;
}

/** Shows an asset by id. Unknown ids get a plain placeholder box instead of a broken image. */
export function AssetImage({ id }) {
  const asset = useAsset(id);
  if (!id) return null;
  if (!asset) return <div className="asset asset-placeholder" aria-hidden="true" />;
  return <img className="asset" src={`/game-assets/${asset.file}`} alt={asset.alt} />;
}
