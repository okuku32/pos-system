// Google sign-in: verifies the ID token ("credential") that Google's button gives the browser.
// Set GOOGLE_CLIENT_ID in .env (from Google Cloud console → APIs & Services → Credentials → OAuth client ID, type "Web").
const { OAuth2Client } = require('google-auth-library');
const { httpError } = require('./saleService');

let client = null;
const clientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim() || null;

async function verifyGoogleCredential(credential) {
  const id = clientId();
  if (!id) throw httpError('Google sign-in is not set up on this server', 503);
  if (!credential || typeof credential !== 'string') throw httpError('Missing Google credential');
  client = client || new OAuth2Client(id);
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: id });
    payload = ticket.getPayload();
  } catch {
    throw httpError('Google sign-in failed, please try again', 401);
  }
  if (!payload?.email || !payload.email_verified) throw httpError('Your Google email address is not verified', 401);
  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.given_name || payload.email.split('@')[0],
    avatar: payload.picture || '',
  };
}

module.exports = { verifyGoogleCredential, googleClientId: clientId };
