import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Executes a Prisma database operation with automatic retry on connection drops (e.g. Neon idle pool timeout).
 */
export async function withDbRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const isConnectionError =
        error?.message?.includes('Closed') ||
        error?.message?.includes('connection') ||
        error?.message?.includes('terminating connection') ||
        error?.code === 'P1001' ||
        error?.code === 'P1017';

      if (isConnectionError && attempt <= retries) {
        console.warn(`[Prisma] Connection closed or timeout. Reconnecting (attempt ${attempt}/${retries})...`);
        await prisma.$disconnect().catch(() => {});
        await prisma.$connect().catch(() => {});
        continue;
      }
      throw error;
    }
  }
}

export default prisma;

