const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const workController = require('../controllers/workController');
const { protectCustomer } = require('../middleware/customerAuth');
const { protect, can } = require('../middleware/auth');

// Field team: riders and shopping agents (customer accounts that applied and were approved)
router.get('/admin/workers', protect, can('orders'), workController.adminWorkers);
// after a change succeeds, refresh that person's rows in the people tables
const refreshPerson = (pick) => (req, res, next) => {
  res.on('finish', () => { if (res.statusCode < 400) require('../market/directory').touch(pick(req)); });
  next();
};
const me = refreshPerson((req) => req.customer?._id);
router.post('/admin/workers/:id', protect, can('orders'), refreshPerson((req) => req.params.id), workController.adminWorkerAction);
// 🪪 documents (ID, driving licence, insurance…): private files, expiry dates checked by moderators
const docs = require('../controllers/workerDocsController');
router.get('/admin/workers/:id/docs', protect, can('orders'), docs.adminDocs);
router.get('/admin/workers/:id/docs/:docId/file', protect, can('orders'), docs.adminFile);
router.post('/admin/workers/:id/docs/:docId', protect, can('orders'), docs.adminReview);
router.get('/docs', protectCustomer, docs.mine);
router.post('/docs', protectCustomer, docs.upload, docs.add);
router.get('/docs/:docId/file', protectCustomer, docs.file);
router.delete('/docs/:docId', protectCustomer, docs.remove);
router.get('/admin/tasks', protect, can('orders'), workController.adminTasks);
// earnings of every rider & agent (fees, tax, our commission, cash, sent, balance) and their M-Pesa payouts
router.get('/admin/earnings', protect, can('orders'), workController.adminEarnings);
router.get('/admin/earnings/:worker', protect, can('orders'), workController.adminWorkerJobs);
router.get('/admin/payouts/list', protect, can('orders'), workController.adminPayoutList);
router.post('/admin/payouts/manual', protect, can('orders'), workController.adminPayManual);
router.post('/admin/payouts/:id/retry', protect, can('orders'), workController.adminPayoutRetry);
router.get('/admin/payouts', protect, can('orders'), workController.adminPayouts);
router.post('/admin/payouts', protect, can('orders'), workController.adminPay);

// public: our partner shops (verification centres for Safe deals)
router.get('/partners', workController.partners);
router.get('/me', protectCustomer, workController.me);
router.post('/apply', protectCustomer, me, workController.apply);
router.put('/me', protectCustomer, workController.updateMe);
router.put('/location', protectCustomer, workController.location); // 📡 the rider app shares where they are while working
router.post('/tasks/:id/rate', protectCustomer, workController.rate);
router.get('/sellers', protectCustomer, workController.mySellers); // an agent's sellers (agent ↔ seller relationship) // ⭐ the buyer rates the rider
router.get('/jobs', protectCustomer, workController.jobs);
router.post('/tasks/:id/accept', protectCustomer, me, workController.accept);
router.post('/tasks/:id/release', protectCustomer, workController.release);
router.post('/tasks/:id/picked-up', protectCustomer, workController.pickedUp);
router.post('/tasks/:id/quote', protectCustomer, workController.quote); // 🛒 price a customer's written / photographed list
router.get('/tasks/:id/list-photos/:n', protectCustomer, workController.listPhoto);
router.post('/tasks/:id/bought', protectCustomer, workController.bought); // shopping errand: bought the list (amount spent)
router.post('/tasks/:id/sent', protectCustomer, workController.sent);
router.post('/tasks/:id/on-the-way', protectCustomer, workController.onTheWay); // 🛵 heading to the buyer
router.post('/tasks/:id/arrived', protectCustomer, workController.arrived); // 📍 at the buyer's door
router.post('/tasks/:id/delivered', protectCustomer, workController.delivered);
router.post('/tasks/:id/inspect', protectCustomer, workController.inspect);
// partner shops: Safe deal verification
router.post('/tasks/:id/received', protectCustomer, workController.received);
router.post('/tasks/:id/verify', protectCustomer, workController.verify);
router.post('/tasks/:id/help', protectCustomer, workController.help);

module.exports = router;
