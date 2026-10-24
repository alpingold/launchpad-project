const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/**
 * The visitor's IP address for a WebSocket upgrade request (plan §59), for limits per address.
 * Express works this out for normal requests (app.set('trust proxy')), but upgrades never
 * reach Express, so this does the same for them.
 *
 * Behind Caddy every connection comes from 127.0.0.1, and Caddy puts the visitor's address
 * in X-Forwarded-For (it replaces whatever the visitor sent there). That header is only
 * believed when TRUST_PROXY is set AND the connection came from this machine: otherwise
 * anyone could write any address into it.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {string | boolean} trustProxy  config.TRUST_PROXY ('loopback' in production, false otherwise)
 */
export function clientIp(req, trustProxy) {
  const remote = req.socket?.remoteAddress ?? '';
  if (!trustProxy || !LOOPBACK.includes(remote)) return remote;
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded.at(-1) ?? remote; // the last one: the address Caddy saw
}
