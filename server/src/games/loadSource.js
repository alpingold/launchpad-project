/**
 * Loads a game from its source code (a string), WITHOUT writing it to disk: a `data:` URL
 * is a module whose code comes from a string. Used for AI-generated games, whose code
 * lives in the database (plan §11).
 *
 * A data: module can't import files next to it, which matches contract rule 1. The
 * `sourceURL` comment makes error messages say "game.js line 42" instead of a long
 * base64 string.
 *
 * IMPORTANT: this RUNS the code. On the server, only for games the admin has reviewed
 * (status playtest or published); unreviewed code is only run inside the sandbox.
 *
 * @param {string} source
 * @param {string} [sourceName]  the file name to use in error messages
 * @returns {Promise<unknown>} the module's default export
 */
export async function loadGameSource(source, sourceName = 'game.js') {
  const withName = `${source}\n//# sourceURL=${sourceName}\n`;
  const url = `data:text/javascript;base64,${Buffer.from(withName).toString('base64')}`;
  return (await import(url)).default;
}
