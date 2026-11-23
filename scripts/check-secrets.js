#!/usr/bin/env node
// Secret scan: stops passwords, API keys and payment credentials from ever reaching git / GitHub.
//   node scripts/check-secrets.js --staged   what's about to be committed (the pre-commit hook)
//   node scripts/check-secrets.js --push     what's about to be pushed (the pre-push hook; reads git's refs on stdin)
//   node scripts/check-secrets.js --all      every file git would track (CI, or by hand)
// It blocks:
//   1. secret FILES: .env files (only *.example may be committed), private keys and certificates, Android / iOS
//      signing keys, Firebase / Google service files, database dumps
//   2. secret VALUES in any file: private keys, Google / AI / GitHub / AWS / Stripe keys, database addresses with a
//      password, and real values for our secret settings (M-Pesa keys, JWT secret, SMTP password…) in env files
// A line can be allowed on purpose with the comment  secret-scan:allow  (e.g. a fake key in a test).
// No dependencies: plain Node, so it runs anywhere git does.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (args, input) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...(input !== undefined ? { input } : {}) });

// ---------------------------------------------------------------- 1. files that must never be committed
const SECRET_FILES = [
  [/(^|\/)[^/]*\.env(\.[^/]*)?$|(^|\/)\.env$/i, 'an environment file (secrets): commit a .env.example with placeholders instead', (file) => /\.example$/i.test(file)],
  [/\.(pem|key|p12|pfx|crt|cer|der|jks|keystore|mobileprovision|p8)$/i, 'a private key, certificate or signing key'],
  [/(^|\/)(keystore|key|signing)\.properties$/i, 'Android signing settings'],
  [/(^|\/)google-services\.json$/i, 'Firebase / Google settings for the Android app'],
  [/(^|\/)GoogleService-Info\.plist$/i, 'Firebase / Google settings for the iOS app'],
  [/(service[-_]?account|firebase-adminsdk|credentials?)[^/]*\.json$/i, 'a service account / credentials file'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, 'an SSH key'],
  [/\.(sqlite3?|db|bson|archive|dump)$/i, 'a database file or dump (customer data)'],
  [/(^|\/)\.npmrc$/i, 'npm settings (may hold an access token)', (file, text) => !/_authToken|_password/i.test(text || '')],
];

