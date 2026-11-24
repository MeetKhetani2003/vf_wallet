import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import prisma from './utils/prisma';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import walletRoutes from './routes/walletRoutes';
import { seedDefaultAdmin } from './utils/seed';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Healthcheck endpoint
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.user.count();

    return res.status(200).json({
      status: 'ok',
      service: 'VF Wallet API',
      database: 'connected',
      mongodb: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Database connection error in /health:', error);
    return res.status(500).json({
      status: 'error',
      service: 'VF Wallet API',
      database: 'disconnected',
      error: error?.message || 'Database connection failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/wallet', walletRoutes);

// Server startup & automatic seeding
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, async () => {
    console.log(`🚀 VF Wallet Backend listening on port ${PORT}`);
    console.log(`🩺 Health check: http://localhost:${PORT}/health`);
    console.log(`🔑 Auth API: http://localhost:${PORT}/api/auth`);
    console.log(`🛡️ Admin API: http://localhost:${PORT}/api/admin`);

    // Auto-seed default Super Admin if not already present
    await seedDefaultAdmin();
  });
}

export { app, prisma };
