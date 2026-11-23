const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const agreementController = require('../controllers/agreementController');
const { protectCustomer } = require('../middleware/customerAuth');
const { protect, can } = require('../middleware/auth');

// Lipa Pole Pole sale agreements (furniture, buyer and seller near each other)
router.get('/admin/list', protect, can('orders'), agreementController.adminList);
router.post('/', protectCustomer, agreementController.create);
router.get('/mine', protectCustomer, agreementController.mine);
router.get('/for/:conversationId', protectCustomer, agreementController.forConversation);
router.get('/:id', protectCustomer, agreementController.get);
router.post('/:id/accept', protectCustomer, agreementController.accept);
router.post('/:id/payments', protectCustomer, agreementController.addPayment);
router.post('/:id/payments/:paymentId/confirm', protectCustomer, agreementController.confirmPayment);
router.post('/:id/cancel', protectCustomer, agreementController.cancel);

module.exports = router;
