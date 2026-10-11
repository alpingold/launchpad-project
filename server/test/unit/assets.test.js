import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest, assetFileExists } from '../helpers/assets.js';

// Checks the art library's manifest itself, so a typo there is caught before any game uses it.

test('every manifest entry is well formed, unique, and its file exists', () => {
  const assets = loadManifest();
  assert.ok(assets.length > 0);
  const ids = new Set();
  for (const asset of assets) {
    assert.match(asset.id, /^[a-z0-9-]{1,40}$/, `id ${asset.id}`);
    assert.ok(!ids.has(asset.id), `duplicate id ${asset.id}`);
    ids.add(asset.id);
    // Plain file names only (no folders, no "..") and only image types browsers show safely in <img>.
    assert.match(asset.file, /^[a-z0-9-]+\.(png|jpg|jpeg|webp|svg)$/, `file ${asset.file}`);
    assert.ok(assetFileExists(asset.file), `missing file ${asset.file}`);
    assert.equal(typeof asset.alt, 'string', `alt text for ${asset.id}`);
    assert.ok(Array.isArray(asset.tags), `tags for ${asset.id}`);
  }
});
