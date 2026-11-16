import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

const SUPER_ADMIN = {
  name: 'Super Administrator',
  phone: '9999999999',
  email: 'admin@vfwallet.com',
  password: 'Admin@123',
  role: Role.SUPER_ADMIN,
  bonusPercentage: 10.0,
  bonusThresholdLimitPaise: 1000000, // ₹10,000 = 1,000,000 paise
  totalBalancePaise: 0,
};

async function purgeDemoData() {
  console.log('====================================================');
  console.log('🧹 [PURGE] Starting Database Purge & Clean Slate...');
  console.log('====================================================');

  try {
    // 1. Purge all transactions (deposits, withdrawals, etc.)
    console.log('[1/4] Deleting all transactions...');
    const deletedTxns = await prisma.transaction.deleteMany({});
    console.log(`      Deleted ${deletedTxns.count} transactions.`);

    // 2. Purge all non-super-admin users
    console.log('[2/4] Deleting dummy/demo user accounts...');
    const deletedUsers = await prisma.user.deleteMany({
      where: {
        phone: {
          not: SUPER_ADMIN.phone,
        },
      },
    });
    console.log(`      Deleted ${deletedUsers.count} non-super-admin users.`);

    // 3. Ensure Super Admin exists with exact credentials
    console.log('[3/4] Ensuring default Super Admin account...');
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(SUPER_ADMIN.password, salt);

    const existingAdmin = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: SUPER_ADMIN.phone },
          { email: SUPER_ADMIN.email },
        ],
      },
    });

    if (existingAdmin) {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          name: SUPER_ADMIN.name,
          phone: SUPER_ADMIN.phone,
          email: SUPER_ADMIN.email,
          passwordHash,
          role: SUPER_ADMIN.role,
          isBlocked: false,
          bonusPercentage: SUPER_ADMIN.bonusPercentage,
          bonusThresholdLimitPaise: SUPER_ADMIN.bonusThresholdLimitPaise,
          totalBalancePaise: 0,
        },
      });
      console.log(`      Super Admin (${SUPER_ADMIN.phone}) updated & reset to 0 balance.`);
    } else {
      await prisma.user.create({
        data: {
          name: SUPER_ADMIN.name,
          phone: SUPER_ADMIN.phone,
          email: SUPER_ADMIN.email,
          passwordHash,
          role: SUPER_ADMIN.role,
          isBlocked: false,
          bonusPercentage: SUPER_ADMIN.bonusPercentage,
          bonusThresholdLimitPaise: SUPER_ADMIN.bonusThresholdLimitPaise,
          totalBalancePaise: 0,
        },
      });
      console.log(`      Super Admin (${SUPER_ADMIN.phone}) created afresh.`);
    }

    // 4. Verification summary
    console.log('[4/4] Verifying database clean state...');
    const remainingUsers = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        totalBalancePaise: true,
      },
    });
    const remainingTxns = await prisma.transaction.count();

    console.log('====================================================');
    console.log('✨ [CLEAN SLATE SUMMARY]');
    console.log(`- Total Users in DB: ${remainingUsers.length}`);
    remainingUsers.forEach((u) => {
      console.log(`  • [${u.role}] ${u.name} | Phone: ${u.phone} | Balance: ₹${(u.totalBalancePaise / 100).toFixed(2)}`);
    });
    console.log(`- Total Transactions in DB: ${remainingTxns}`);
    console.log(`- Default Super Admin Credentials:`);
    console.log(`  Phone:    ${SUPER_ADMIN.phone}`);
    console.log(`  Password: ${SUPER_ADMIN.password}`);
    console.log(`  Role:     ${SUPER_ADMIN.role}`);
    console.log('====================================================');
    console.log('✅ Database purge completed successfully.');
  } catch (error) {
    console.error('❌ Error during purge:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

purgeDemoData();
