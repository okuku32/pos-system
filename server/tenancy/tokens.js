// Every login token records which client (tenant) it belongs to, so a login from one shop
// can never be used on another shop's address.
const { DEFAULT_SLUG } = require('./tenants');

function tokenMatchesTenant(decoded, tenant) {
  if (!tenant) return false;
  if (decoded.tid) return decoded.tid === tenant.slug;
  return tenant.slug === DEFAULT_SLUG(); // tokens issued before multi-client support: original shop only
}

module.exports = { tokenMatchesTenant };
