#!/usr/bin/env node
// 🔐 Every security check, one command:   npm run check:security        (from the project folder)
//                                          npm run check:security -- --quick   (skip the slow full test suites)
//
// Runs each check in turn and ends with a PASS / FAIL table. Nothing is changed and nothing is sent anywhere
// except `npm audit`, which asks the npm registry about known vulnerable packages (no project data is sent).
//   1. Settings      server/.env: required secrets present and strong (values are never printed)
//   2. Secret scan   no passwords / keys / .env files in what git tracks
//   3. Dependencies  npm audit: no high or critical known vulnerabilities (server and app)
//   4. Security      the attack tests: injection, XSS, CSRF, sessions, uploads, rate limits, payments…
//   5. Accounts      sign-up, login, lockout, password reset, Google sign-in, customer roles
//   6. Staff roles   owner / admin / moderator boundaries
//   7. Everything    the full server test suite (every module) and the app's tests
//   8. App bundle    the built app holds no backend secrets
// Needs MongoDB running locally (the tests use throw-away databases on 127.0.0.1:27017 and delete them after).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const CLIENT = path.join(ROOT, 'client');
const QUICK = process.argv.includes('--quick');
const results = [];

// run a command, show its output live, and record PASS / FAIL with how long it took
function step(name, command, args, options = {}) {
  console.log(`\n━━━ ${name} ━━━  (${command} ${args.join(' ')})`);
  const startedAt = Date.now();
  const run = spawnSync(command, args, { cwd: options.cwd || ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...(options.env || {}) } });
  const passed = run.status === 0;
  results.push({ name, passed, seconds: Math.round((Date.now() - startedAt) / 1000), note: passed ? '' : options.failHint || '' });
  return passed;
}
function record(name, passed, note = '') {
  results.push({ name, passed, seconds: 0, note });
  console.log(`${passed ? '✅' : '❌'} ${name}${note ? `: ${note}` : ''}`);
}

// 1. the server's settings: read server/.env without printing any value
function checkSettings() {
  console.log('\n━━━ 1. Settings (server/.env) ━━━');
  const envFile = path.join(SERVER, '.env');
  if (!fs.existsSync(envFile)) return record('Settings', false, 'server/.env is missing: copy server/.env.example to server/.env and fill it in');
  const values = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  const problems = [];
  const warnings = [];
  if (!values.MONGO_URI) problems.push('MONGO_URI is empty');
  if ((values.JWT_SECRET || '').length < 32) problems.push('JWT_SECRET must be at least 32 random characters');
  if (/change|secret|example|12345/i.test(values.JWT_SECRET || '')) problems.push('JWT_SECRET looks like a placeholder: use a long random value');
  if (values.MPESA_CONSUMER_KEY && !values.MPESA_CALLBACK_SECRET) warnings.push('M-Pesa is set up but MPESA_CALLBACK_SECRET is empty (callbacks can’t be verified)');
  if (values.MPESA_CONSUMER_KEY && !values.PAY_SECRETS_KEY) warnings.push('PAY_SECRETS_KEY is empty: sellers’ payout details are encrypted with a key derived from JWT_SECRET; set a separate key before launch (see server/.env.example)');
  if (/^https:/.test(values.SHOP_URL || '') && values.COOKIE_SECURE === 'false') problems.push('COOKIE_SECURE=false on an https site: cookies could leak over http');
  for (const warning of warnings) console.log(`⚠️  ${warning}`);
  record('Settings', problems.length === 0, problems.join('; ') || `${warnings.length ? `${warnings.length} warning(s) above` : 'all required secrets present'}`);
}

// is MongoDB listening locally? (the tests need it)
function mongoIsRunning() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 27017 });
    socket.setTimeout(1500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}

(async () => {
  console.log(`🔐 Kapu security check${QUICK ? ' (quick)' : ''}: ${new Date().toLocaleString()}`);
  checkSettings();
  step('2. Secret scan', 'node', ['scripts/check-secrets.js', '--all'], { failHint: 'a secret is in a tracked file: remove it and rotate that key' });
  step('3a. Dependencies (server)', 'npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: SERVER, failHint: 'run "npm audit" in server to see which package, then update it' });
  step('3b. Dependencies (app)', 'npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: CLIENT, failHint: 'run "npm audit" in client to see which package, then update it' });

  if (!(await mongoIsRunning())) {
    record('4–7. Tests', false, 'MongoDB isn’t running on 127.0.0.1:27017: start it (Windows: services.msc → MongoDB Server → Start), then run this again');
  } else {
    step('4. Security attack tests', 'npm', ['run', 'test:security'], { cwd: SERVER });
    step('5. Accounts & sign-in', 'npm', ['run', 'test:auth'], { cwd: SERVER });
    step('6. Staff roles (owner / admin / moderator)', 'npm', ['run', 'test:roles'], { cwd: SERVER });
    if (!QUICK) {
      step('7a. Every module (full server suite)', 'npm', ['test'], { cwd: SERVER });
      step('7b. The app’s tests', 'npm', ['test'], { cwd: CLIENT });
    }
  }
  if (step('8a. Build the app', 'npm', ['run', 'build'], { cwd: CLIENT })) {
    step('8b. No secrets in the built app', 'node', ['scripts/check-app-secrets.mjs'], { cwd: CLIENT, failHint: 'a backend secret ended up in the app: never put secrets in VITE_ variables' });
  }

  // the summary
  console.log('\n══════════════════════ RESULT ══════════════════════');
  for (const result of results) console.log(`${result.passed ? '✅ PASS' : '❌ FAIL'}  ${result.name.padEnd(44)} ${result.seconds ? `${result.seconds}s` : ''}${result.note ? `\n           → ${result.note}` : ''}`);
  const failed = results.filter((result) => !result.passed).length;
  console.log(failed ? `\n${failed} check(s) failed: fix them before going live.` : '\nAll security checks passed. ✔');
  process.exit(failed ? 1 : 0);
})();
