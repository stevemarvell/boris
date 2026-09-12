#!/usr/bin/env node
// Map Railway's API_URL onto Vite's VITE_API_URL before a build.
//
// The Railway integration syncs the API service's own variables into Vercel,
// so API_URL is present at build time and always points at whichever Railway
// environment this deployment belongs to. Vite only exposes VITE_-prefixed
// variables to client code, hence the mapping.
//
// Precedence: an explicit VITE_API_URL (the e2e suite sets one) wins and this
// writes nothing; otherwise API_URL is used; otherwise the committed
// .env.production value stands as the fallback.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(dirname(fileURLToPath(import.meta.url))), 'apps', 'web');
const target = join(WEB, '.env.production.local');

if (process.env['VITE_API_URL']) {
  console.log('VITE_API_URL is set explicitly; leaving it alone');
} else if (process.env['API_URL']) {
  writeFileSync(target, `VITE_API_URL=${process.env['API_URL']}\n`, 'utf8');
  console.log(`VITE_API_URL=${process.env['API_URL']} (from Railway's API_URL)`);
} else {
  console.log('no API_URL; falling back to the committed .env.production');
}
