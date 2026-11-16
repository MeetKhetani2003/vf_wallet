import { Router } from 'express';
import {
  createUser,
  getAllUsers,
  getUserById,
  updateUserBonusConfig,
  toggleBlockUser,
} from '../controllers/adminController';
import {
  getAllTransactions,
  getPendingDeposits,
  getPendingWithdrawals,
  approveDeposit,
  rejectDeposit,
  approveWithdrawal,
  rejectWithdrawal,
  getAdminStats,
} from '../controllers/adminTransactionController';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();

// Apply auth & admin check to all admin routes
router.use(authenticateToken);
router.use(requireAdmin);

// Platform KPI Metrics
// GET /api/admin/stats
router.get('/stats', getAdminStats);

// User Management Routes
// POST /api/admin/users/create
router.post('/users/create', createUser);

// GET /api/admin/users
router.get('/users', getAllUsers);

// GET /api/admin/users/:userId
router.get('/users/:userId', getUserById);

// PATCH /api/admin/users/:userId/bonus-config
router.patch('/users/:userId/bonus-config', updateUserBonusConfig);

// PATCH /api/admin/users/:userId/toggle-block
router.patch('/users/:userId/toggle-block', toggleBlockUser);

// Transaction Verification & Approval Routes
// GET /api/admin/pending-deposits
router.get('/pending-deposits', getPendingDeposits);

// GET /api/admin/pending-withdrawals
router.get('/pending-withdrawals', getPendingWithdrawals);

// GET /api/admin/transactions
router.get('/transactions', getAllTransactions);

// Approve endpoints (support both POST and PATCH, and /approve / /approve-deposit)
router.post('/transactions/:id/approve', approveDeposit);
router.patch('/transactions/:id/approve', approveDeposit);
router.post('/transactions/:id/approve-deposit', approveDeposit);
router.patch('/transactions/:id/approve-deposit', approveDeposit);

// Reject endpoints (support both POST and PATCH, and /reject / /reject-deposit)
router.post('/transactions/:id/reject', rejectDeposit);
router.patch('/transactions/:id/reject', rejectDeposit);
router.post('/transactions/:id/reject-deposit', rejectDeposit);
router.patch('/transactions/:id/reject-deposit', rejectDeposit);

// Payout / Withdrawal Approval Routes
router.post('/transactions/:id/approve-withdrawal', approveWithdrawal);
router.patch('/transactions/:id/approve-withdrawal', approveWithdrawal);
router.post('/transactions/:id/reject-withdrawal', rejectWithdrawal);
router.patch('/transactions/:id/reject-withdrawal', rejectWithdrawal);

export default router;
