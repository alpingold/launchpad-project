import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/database.js';
import { createUser, setBio } from '../../src/db/users.js';
import { GameRegistry } from '../../src/games/registry.js';
import { pageInfo, pageHtml } from '../../src/http/pages.js';
import { tapGame } from '../helpers/frameGames.js';

// Each page's title and description in the HTML, and which addresses aren't pages (plan §33).

function setup() {
  const db = openDatabase(':memory:');
  const games = new GameRegistry();
  games.register(tapGame('official-one', { name: 'Tap Race', description: 'Tap faster than <everyone>.' }));
  const sam = createUser(db, 'Sam', 'scrypt$x');
  games.register(tapGame('g-sam00001'), { source: 'generated', status: 'playtest', ownerUserId: sam.id });
  return { db, games, sam };
}

test('a public game page has its name and description; a playtest game only the plain title', () => {
  const deps = setup();
  assert.deepEqual(pageInfo('/games/official-one', deps), { title: 'Tap Race', description: 'Tap faster than <everyone>.' });
  assert.deepEqual(pageInfo('/games/g-sam00001', deps), { title: 'Game' });
  assert.equal(pageInfo('/games/nothing', deps), null);
});

test('a profile is a page only when the account exists; its bio is the description', () => {
  const deps = setup();
  assert.deepEqual(pageInfo('/u/sam', deps), { title: 'Sam', description: "Sam's party games on BoilerGames." });
  setBio(deps.db, deps.sam.id, 'I make drawing games.');
  assert.deepEqual(pageInfo('/u/Sam', deps), { title: 'Sam', description: 'I make drawing games.' });
  assert.equal(pageInfo('/u/nobody', deps), null);
});

test('the fixed pages are the client\'s; anything else is not a page', () => {
  const deps = setup();
  for (const p of ['/', '/games', '/kit', '/join', '/host', '/login', '/admin', '/create', '/account', '/report', '/privacy', '/create/g-whatever']) {
    assert.ok(pageInfo(p, deps), p);
  }
  for (const p of ['/nope', '/games/a/b', '/games/%E0%A4%A', '/u/', '/index']) assert.equal(pageInfo(p, deps), null, p);
});

test('what goes into the HTML is escaped', () => {
  const html = '<head><title>x</title><meta name="description" content="x" /></head>';
  const out = pageHtml(html, { title: 'A "b" <c>', description: 'd & e' }, 'https://boilergames.party/games/a');
  assert.match(out, /<title>A &quot;b&quot; &lt;c&gt; · BoilerGames<\/title>/);
  assert.match(out, /content="d &amp; e"/);
  assert.match(out, /<link rel="canonical" href="https:\/\/boilergames.party\/games\/a" \/>\n {2}<\/head>/);
});
