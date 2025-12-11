
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

function loadEnvFile(file: string) {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return null;
  return parse(fs.readFileSync(p));
}

function mask(url?: string) {
  if (!url) return '';
  // Intenta ocultar user/pass; muestra host y db si se puede.
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`;
  } catch {
    return url.slice(0, 32) + '…';
  }
}

const envE2E = loadEnvFile('.env.e2e');
if (!envE2E) {
  console.error('[E2E GUARD] Missing .env.e2e at project root.');
  process.exit(1);
}

const e2eDb = envE2E.DATABASE_URL?.trim();
if (!e2eDb) {
  console.error('[E2E GUARD] .env.e2e is missing DATABASE_URL.');
  process.exit(1);
}

const envDev = loadEnvFile('.env'); // puede no existir y está bien
const devDb = envDev?.DATABASE_URL?.trim();

// (Recomendado) impedir que la E2E apunte a la misma DB que dev
if (devDb && devDb === e2eDb) {
  console.error('[E2E GUARD] .env.e2e DATABASE_URL equals .env DATABASE_URL — refusing to run.');
  console.error(`  dev: ${mask(devDb)}`);
  console.error(`  e2e: ${mask(e2eDb)}`);
  process.exit(1);
}

console.log('[E2E GUARD] OK — using .env.e2e DATABASE_URL:', mask(e2eDb));
