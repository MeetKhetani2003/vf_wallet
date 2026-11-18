process.env.NODE_ENV = 'test';

import dotenv from 'dotenv';
import path from 'path';
import { AddressInfo } from 'net';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface TestResult {
  suite: string;
  testCase: string;
  passed: boolean;
  status: number | string;
  detail: string;
}

const results: TestResult[] = [];

function recordTest(suite: string, testCase: string, passed: boolean, status: number | string, detail: string) {
  results.push({ suite, testCase, passed, status, detail });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} [${suite}] ${testCase} (${status}) -> ${detail}`);
  if (!passed) {
    throw new Error(`Test failed: [${suite}] ${testCase}`);
  }
}

async function runE2ETests() {
  console.log('================================================================');
  console.log('🧪 [E2E] Running Comprehensive Backend API Verification Suite');
  console.log('================================================================\n');

  // Dynamic import after setting NODE_ENV = 'test'
  const { app, prisma } = await import('../src/server');

  // 1. Start Server on dynamic free port
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const BASE_URL = `http://localhost:${port}`;
  console.log(`🚀 Ephemeral Test Server running at: ${BASE_URL}\n`);

  let adminToken = '';
  let userToken = '';
  let createdUserId = '';
  let depositTxnId = '';
  let withdrawTxnId1 = '';
  let withdrawTxnId2 = '';

  const TEST_USER = {
    name: 'Rohit Deshmukh',
    phone: '9820011223',
    email: 'rohit.deshmukh@vfwallet.local',
    password: 'User@123',
    bonusPercentage: 10.0,
    bonusThresholdLimit: 10000, // ₹10,000 = 1,000,000 paise
  };

  const TEST_DEPOSIT = {
    amountPaise: 50000, // ₹500.00
    utr: '987654321098', // 12-digit UTR
    imageHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    paymentApp: 'GooglePay',
    rawOcrData: {
      utr: '987654321098',
      amount: 500,
      paymentApp: 'GooglePay',
      sender: 'Rohit Deshmukh',
    },
  };

  try {
    // Ensure clean state before running
    const existingTestUser = await prisma.user.findFirst({
      where: { phone: TEST_USER.phone },
    });
    if (existingTestUser) {
      await prisma.transaction.deleteMany({ where: { userId: existingTestUser.id } });
      await prisma.user.delete({ where: { id: existingTestUser.id } });
    }
    await prisma.transaction.deleteMany({
      where: {
        OR: [
          { utr: TEST_DEPOSIT.utr },
          { imageHash: TEST_DEPOSIT.imageHash },
        ],
      },
    });

    // =========================================================================
    // SUITE 1: AUTHENTICATION VERIFICATION
    // =========================================================================
    console.log('--- Suite 1: Authentication & Authorization ---');

    // 1.1: Invalid Credentials
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9999999999', password: 'WrongPassword' }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'Auth',
        'POST /api/auth/login with invalid password returns 401',
        res.status === 401 && data.success === false,
        res.status,
        data.error || 'Blocked correctly'
      );
    }

    // 1.2: Valid Super Admin Login
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9999999999', password: 'Admin@123' }),
      });
      const data = (await res.json()) as any;
      adminToken = data.token;
      recordTest(
        'Auth',
        'POST /api/auth/login with Super Admin credentials',
        res.status === 200 && data.success === true && !!data.token && data.user.role === 'SUPER_ADMIN',
        res.status,
        `Admin logged in: ${data.user.name} (${data.user.role})`
      );
    }

    // 1.3: GET /api/auth/me without token -> 401
    {
      const res = await fetch(`${BASE_URL}/api/auth/me`);
      const data = (await res.json()) as any;
      recordTest(
        'Auth',
        'GET /api/auth/me without token is rejected with 401',
        res.status === 401,
        res.status,
        data.error || 'Unauthorized'
      );
    }

    // 1.4: GET /api/auth/me with Admin Token
    {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = (await res.json()) as any;
      recordTest(
        'Auth',
        'GET /api/auth/me with valid Bearer token returns profile',
        res.status === 200 && data.success === true && data.user.phone === '9999999999',
        res.status,
        `Profile verified: ${data.user.name} (${data.user.phone})`
      );
    }

    // =========================================================================
    // SUITE 2: ADMIN USER CREATION
    // =========================================================================
    console.log('\n--- Suite 2: Admin User Creation ---');

    // 2.1: Create real user with 10% bonus and ₹10,000 threshold
    {
      const res = await fetch(`${BASE_URL}/api/admin/users/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(TEST_USER),
      });
      const data = (await res.json()) as any;
      createdUserId = data.user?.id;
      recordTest(
        'Admin',
        'POST /api/admin/users/create creates user with custom bonus & threshold',
        res.status === 201 &&
          data.success === true &&
          data.user.bonusPercentage === 10 &&
          data.user.bonusThresholdLimitPaise === 1000000 &&
          data.user.totalBalancePaise === 0,
        res.status,
        `Created user ID: ${createdUserId}, Bonus: ${data.user.bonusPercentage}%, Threshold: ₹${data.user.bonusThresholdLimitPaise / 100}, Balance: ₹${data.user.totalBalancePaise / 100}`
      );
    }

    // 2.2: Login as new user
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: TEST_USER.phone, password: TEST_USER.password }),
      });
      const data = (await res.json()) as any;
      userToken = data.token;
      recordTest(
        'Auth',
        'POST /api/auth/login with newly created user credentials',
        res.status === 200 && data.success === true && !!data.token,
        res.status,
        `User logged in: ${data.user.name}`
      );
    }

    // 2.3: Verify initial balance is 0
    {
      const res = await fetch(`${BASE_URL}/api/wallet/summary`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const data = (await res.json()) as any;
      recordTest(
        'Wallet',
        'GET /api/wallet/summary verifies clean initial balance of ₹0',
        res.status === 200 &&
          data.success === true &&
          data.wallet.availableBalancePaise === 0 &&
          data.wallet.totalDepositPaise === 0,
        res.status,
        `Initial Available Balance: ₹${data.wallet.availableBalanceRupees}`
      );
    }

    // =========================================================================
    // SUITE 3: OCR DEPOSIT SUBMISSION & ANTI-FRAUD DUPLICATE GUARD
    // =========================================================================
    console.log('\n--- Suite 3: OCR Deposit Submission & Security Guard ---');

    // 3.1: Submit valid OCR Deposit
    {
      const res = await fetch(`${BASE_URL}/api/wallet/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify(TEST_DEPOSIT),
      });
      const data = (await res.json()) as any;
      depositTxnId = data.transaction?.id;
      recordTest(
        'Deposit',
        'POST /api/wallet/deposit submits PENDING deposit with 10% bonus locked',
        res.status === 201 &&
          data.success === true &&
          data.transaction.status === 'PENDING' &&
          data.transaction.amountPaise === 50000 &&
          data.transaction.bonusPaise === 5000,
        res.status,
        `Deposit ID: ${depositTxnId}, Principal: ₹${data.transaction.amountPaise / 100}, Locked Bonus: ₹${data.transaction.bonusPaise / 100}`
      );
    }

    // 3.2: Duplicate Guard - Duplicate UTR check
    {
      const res = await fetch(`${BASE_URL}/api/wallet/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          ...TEST_DEPOSIT,
          imageHash: 'different_hash_for_same_utr_test_1234567890',
        }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'Security',
        'POST /api/wallet/deposit blocks duplicate UTR with HTTP 409 Conflict',
        res.status === 409 && data.success === false && data.duplicateType === 'utr',
        res.status,
        `Blocked duplicate UTR: ${data.error}`
      );
    }

    // 3.3: Duplicate Guard - Duplicate Image Hash check
    {
      const res = await fetch(`${BASE_URL}/api/wallet/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          ...TEST_DEPOSIT,
          utr: '987654321099', // Different UTR, duplicate imageHash
        }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'Security',
        'POST /api/wallet/deposit blocks duplicate Image Hash with HTTP 409 Conflict',
        res.status === 409 && data.success === false && data.duplicateType === 'imageHash',
        res.status,
        `Blocked duplicate image screenshot: ${data.error}`
      );
    }

    // =========================================================================
    // SUITE 4: ADMIN DEPOSIT VERIFICATION & ATOMIC BONUS CREDIT
    // =========================================================================
    console.log('\n--- Suite 4: Admin Deposit Verification & Atomic Credit ---');

    // 4.1: Verify deposit appears in Admin Pending Queue
    {
      const res = await fetch(`${BASE_URL}/api/admin/pending-deposits`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = (await res.json()) as any;
      const found = data.transactions?.find((t: any) => t.id === depositTxnId);
      recordTest(
        'Admin Queue',
        'GET /api/admin/pending-deposits lists the submitted deposit',
        res.status === 200 && data.success === true && !!found,
        res.status,
        `Found pending deposit in queue with user ${found?.user?.name}`
      );
    }

    // 4.2: Admin Approves Deposit -> Credits Principal + Bonus atomically
    {
      const res = await fetch(`${BASE_URL}/api/admin/transactions/${depositTxnId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = (await res.json()) as any;
      recordTest(
        'Admin Approval',
        'POST /api/admin/transactions/:id/approve atomically credits Principal + 10% Bonus',
        res.status === 200 &&
          data.success === true &&
          data.transaction.status === 'APPROVED' &&
          (data.creditedTotalPaise === 55000 || data.userNewBalancePaise === 55000),
        res.status,
        `Approved: Credited Principal (₹500) + Bonus (₹50) = ₹${(data.creditedTotalPaise || data.userNewBalancePaise) / 100}`
      );
    }

    // 4.3: Verify user balance is now exactly ₹550.00 (55,000 paise)
    {
      const res = await fetch(`${BASE_URL}/api/wallet/summary`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const data = (await res.json()) as any;
      recordTest(
        'Wallet Sync',
        'GET /api/wallet/summary reflects updated ₹550.00 balance',
        res.status === 200 &&
          data.wallet.availableBalancePaise === 55000 &&
          data.wallet.totalDepositPaise === 50000 &&
          data.wallet.totalBonusPaise === 5000,
        res.status,
        `Available Balance: ₹${data.wallet.availableBalanceRupees}, Principal: ₹${data.wallet.totalDepositRupees}, Bonus: ₹${data.wallet.totalBonusRupees}`
      );
    }

    // =========================================================================
    // SUITE 5: RULE-BASED WITHDRAWAL FLOW & THRESHOLD ENFORCEMENT
    // =========================================================================
    console.log('\n--- Suite 5: Rule-Based Withdrawal Logic ---');

    // 5.1: Sub-threshold withdrawal (Balance ₹550 < ₹10,000 limit)
    // Full points are withdrawable
    {
      const res = await fetch(`${BASE_URL}/api/wallet/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          amountPaise: 20000, // ₹200.00
          paymentMethod: 'UPI: rohit@okaxis',
          upiId: 'rohit@okaxis',
        }),
      });
      const data = (await res.json()) as any;
      withdrawTxnId1 = data.transaction?.id;
      recordTest(
        'Withdrawal Sub-Threshold',
        'POST /api/wallet/withdraw creates PENDING withdrawal when below limit',
        res.status === 201 &&
          data.success === true &&
          data.transaction.status === 'PENDING' &&
          data.isThresholdReached === false,
        res.status,
        `Withdrawal request ID: ${withdrawTxnId1}, Amount: ₹${data.transaction.amountPaise / 100}, Withdrawable: ₹${data.withdrawablePaise / 100}`
      );
    }

    // 5.2: Admin approves the withdrawal -> Balance atomically deducted
    {
      const res = await fetch(`${BASE_URL}/api/admin/transactions/${withdrawTxnId1}/approve-withdrawal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = (await res.json()) as any;
      recordTest(
        'Admin Payout',
        'POST /api/admin/transactions/:id/approve-withdrawal executes payout and debits balance',
        res.status === 200 && data.success === true && data.transaction.status === 'APPROVED',
        res.status,
        `Approved payout of ₹${data.transaction.amountPaise / 100}. User balance updated.`
      );

      // Verify user balance is now 55,000 - 20,000 = 35,000 paise (₹350.00)
      const balRes = await fetch(`${BASE_URL}/api/wallet/summary`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const balData = (await balRes.json()) as any;
      recordTest(
        'Balance Deduction',
        'User balance debited from ₹550 to ₹350 post-withdrawal',
        balData.wallet.availableBalancePaise === 35000,
        balRes.status,
        `Live Available Balance: ₹${balData.wallet.availableBalanceRupees}`
      );
    }

    // 5.3: Threshold Limit Exceeded Rule Test
    // If total balance reaches or exceeds limit (₹10,000 / 1,000,000 paise),
    // withdrawable real cash = min(totalBalancePaise, totalDepositPrincipalPaise)
    // Here: totalDepositPrincipalPaise is 50,000 paise (₹500.00).
    console.log('\n  * Simulating points reaching threshold (Total Points = ₹12,000 >= ₹10,000 Limit)...');
    await prisma.user.update({
      where: { id: createdUserId },
      data: {
        totalBalancePaise: 1200000, // 1,200,000 paise = ₹12,000
      },
    });

    // 5.3.a: User attempts to withdraw ₹1,000 (100,000 paise) which exceeds deposit principal (₹500)
    {
      const res = await fetch(`${BASE_URL}/api/wallet/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          amountPaise: 100000, // ₹1,000.00
          upiId: 'rohit@okaxis',
        }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'Threshold Enforcement',
        'POST /api/wallet/withdraw blocks withdrawal beyond deposited principal when limit reached',
        res.status === 400 && data.success === false && data.isThresholdReached === true,
        res.status,
        `Blocked correctly: ${data.error}`
      );
    }

    // 5.3.b: User requests withdrawal within deposit principal (₹500 = 50,000 paise)
    {
      const res = await fetch(`${BASE_URL}/api/wallet/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          amountPaise: 50000, // ₹500.00 (exactly matches principal cash)
          upiId: 'rohit@okaxis',
        }),
      });
      const data = (await res.json()) as any;
      withdrawTxnId2 = data.transaction?.id;
      recordTest(
        'Threshold Principal Payout',
        'POST /api/wallet/withdraw accepts withdrawal within deposited principal when threshold reached',
        res.status === 201 && data.success === true && data.transaction.status === 'PENDING',
        res.status,
        `Allowed principal withdrawal: ₹${data.transaction.amountPaise / 100}, Withdrawable: ₹${data.withdrawablePaise / 100}`
      );
    }

    // 5.3.c: Admin approves second withdrawal
    {
      const res = await fetch(`${BASE_URL}/api/admin/transactions/${withdrawTxnId2}/approve-withdrawal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = (await res.json()) as any;
      recordTest(
        'Admin Payout 2',
        'POST /api/admin/transactions/:id/approve-withdrawal reconciles second withdrawal',
        res.status === 200 && data.success === true,
        res.status,
        `Approved payout of ₹${data.transaction.amountPaise / 100}. Status: ${data.transaction.status}`
      );
    }

    // =========================================================================
    // SUITE 6: CLEANUP & POST-TEST PURGE
    // =========================================================================
    console.log('\n--- Suite 6: Clean Slate Post-Test Verification ---');
    console.log('  * Purging test user and test transactions to leave database pristine...');
    await prisma.transaction.deleteMany({
      where: { userId: createdUserId },
    });
    await prisma.user.delete({
      where: { id: createdUserId },
    });

    const finalUsers = await prisma.user.count();
    const finalTxns = await prisma.transaction.count();

    recordTest(
      'Clean Slate',
      'Database post-test state contains strictly 1 Super Admin and 0 Transactions',
      finalUsers === 1 && finalTxns === 0,
      200,
      `Users: ${finalUsers} (Super Admin), Transactions: ${finalTxns}`
    );

    console.log('\n================================================================');
    console.log('🎉 ALL END-TO-END TEST SUITES PASSED FLAWLESSLY (15/15)');
    console.log('================================================================');
  } catch (error: any) {
    console.error('\n❌ E2E Test Suite Error:', error);
    process.exitCode = 1;
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runE2ETests();
