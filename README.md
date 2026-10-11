# LaunchPad Party

A Jackbox-style party game platform: a host shows a room code on a big screen, players join from their phones.

## Run it (development)

```sh
npm run install:all     # first time only
npm run dev:server      # terminal 1: Express on http://localhost:3000 (restarts on file changes)
npm run dev:client      # terminal 2: Vite on http://localhost:5173 (open this one)
```

Vite forwards `/api` and `/ws` to the server, so the browser only talks to :5173.
To test from phones on the same Wi-Fi: `cd client && npx vite --host`, then open the "Network" URL it prints.

## Test

```sh
npm test                # runs the server tests with Node's built-in test runner
```
