// `npm run schema`: writes server/src/db/SCHEMA.md, every table and column the database has
// today (server/src/db/schemaDoc.js). Run it after adding a migration.
import { writeFileSync } from 'node:fs';
import { describeSchema } from '../src/db/schemaDoc.js';

const file = new URL('../src/db/SCHEMA.md', import.meta.url);
writeFileSync(file, describeSchema());
console.log(`wrote ${file.pathname}`);
