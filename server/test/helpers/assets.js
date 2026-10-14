import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assetIdsIn as kitAssetIdsIn } from '../../src/games/kit/screen.js';

// The art library lives with the client (it's served as static files), but games on the
// server refer to it by id. These helpers let server tests check that every asset id a
// game uses really exists (plan §4b and §5, E4/E7).

export const ASSETS_DIR = fileURLToPath(new URL('../../../client/public/game-assets/', import.meta.url));

/** @returns {{ id: string, file: string, alt: string, tags: string[] }[]} */
export function loadManifest() {
  return JSON.parse(readFileSync(path.join(ASSETS_DIR, 'manifest.json'), 'utf8')).assets;
}

/** The set of asset ids games may use. */
export function knownAssetIds() {
  return new Set(loadManifest().map((a) => a.id));
}

export function assetFileExists(file) {
  return existsSync(path.join(ASSETS_DIR, file));
}

/** Every asset id used anywhere in a list of screens. */
export function assetIdsIn(screens) {
  return new Set(screens.flatMap((screen) => kitAssetIdsIn(screen)));
}
