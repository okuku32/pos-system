// Run after building the app (npm run build:android): the Android app is a copy of the web front end that anyone can
// unpack, so it must hold NO backend secrets. This fails the build if it finds any.
//  1. Only VITE_* variables reach the front end (Vite's rule). None of them may look like a secret.
//  2. No value of a secret from server/.env (JWT secret, M-Pesa keys, SMTP password, database address…) is in the bundle.
//  3. No well-known secret formats (private keys, database addresses with passwords, AI keys, service accounts).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.join(here, '..');
const dist = path.join(client, process.argv[2] || 'dist');
const problems = [];
const readEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]));
};

// 1. front-end variables
const PUBLIC_OK = new Set(['VITE_API_URL', 'VITE_PUSH']);
for (const file of fs.readdirSync(client).filter((name) => /^\.env(\..+)?$/.test(name) && !name.endsWith('.example'))) {
  for (const key of Object.keys(readEnv(path.join(client, file)))) {
    if (key.startsWith('VITE_') && !PUBLIC_OK.has(key) && /SECRET|PRIVATE|PASSWORD|PASS|TOKEN|KEY|CREDENTIAL/i.test(key)) problems.push(`${file}: ${key} would be built into the app (VITE_ variables are public)`);
  }
  const api = readEnv(path.join(client, file)).VITE_API_URL;
  if (file === '.env.android' && api && !/^https:\/\//.test(api)) problems.push(`${file}: VITE_API_URL must be https:// (got ${api})`);
}

// 2. + 3. the bundle
const files = [];
const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(js|mjs|html|json|css|map|txt|webmanifest)$/.test(entry.name)) files.push(full); } };
if (!fs.existsSync(dist)) { console.error(`No build found at ${dist}`); process.exit(1); }
walk(dist);
const serverEnv = readEnv(path.join(client, '..', 'server', '.env'));
const SECRET_NAME = /SECRET|PRIVATE|PASSWORD|PASS$|_PASS|TOKEN|CONSUMER|PASSKEY|MONGO_URI|REDIS_URL|SERVICE_ACCOUNT|API_KEY|CALLBACK_KEY|GATE/;
const PUBLIC_SERVER = new Set(['GOOGLE_CLIENT_ID', 'GOOGLE_MAPS_API_KEY']); // public by design (sent to browsers anyway)
const secrets = Object.entries(serverEnv).filter(([key, value]) => SECRET_NAME.test(key) && !PUBLIC_SERVER.has(key) && value && value.length >= 8);
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/mongodb(?:\+srv)?:\/\/[^\s"'`/:@]+:[^\s"'`@]+@/, 'a database address with a password'],
  [/rediss?:\/\/[^\s"'`/:@]*:[^\s"'`@]+@/, 'a Redis address with a password'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/"type"\s*:\s*"service_account"/, 'a Google service account'],
];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(client, file);
  for (const [key, value] of secrets) if (text.includes(value)) problems.push(`${rel}: contains the value of server secret ${key}`);
  for (const [rx, what] of PATTERNS) if (rx.test(text)) problems.push(`${rel}: looks like ${what}`);
}

if (problems.length) {
  console.error(`\n✖ The app bundle is not safe to ship:\n  - ${problems.join('\n  - ')}\n`);
  process.exit(1);
}
console.log(`✔ No backend secrets in the app bundle (${files.length} files checked against ${secrets.length} server secrets and ${PATTERNS.length} secret formats).`);
