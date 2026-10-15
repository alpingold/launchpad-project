import sdk from './sdk.js?raw';
import ui from './ui.js?raw';
import kit from './kit.js?raw';
import style from './base.css?raw';
import { frameDocumentFrom } from './template.js';

// The document a game's iframe shows (plan §13c): the security policy, the base style, the
// `party` SDK and its helpers, then the game. The details are in template.js; this only
// fills in the SDK files, which Vite bundles as text.

/**
 * @param {string} gameSource  the game file
 * @param {string} origin      our site's origin (window.location.origin)
 */
export function buildFrameDocument(gameSource, origin) {
  return frameDocumentFrom({ style, ui, kit, sdk }, gameSource, origin);
}
