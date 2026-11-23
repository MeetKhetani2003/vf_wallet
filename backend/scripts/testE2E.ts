process.env.NODE_ENV = 'test';

import dotenv from 'dotenv';
import path from 'path';
import { AddressInfo } from 'net';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function recordTest(
  suite: string,
  testCase: string,
  passed: boolean,
  status: number | string,
  detail: string
) {
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} [${suite}] ${testCase} (${status}) -> ${detail}`);
  if (!passed) {
    throw new Error(`Test failed: [${suite}] ${testCase}`);
  }
}

async function runE2ETests() {
  console.log('================================================================');
  console.log('🧪 [E2E] Staff RBAC, Client Accounts & Auto-Accept API Test Suite');
  console.log('================================================================\n');

  const { app, prisma } = await import('../src/server');
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const BASE_URL = `http://localhost:${port}`;
  console.log(`🚀 Ephemeral Test Server running at: ${BASE_URL}\n`);

  const CLIENT_PHONE = '9820011223';
  const EMP_PHONE = '9820099887';
  const TEST_UTR = '987654321098';
  const TEST_HASH = 'sha256_auto_accept_receipt_hash_test_001';

  let adminToken = '';
  let employeeToken = '';
  let clientId = '';
  let employeeId = '';

  try {
    // Cleanup any leftovers before starting
    const leftovers = await prisma.user.findMany({
      where: { phone: { in: [CLIENT_PHONE, EMP_PHONE] } },
    });
    for (const u of leftovers) {
      await prisma.transaction.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
    await prisma.transaction.deleteMany({
      where: { OR: [{ utr: TEST_UTR }, { imageHash: TEST_HASH }] },
    });

    // =========================================================================
    // SUITE 1: SUPER ADMIN AUTH
    // =========================================================================
    console.log('--- Suite 1: Super Admin Authentication ---');
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
        'Super Admin login succeeds with all permissions',
        res.status === 200 &&
          data.success === true &&
          data.user.isSuperAdmin === true &&
          data.user.permissions.canOcrUpload === true,
        res.status,
        `Logged in as ${data.user.name} (${data.user.role})`
      );
    }

    // =========================================================================
    // SUITE 2: CLIENT CREATION (NO LOGIN REQUIRED) & LOGIN BLOCK
    // =========================================================================
    console.log('\n--- Suite 2: Client Account Creation (No Login) ---');
    {
      const res = await fetch(`${BASE_URL}/api/admin/users/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Rohit Client',
          phone: CLIENT_PHONE,
          userType: 'CLIENT',
          upiId: 'rohit@okaxis',
          bonusPercentage: 10.0,
          bonusThresholdLimit: 10000,
        }),
      });
      const data = (await res.json()) as any;
      clientId = data.user?.id;
      recordTest(
        'Client',
        'Create CLIENT without password succeeds',
        res.status === 201 &&
          data.success === true &&
          data.user.accountType === 'CLIENT' &&
          data.user.totalBalancePaise === 0,
        res.status,
        `Client created: ${data.user.name} (ID: ${clientId})`
      );
    }

    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: CLIENT_PHONE, password: 'anypassword' }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'Client Security',
        'Client accounts are blocked from logging in (HTTP 403)',
        res.status === 403 && data.success === false,
        res.status,
        data.error
      );
    }

    // =========================================================================
    // SUITE 3: EMPLOYEE CREATION & GRANULAR PERMISSION ENFORCEMENT
    // =========================================================================
    console.log('\n--- Suite 3: Employee Creation & RBAC Permissions ---');
    {
      const res = await fetch(`${BASE_URL}/api/admin/users/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Karan Staff',
          phone: EMP_PHONE,
          password: 'Staff@123',
          userType: 'EMPLOYEE',
          permissions: {
            canOcrUpload: true,
            canDeposit: false,
            canWithdraw: false,
            canSetBonus: false,
            canSetThreshold: false,
            canManageClients: false,
          },
        }),
      });
      const data = (await res.json()) as any;
      employeeId = data.user?.id;
      recordTest(
        'Employee',
        'Super Admin creates EMPLOYEE with OCR-only permission',
        res.status === 201 &&
          data.success === true &&
          data.user.accountType === 'EMPLOYEE' &&
          data.user.permissions.canOcrUpload === true &&
          data.user.permissions.canWithdraw === false,
        res.status,
        `Employee created: ${data.user.name} (OCR-only)`
      );
    }

    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: EMP_PHONE, password: 'Staff@123' }),
      });
      const data = (await res.json()) as any;
      employeeToken = data.token;
      recordTest(
        'Employee Auth',
        'Employee logs in and receives resolved permissions',
        res.status === 200 &&
          !!data.token &&
          data.user.isSuperAdmin === false &&
          data.user.permissions.canOcrUpload === true,
        res.status,
        `Logged in as ${data.user.name}`
      );
    }

    // Employee without canWithdraw is blocked from withdrawing
    {
      const res = await fetch(`${BASE_URL}/api/admin/clients/${clientId}/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({ amountPaise: 10000 }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'RBAC Guard',
        'Employee without canWithdraw is blocked with 403',
        res.status === 403 && data.success === false,
        res.status,
        data.error
      );
    }

    // Employee without canSetBonus is blocked from updating bonus %
    {
      const res = await fetch(`${BASE_URL}/api/admin/users/${clientId}/bonus-config`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({ bonusPercentage: 15 }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'RBAC Guard',
        'Employee without canSetBonus is blocked with 403',
        res.status === 403 && data.success === false,
        res.status,
        data.error
      );
    }

    // Employee without canDeposit is blocked from manual deposit
    {
      const res = await fetch(`${BASE_URL}/api/admin/clients/${clientId}/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({ amountPaise: 50000, submissionSource: 'manual' }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'RBAC Guard',
        'Employee without canDeposit is blocked from manual deposit (403)',
        res.status === 403 && data.success === false,
        res.status,
        data.error
      );
    }

    // =========================================================================
    // SUITE 4: AUTO-ACCEPT OCR DEPOSIT & DUPLICATE GUARD
    // =========================================================================
    console.log('\n--- Suite 4: Auto-Accept OCR Deposit & Anti-Fraud ---');
    {
      const res = await fetch(`${BASE_URL}/api/admin/clients/${clientId}/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({
          amountPaise: 50000, // ₹500
          utr: TEST_UTR,
          imageHash: TEST_HASH,
          paymentApp: 'PhonePe',
          submissionSource: 'ocr',
        }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'Auto-Accept Deposit',
        'Employee with canOcrUpload auto-credits Client ₹500 + 10% bonus (₹550) as APPROVED',
        res.status === 201 &&
          data.success === true &&
          data.transaction.status === 'APPROVED' &&
          data.clientNewBalancePaise === 55000,
        res.status,
        `Auto-approved! Client new balance: ₹${data.clientNewBalancePaise / 100}`
      );
    }

    // Duplicate UTR guard
    {
      const res = await fetch(`${BASE_URL}/api/admin/clients/${clientId}/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({
          amountPaise: 50000,
          utr: TEST_UTR,
          imageHash: 'different_hash_999',
          submissionSource: 'ocr',
        }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'Anti-Fraud',
        'Duplicate UTR is blocked with HTTP 409 Conflict',
        res.status === 409 && data.duplicateType === 'utr',
        res.status,
        data.error
      );
    }

    // Duplicate Image Hash guard
    {
      const res = await fetch(`${BASE_URL}/api/admin/clients/${clientId}/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({
          amountPaise: 50000,
          utr: '987654321099',
          imageHash: TEST_HASH,
          submissionSource: 'ocr',
        }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'Anti-Fraud',
        'Duplicate Image Hash is blocked with HTTP 409 Conflict',
        res.status === 409 && data.duplicateType === 'imageHash',
        res.status,
        data.error
      );
    }

    // =========================================================================
    // SUITE 5: UPDATE PERMISSIONS & AUTO-ACCEPT RULE-BASED WITHDRAWAL
    // =========================================================================
    console.log('\n--- Suite 5: Permission Upgrade & Auto-Accept Withdrawals ---');
    {
      const res = await fetch(
        `${BASE_URL}/api/admin/users/${employeeId}/permissions`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            permissions: {
              canOcrUpload: true,
              canDeposit: true,
              canWithdraw: true,
              canSetBonus: true,
              canSetThreshold: true,
              canManageClients: true,
            },
          }),
        }
      );
      const data = (await res.json()) as any;
      recordTest(
        'Permissions',
        'Super Admin grants full operational permissions to Employee',
        res.status === 200 && data.user.permissions.canWithdraw === true,
        res.status,
        'Permissions updated live'
      );
    }

    // Employee processes sub-threshold instant withdrawal (₹200)
    {
      const res = await fetch(`${BASE_URL}/api/admin/clients/${clientId}/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({
          amountPaise: 20000, // ₹200
          upiId: 'rohit@okaxis',
        }),
      });
      const data = (await res.json()) as any;
      recordTest(
        'Auto-Accept Withdraw',
        'Employee instantly debits Client ₹200 as APPROVED (₹550 -> ₹350)',
        res.status === 201 &&
          data.transaction.status === 'APPROVED' &&
          data.clientNewBalancePaise === 35000,
        res.status,
        `Remaining balance: ₹${data.clientNewBalancePaise / 100}`
      );
    }

    // Threshold Exceeded Rule Enforcement
    await prisma.user.update({
      where: { id: clientId },
      data: { totalBalancePaise: 1200000 }, // ₹12,000 >= ₹10,000 threshold
    });

    {
      const res = await fetch(`${BASE_URL}/api/admin/clients/${clientId}/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({ amountPaise: 100000, upiId: 'rohit@okaxis' }), // ₹1,000 > ₹500 principal
      });
      const data = (await res.json()) as any;
      recordTest(
        'Threshold Rule',
        'Blocks withdrawal exceeding deposited principal when threshold reached (400)',
        res.status === 400 && data.isThresholdReached === true,
        res.status,
        data.error
      );
    }

    // =========================================================================
    // SUITE 6: DASHBOARD STATS (NO LIABILITY WALLET, NO PENDING QUEUES)
    // =========================================================================
    console.log('\n--- Suite 6: Clean Dashboard Stats Verification ---');
    {
      const res = await fetch(`${BASE_URL}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = (await res.json()) as any;
      recordTest(
        'Stats',
        'GET /api/admin/stats omits liability wallet & pending queues',
        res.status === 200 &&
          data.stats.totalWalletLiabilityPaise === undefined &&
          data.stats.pendingDepositRequestsCount === undefined &&
          data.stats.totalClients >= 1 &&
          data.stats.totalEmployees >= 1,
        res.status,
        `Clients: ${data.stats.totalClients}, Employees: ${data.stats.totalEmployees}, Deposits: ₹${data.stats.totalApprovedDepositsRupees}, Withdrawals: ₹${data.stats.totalApprovedWithdrawalsRupees}`
      );
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================
    console.log('\n--- Cleanup ---');
    await prisma.transaction.deleteMany({ where: { userId: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, employeeId] } } });

    const testUsersLeft = await prisma.user.count({
      where: { phone: { in: [CLIENT_PHONE, EMP_PHONE] } },
    });
    const testTxnsLeft = await prisma.transaction.count({
      where: { OR: [{ utr: TEST_UTR }, { imageHash: TEST_HASH }] },
    });
    recordTest(
      'Cleanup',
      'All temporary E2E test accounts & transactions removed cleanly',
      testUsersLeft === 0 && testTxnsLeft === 0,
      200,
      `Test Users Left: ${testUsersLeft}, Test Txns Left: ${testTxnsLeft}`
    );

    console.log('\n================================================================');
    console.log('🎉 ALL 14 END-TO-END TESTS PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } catch (error) {
    console.error('\n❌ E2E Test Suite Error:', error);
    process.exitCode = 1;
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runE2ETests();
