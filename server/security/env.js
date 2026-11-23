// Environment variables and API credentials.
//  - Checked at start-up: a missing or weak JWT_SECRET stops a production server (it signs every login).
//  - Secrets are never sent to the browser (config/site.js publicSite() lists only public fields),
//    never written to logs (see redactUrl) and server/.env is kept out of git (.gitignore).
const WEAK = /^(change_this|secret|changeme|password|jwt|test|dev)/i;

function checkEnv() {
  const prod = process.env.NODE_ENV === 'production';
  const problems = [];
  const warnings = [];
  const JWT_SECRET = String(process.env.JWT_SECRET || '');
  if (!JWT_SECRET) problems.push('JWT_SECRET is not set');
  else if (JWT_SECRET.length < 32 || WEAK.test(JWT_SECRET)) problems.push('JWT_SECRET is too short or a placeholder (use 32+ random characters)');
  if (!process.env.MONGO_URI) problems.push('MONGO_URI is not set');
  else if (prod && !/@/.test(process.env.MONGO_URI) && !/127\.0\.0\.1|localhost/.test(process.env.MONGO_URI)) warnings.push('MONGO_URI points to a remote database without a username/password');
  if (prod && !process.env.CLIENT_URL && !process.env.SHOP_URL) warnings.push('CLIENT_URL / SHOP_URL not set: browsers on other addresses will be refused (CORS)');
  if (process.env.MPESA_CALLBACK_SECRET && process.env.MPESA_CALLBACK_SECRET.length < 24) warnings.push('MPESA_CALLBACK_SECRET should be 24+ characters');
  problems.push(...paymentProblems(prod));
  if (process.env.PAY_SECRETS_KEY && !/^[0-9a-f]{64}$/i.test(String(process.env.PAY_SECRETS_KEY).trim())) problems.push('PAY_SECRETS_KEY must be 64 hex characters (generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
  else if (prod && !process.env.PAY_SECRETS_KEY) warnings.push('PAY_SECRETS_KEY is not set: sellers’ M-Pesa keys are encrypted with a key derived from JWT_SECRET (set your own, separate key)');
  for (const warning of warnings) console.warn(`⚠️  ${warning}`);
  if (problems.length) {
    for (const problem of problems) console.error(`✖ ${problem}`);
    if (prod) {
      console.error('Refusing to start in production with unsafe settings. Fix server/.env.');
      process.exit(1);
    }
  }
  return { problems, warnings };
}

// Payment and mail credentials: real values only, and never Safaricom's public sandbox values on a live (production)
// M-Pesa account. Placeholders copied from .env.example ("your_consumer_key") would make every payment fail.
const PLACEHOLDER = /^(your|change|example|placeholder|xxx|<)/i;
const SANDBOX_SHORTCODE = '174379';
const SANDBOX_PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
function paymentProblems(prod) {
  const out = [];
  const env = (key) => String(process.env[key] || '').trim();
  for (const key of ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_PASSKEY', 'MPESA_SECURITY_CREDENTIAL', 'SMTP_PASS', 'GOOGLE_CLIENT_SECRET', 'ANTHROPIC_API_KEY']) {
    if (env(key) && PLACEHOLDER.test(env(key))) out.push(`${key} is still the placeholder from .env.example`);
  }
  if (prod && env('MPESA_ENV') === 'production') {
    if (env('MPESA_SHORTCODE') === SANDBOX_SHORTCODE) out.push('MPESA_SHORTCODE is the sandbox test shortcode on a live M-Pesa account');
    if (env('MPESA_PASSKEY') === SANDBOX_PASSKEY) out.push('MPESA_PASSKEY is Safaricom’s public sandbox passkey on a live M-Pesa account');
    if (!env('MPESA_CONSUMER_KEY') || !env('MPESA_CONSUMER_SECRET') || !env('MPESA_PASSKEY')) out.push('MPESA_ENV=production needs MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET and MPESA_PASSKEY');
  }
  return out;
}

// URLs in logs: hide reset tokens, the M-Pesa callback key and support tokens
const redactUrl = (url) =>
  String(url || '')
    .replace(/([?&](?:token|key|code|secret|password)=)[^&]*/gi, '$1[hidden]')
    .replace(/(\/api\/mpesa\/(?:callback|b2c\/result|b2c\/timeout))\/[^/?]+/, '$1/[key]')
    .replace(/(\/support\/threads)\/[a-f0-9]{16,}/, '$1/[token]');

module.exports = { checkEnv, redactUrl };
