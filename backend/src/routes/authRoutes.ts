import { Router } from 'express';
import { login, getMe, updateProfile } from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// POST /api/auth/login
router.post('/login', login);

// GET /api/auth/me (Protected)
router.get('/me', authenticateToken, getMe);

// PATCH & PUT /api/auth/profile (Protected)
router.patch('/profile', authenticateToken, updateProfile);
router.put('/profile', authenticateToken, updateProfile);

export default router;

