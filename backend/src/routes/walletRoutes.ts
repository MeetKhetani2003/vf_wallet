import { Router } from 'express';
import {
  createDepositRequest,
  createWithdrawalRequest,
  getUserTransactions,
  getUserWalletSummary,
} from '../controllers/walletController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// All wallet endpoints require a valid JWT token
router.use(authenticateToken);

// POST /api/wallet/deposit
router.post('/deposit', createDepositRequest);

// POST /api/wallet/withdraw
router.post('/withdraw', createWithdrawalRequest);

// GET /api/wallet/transactions & /api/wallet/history
router.get('/transactions', getUserTransactions);
router.get('/history', getUserTransactions);

// GET /api/wallet/summary & /api/wallet/balance
router.get('/summary', getUserWalletSummary);
router.get('/balance', getUserWalletSummary);

export default router;

