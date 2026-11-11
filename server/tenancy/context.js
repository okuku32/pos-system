// Multi-tenancy core: one app, one MongoDB database per client ("tenant").
//
// Every request (and every background job) runs inside a tenant context held in AsyncLocalStorage.
// Tenant models (Product, Sale, User, ...) are proxies: `Sale.find()` automatically runs against the
// current tenant's database. If code ever runs without a tenant context, model access throws instead of
// silently touching the wrong client's data.
const { AsyncLocalStorage } = require('async_hooks');
const mongoose = require('mongoose');

const als = new AsyncLocalStorage();
const schemas = new Map(); // model name -> schema (registered on every tenant connection)

const currentContext = () => als.getStore() || null;
const currentTenant = () => currentContext()?.tenant || null;

function requireTenant() {
  const t = currentTenant();
  if (!t) throw Object.assign(new Error('No client selected for this request'), { status: 400 });
  return t;
}

// One cached connection object per tenant database, sharing the main connection pool
function tenantConnection(dbName) {
  const conn = mongoose.connection.useDb(dbName, { useCache: true });
  for (const [name, schema] of schemas) if (!conn.models[name]) conn.model(name, schema);
  return conn;
}

const currentConnection = () => tenantConnection(requireTenant().dbName);

// Define a model that lives in each tenant's own database
function tenantModel(name, schema) {
  schemas.set(name, schema);
  const resolve = () => {
    const conn = currentConnection();
    return conn.models[name] || conn.model(name, schema);
  };
  return new Proxy(function TenantModel() {}, {
    get(_t, prop) {
      if (prop === 'modelName') return name;
      if (prop === 'schema') return schema;
      const M = resolve();
      const v = M[prop];
      return typeof v === 'function' ? v.bind(M) : v;
    },
    construct(_t, args) {
      const M = resolve();
      return new M(...args);
    },
  });
}

// Run code (a background job, a script, a socket event) as a specific tenant
function runAsTenant(tenant, fn) {
  return als.run({ tenant }, fn);
}

// Control-plane database: the list of clients, plans and platform admins (never tenant data)
const platformDbName = () => process.env.PLATFORM_DB || 'ordersasa_platform';
const platformConnection = () => mongoose.connection.useDb(platformDbName(), { useCache: true });

module.exports = { als, currentContext, currentTenant, requireTenant, tenantModel, tenantConnection, runAsTenant, platformConnection, platformDbName };
