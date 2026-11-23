// Seller hub (logged-in sellers, their own data only): stores & branches, inventory, sales & earnings
const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const { protectCustomer } = require('../middleware/customerAuth');
const seller = require('../controllers/sellerController');

router.use(protectCustomer);
router.get('/overview', seller.overview);
router.get('/pos', seller.pos); // 📈 POS dashboard: who can use it, and the sales analytics (?range=7|30|90|365)
router.post('/pos', seller.setPos); // { enabled }
router.get('/daily', seller.daily);
router.get('/stores', seller.stores);
router.post('/stores', seller.createStore);
router.put('/stores/:id', seller.updateStore);
router.post('/stores/:id/main', seller.makeMain);
router.post('/stores/:id/close', seller.closeStore);
router.get('/inventory', seller.inventory);
router.patch('/inventory/:id', seller.updateItem);

module.exports = router;
