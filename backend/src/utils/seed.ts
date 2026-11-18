import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { Role } from '@prisma/client';

export const SUPER_ADMIN_CONFIG = {
  name: 'Super Administrator',
  email: 'admin@vfwallet.com',
  phone: '9999999999',
  password: 'Admin@123',
  role: Role.SUPER_ADMIN,
};

/**
 * Seeds ONLY the single Super Admin account (Phone: 9999999999, Password: Admin@123).
 * No demo users or dummy data are created.
 */
export async function seedDefaultAdmin() {
  try {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: SUPER_ADMIN_CONFIG.phone },
          { email: SUPER_ADMIN_CONFIG.email },
        ],
      },
    });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(SUPER_ADMIN_CONFIG.password, salt);

    if (!existing) {
      await prisma.user.create({
        data: {
          name: SUPER_ADMIN_CONFIG.name,
          email: SUPER_ADMIN_CONFIG.email,
          phone: SUPER_ADMIN_CONFIG.phone,
          passwordHash,
          role: SUPER_ADMIN_CONFIG.role,
          isBlocked: false,
          bonusPercentage: 10.0,
          bonusThresholdLimitPaise: 1000000,
          totalBalancePaise: 0,
        },
      });
      console.log(`[Seed] ✅ Seeded Super Admin: Phone ${SUPER_ADMIN_CONFIG.phone} / Password ${SUPER_ADMIN_CONFIG.password}`);
    } else {
      // Ensure the existing admin has the correct password, role, and details
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: SUPER_ADMIN_CONFIG.name,
          email: SUPER_ADMIN_CONFIG.email,
          phone: SUPER_ADMIN_CONFIG.phone,
          passwordHash,
          role: SUPER_ADMIN_CONFIG.role,
          isBlocked: false,
        },
      });
      console.log(`[Seed] 🛡️ Super Admin (${SUPER_ADMIN_CONFIG.phone}) verified and active.`);
    }
  } catch (error) {
    console.error('[Seed] Warning: Error checking/seeding Super Admin:', error);
  }
}
