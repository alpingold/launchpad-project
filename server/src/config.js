// Every tunable number for the server lives here, so limits and timeouts
// can be reviewed (and changed) in one place instead of hunting through files.

export const config = {
  // Port the HTTP + WebSocket server listens on. Override with PORT=4000 npm run dev:server
  PORT: Number(process.env.PORT) || 3000,

  // Largest JSON body Express will accept on /api routes. Small on purpose:
  // our requests are tiny (login forms), and a cap stops huge uploads early.
  HTTP_JSON_LIMIT: '10kb',
};
