// Google sign-in (Google Identity Services + OpenID Connect): verifies the ID token ("credential") that Google's button
// gives the browser. Set GOOGLE_CLIENT_ID in .env (Google Cloud console → APIs & Services → Credentials → OAuth
// client ID, type "Web").
//
// The token is checked here, on the server, before anyone is signed in:
//   • signature: RS256 by one of Google's current public keys (fetched from Google, cached as long as Google allows)
//   • audience (aud) = our client id · issuer (iss) = accounts.google.com · not expired (exp), not issued in the future
//   • email_verified = true
// Google's public keys are downloaded with Node's built-in fetch (not the library's HTTP client), then the library's
// offline check does the cryptography.
const { OAuth2Client } = require('google-auth-library');
const httpError = require('./httpError');

const CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const clientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim() || null;

let client = null;
let certs = null; // { keys: { kid: pem }, until }
let fetchImpl = (...args) => fetch(...args);

async function googleKeys() {
  if (certs && certs.until > Date.now()) return certs.keys;
  const res = await fetchImpl(CERTS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Google keys: HTTP ${res.status}`);
  const keys = await res.json();
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1]) || 3600;
  certs = { keys, until: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return keys;
}

async function verifyGoogleCredential(credential) {
  const id = clientId();
  if (!id) throw httpError('Google sign-in is not set up on this server', 503);
  if (!credential || typeof credential !== 'string' || credential.length > 5000) throw httpError('Missing Google credential');
  client = client || new OAuth2Client(id);
  let payload;
  try {
    const keys = await googleKeys();
    const ticket = await client.verifySignedJwtWithCertsAsync(credential, keys, id, ISSUERS);
    payload = ticket.getPayload();
  } catch (error) {
    if (/Google keys/.test(error.message)) console.error('[google] could not fetch Google’s keys:', error.message);
    throw httpError('Google sign-in failed, please try again', 401);
  }
  if (!payload?.email || !payload.email_verified) throw httpError('Your Google email address is not verified', 401);
  return {
    googleId: payload.sub,
    email: payload.email.normalize('NFKC').trim().toLowerCase(),
    name: payload.name || payload.given_name || payload.email.split('@')[0],
    avatar: payload.picture || '',
  };
}

// tests: a stand-in for Google's key endpoint
function useFetch(fn) {
  fetchImpl = fn;
  certs = null;
}

module.exports = { verifyGoogleCredential, googleClientId: clientId, useFetch };
