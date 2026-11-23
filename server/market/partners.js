// Shop partners: shops with physical premises across Nairobi (at least 2 km apart) that verify second-hand items
// for "Safe deal" orders. The buyer pays Kapu first; the seller takes the item to the nearest partner shop;
// if it passes, the seller is paid and our rider takes it from the partner shop to the buyer.
// Partners earn a commission on every verification (paid through the field-team payouts).
const Customer = require('../models/Customer');
const { site } = require('../config/site');
const geo = require('./geo');

const SPACING_KM = 2; // no two partner shops closer than this
const REACH_KM = 15; // how far a seller may be sent to drop an item off

// the verification fee the buyer pays (the partner's commission comes out of it)
function verifyFee(subtotal) {
  const fieldwork = site().fieldwork || {};
  const percent = fieldwork.verifyPercent ?? 3;
  const min = fieldwork.verifyMin ?? 100;
  const max = fieldwork.verifyMax ?? 1500;
  return Math.min(max, Math.max(min, Math.round((subtotal * percent) / 100 / 10) * 10));
}

const partnerView = (customer, from) => {
  const worker = customer.worker || {};
  const [lng, lat] = worker.base?.coordinates || [];
  return {
    _id: customer._id, name: worker.shopName || customer.name, owner: customer.name, address: worker.shopAddress || worker.baseArea || '', area: worker.baseArea || '',
    phone: customer.phone || '', hours: worker.hours || '', lat, lng, ...(from && lat != null ? { km: geo.distanceKm(from, worker.base) } : {}),
  };
};

const APPROVED = { 'worker.role': 'partner', 'worker.status': 'approved', active: { $ne: false } };

// the nearest approved partner shop to a point (the seller's shop / the item's pin)
async function nearestPartner(point, km = REACH_KM) {
  if (!point?.coordinates) return null;
  const from = { lat: point.coordinates[1], lng: point.coordinates[0] };
  const customer = await Customer.findOne({ ...APPROVED, 'worker.base': geo.nearest({ ...from, km }) }).select('name phone worker').lean();
  return customer ? partnerView(customer, from) : null;
}

// another approved partner within 2 km of this point? (keeps the network spread out)
async function tooClose(point, exceptId) {
  if (!point?.coordinates) return null;
  const from = { lat: point.coordinates[1], lng: point.coordinates[0] };
  const customer = await Customer.findOne({ ...APPROVED, ...(exceptId ? { _id: { $ne: exceptId } } : {}), 'worker.base': geo.nearest({ ...from, km: SPACING_KM }) }).select('name phone worker').lean();
  return customer ? partnerView(customer, from) : null;
}

async function allPartners(near) {
  const query = { ...APPROVED, 'worker.base': { $exists: true } };
  if (near) query['worker.base'] = geo.nearest({ ...near, km: Math.max(near.km || 30, 1) });
  const list = await Customer.find(query).select('name phone worker').limit(300).lean();
  return list.map((customer) => partnerView(customer, near));
}

module.exports = { SPACING_KM, REACH_KM, verifyFee, nearestPartner, tooClose, allPartners, partnerView };