// ---------------------------------------------------------------- 2. secret values
const VALUE_RULES = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/, 'a private key'],
  [/"private_key"\s*:\s*"-----BEGIN/, 'a service account private key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/, 'an OpenAI-style API key'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'a GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}/, 'a live Stripe key'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, 'a Slack token'],
  [/mongodb(?:\+srv)?:\/\/[^\s/:@'"`]+:[^\s@'"`]+@(?!127\.0\.0\.1|localhost)/i, 'a database address with a password'],
  [/(?:postgres|mysql|redis|amqp)s?:\/\/[^\s/:@'"`]+:[^\s@'"`]{4,}@(?!127\.0\.0\.1|localhost)/i, 'a database / queue address with a password'],
];

// our secret settings: in env-style files (KEY=value) their value must be empty or a placeholder
const SECRET_KEYS = /^(JWT_SECRET|UNSPLASH_(ACCESS|SECRET)_KEY|MPESA_(CONSUMER_KEY|CONSUMER_SECRET|PASSKEY|INITIATOR_NAME|INITIATOR_PASSWORD|SECURITY_CREDENTIAL|CALLBACK_SECRET)|PAY_SECRETS_KEY|SMTP_(USER|PASS)|GOOGLE_(CLIENT_SECRET|MAPS_SERVER_KEY|API_KEY)|ANTHROPIC_API_KEY|OPENAI_API_KEY|TURN_(USERNAME|CREDENTIAL)|FIREBASE_[A-Z_]*|REDIS_URL|MONGO_URI|SESSION_SECRET|[A-Z_]*(SECRET|PASSWORD|PRIVATE_KEY|API_KEY|TOKEN))$/;
const PLACEHOLDER = /^$|^<.*>$|your|change|example|placeholder|xxx|\.\.\.|^\$\{|^replace|^none$|^false$|^true$|^0$|^127\.0\.0\.1|localhost|^mongodb:\/\/127|^mongodb:\/\/localhost|^redis:\/\/127|^redis:\/\/localhost/i;
// public test values published by Safaricom for the 174379 sandbox shortcode (not a secret)
const PUBLIC_VALUES = new Set(['bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919']);
const ENV_STYLE = /\.env(\.[^/]*)?$|\.(env|ini|properties|cfg|conf|toml)$|(^|\/)(docker-compose[^/]*\.ya?ml|\.npmrc)$/i;

const SKIP = /(^|\/)(node_modules|dist|build|\.git|android\/app\/src\/main\/assets\/public|ios\/App\/App\/public)\/|package-lock\.json$|\.(png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|eot|mp3|mp4|zip|gz|apk|aab)$/i;
const ALLOW = /secret-scan:allow/;

function scanText(file, text) {
  const found = [];
  if (!text || text.includes('\u0000')) return found; // binary
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (ALLOW.test(line)) return;
    for (const [pattern, what] of VALUE_RULES) {
      if (!pattern.test(line)) continue;
      // documentation examples: user:pass@host, <password>, ***, xxx
      if (/address/.test(what) && /:\/\/[^\s/:@]*:(pass|password|secret|<[^>@\s]+>|\*{3,}|x{3,}|\$\{?[A-Z_]+\}?)@/i.test(line)) continue;
      found.push({ file, line: index + 1, what });
    }
    if (ENV_STYLE.test(file)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && SECRET_KEYS.test(match[1])) {
        const value = match[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
        if (!PLACEHOLDER.test(value) && !PUBLIC_VALUES.has(value)) found.push({ file, line: index + 1, what: `a real value for ${match[1]} (leave it empty or a placeholder in example files)` });
      }
    }
  });
  return found;
}

function scanFile(file, text) {
  const normal = file.replace(/\\/g, '/');
  if (SKIP.test(normal)) return [];
  const found = [];
  for (const [pattern, what, allowed] of SECRET_FILES) {
    if (pattern.test(normal) && !(allowed && allowed(normal, text))) found.push({ file: normal, line: 0, what });
  }
  return [...found, ...scanText(normal, text)];
}

// ---------------------------------------------------------------- what to scan
function staged() {
  const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
  return files.map((file) => {
    let text = '';
    try { text = git(['show', `:${file}`]); } catch { /* deleted / binary */ }
    return [file, text];
  });
}
function pushing(stdin) {
  // each line: <local ref> <local sha> <remote ref> <remote sha>
  const ZERO = /^0+$/;
  const files = new Map();
  for (const line of stdin.split(/\r?\n/).filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(' ');
    if (!localSha || ZERO.test(localSha)) continue; // deleting a branch
    const range = remoteSha && !ZERO.test(remoteSha) ? `${remoteSha}..${localSha}` : localSha;
    const commits = git(['rev-list', range, ...(remoteSha && !ZERO.test(remoteSha) ? [] : ['--not', '--remotes'])]).split(/\s+/).filter(Boolean);
    for (const commit of commits) {
      for (const file of git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMR', '-z', commit]).split('\0').filter(Boolean)) {
        if (files.has(`${commit}:${file}`)) continue;
        let text = '';
        try { text = git(['show', `${commit}:${file}`]); } catch { /* binary / gone */ }
        files.set(`${commit}:${file}`, [file, text, commit.slice(0, 8)]);
      }
    }
  }
  return [...files.values()];
}
function everything() {
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  return files.map((file) => {
    let text = '';
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { /* deleted */ }
    return [file, text];
  });
}

// ---------------------------------------------------------------- run
const mode = process.argv[2] || '--all';
let list;
if (mode === '--staged') list = staged();
else if (mode === '--push') list = pushing(fs.readFileSync(0, 'utf8'));
else list = everything();
const problems = list.flatMap(([file, text, commit]) => scanFile(file, text).map((item) => ({ ...item, commit })));

if (!problems.length) {
  if (mode === '--all') console.log(`✔ Secret scan: ${list.length} files, nothing secret.`);
  process.exit(0);
}
console.error('\n✖ Secret scan: this would put secrets in git (and on GitHub):\n');
for (const item of problems) console.error(`  ${item.file}${item.line ? `:${item.line}` : ''}${item.commit ? ` (commit ${item.commit})` : ''}  →  ${item.what}`);
console.error(`
  Keep secrets in server/.env (never committed) or your host's environment settings.
  Unstage a file:  git restore --staged <file>     Stop tracking it:  git rm --cached <file>
  A fake value on purpose (tests)? Add the comment  secret-scan:allow  on that line.
`);
process.exit(1);
