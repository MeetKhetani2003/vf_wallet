import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { Role, TransactionType, TransactionStatus } from '@prisma/client';
import { isClientRole } from '../utils/permissions';

/**
 * POST /api/admin/clients/:clientId/deposit
 * Auto-Accept Deposit for a selected Client (via OCR screenshot upload or manual entry).
 * - Enforces granular employee permissions:
 *     - OCR upload requires `canOcrUpload` (or Super Admin)
 *     - Manual deposit requires `canDeposit` (or Super Admin)
 * - Enforces Anti-Fraud Duplicate UTR & SHA-256 Image Hash checks (HTTP 409).
 * - Atomically creates an APPROVED transaction and credits Principal + Custom Bonus to client.
 */
export const createClientDeposit = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const { clientId } = req.params;
    const {
      amountPaise,
      amount,
      utr,
      imageHash,
      imageUrl,
      screenshotUri,
      paymentApp,
      rawOcrData,
      submissionSource,
      notes,
    } = req.body;

    const isOcrSubmission =
      submissionSource === 'ocr' ||
      submissionSource === 'gallery' ||
      submissionSource === 'whatsapp_share' ||
      Boolean(imageHash || imageUrl || screenshotUri);

    // Granular Permission Check
    if (!req.user.isSuperAdmin) {
      if (isOcrSubmission && !req.user.permissions.canOcrUpload) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You do not have OCR Upload permission.',
        });
      }
      if (!isOcrSubmission && !req.user.permissions.canDeposit) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You do not have Direct Deposit permission.',
        });
      }
    }

    // Parse positive integer amount in paise
    let parsedAmountPaise = Number(amountPaise);
    if (isNaN(parsedAmountPaise) || parsedAmountPaise <= 0) {
      if (amount !== undefined && !isNaN(Number(amount))) {
        parsedAmountPaise = Math.round(Number(amount) * 100);
      }
    }

    if (isNaN(parsedAmountPaise) || parsedAmountPaise <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Deposit amount must be a positive value.',
      });
    }

    // Validate Client account
    const client = await prisma.user.findUnique({
      where: { id: clientId },
    });

    if (!client || !isClientRole(client.role)) {
      return res.status(404).json({
        success: false,
        error: 'Target client account not found.',
      });
    }

    if (client.isBlocked) {
      return res.status(403).json({
        success: false,
        error: `Client "${client.name}" is currently blocked and cannot receive deposits.`,
      });
    }

    const cleanUtr =
      utr && typeof utr === 'string' && utr.trim() ? utr.trim() : null;
    const cleanImageHash =
      imageHash && typeof imageHash === 'string' && imageHash.trim()
        ? imageHash.trim()
        : null;

    // 1. Anti-fraud: Check duplicate screenshot hash
    if (cleanImageHash) {
      const existingHash = await prisma.transaction.findFirst({
        where: {
          imageHash: cleanImageHash,
          status: { in: [TransactionStatus.PENDING, TransactionStatus.APPROVED] },
        },
      });

      if (existingHash) {
        return res.status(409).json({
          success: false,
          error: 'This payment screenshot has already been uploaded and processed.',
          duplicateType: 'imageHash',
          existingTransactionId: existingHash.id,
        });
      }
    }

    // 2. Anti-fraud: Check duplicate UTR reference
    if (cleanUtr) {
      const existingUtr = await prisma.transaction.findFirst({
        where: {
          utr: cleanUtr,
          status: { in: [TransactionStatus.PENDING, TransactionStatus.APPROVED] },
        },
      });

      if (existingUtr) {
        return res.status(409).json({
          success: false,
          error: `Duplicate UTR detected: Transaction reference "${cleanUtr}" already exists.`,
          duplicateType: 'utr',
          existingTransactionId: existingUtr.id,
        });
      }
    }

    // 3. Calculate bonus based on Client's custom bonusPercentage
    const bonusRate = client.bonusPercentage ?? 10.0;
    const calculatedBonusPaise = Math.round((parsedAmountPaise * bonusRate) / 100);
    const totalCreditPaise = parsedAmountPaise + calculatedBonusPaise;

    // 4. AUTO-ACCEPT Atomic Transaction: Create APPROVED deposit & credit client immediately
    const [transaction, updatedClient] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          userId: client.id,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.APPROVED,
          amountPaise: parsedAmountPaise,
          bonusPaise: calculatedBonusPaise,
          withdrawablePaise: 0,
          utr: cleanUtr,
          imageHash: cleanImageHash,
          imageUrl: imageUrl || screenshotUri || null,
          paymentApp: paymentApp || (isOcrSubmission ? 'UPI OCR' : 'Direct Deposit'),
          rawOcrData: rawOcrData
            ? { ...(typeof rawOcrData === 'object' ? rawOcrData : {}), notes: notes || undefined }
            : notes
            ? { notes }
            : undefined,
          processedByAdminId: req.user.userId,
          processedByName: req.user.name,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              bonusPercentage: true,
              bonusThresholdLimitPaise: true,
              totalBalancePaise: true,
            },
          },
        },
      }),
      prisma.user.update({
        where: { id: client.id },
        data: {
          totalBalancePaise: {
            increment: totalCreditPaise,
          },
        },
        select: {
          id: true,
          name: true,
          totalBalancePaise: true,
        },
      }),
    ]);

    return res.status(201).json({
      success: true,
      message: `Deposit auto-accepted! Credited ₹${(totalCreditPaise / 100).toFixed(
        2
      )} (Principal: ₹${(parsedAmountPaise / 100).toFixed(2)} + ${bonusRate}% Bonus: ₹${(
        calculatedBonusPaise / 100
      ).toFixed(2)}) to ${updatedClient.name}.`,
      transaction: {
        ...transaction,
        bonusPercentage: bonusRate,
        totalCreditPaise,
      },
      creditedTotalPaise: totalCreditPaise,
      clientNewBalancePaise: updatedClient.totalBalancePaise,
    });
  } catch (error: any) {
    console.error('Error in createClientDeposit:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process client deposit.',
    });
  }
};

/**
 * POST /api/admin/clients/:clientId/withdraw
 * Auto-Accept Rule-Based Withdrawal for a selected Client.
 * - Requires `canWithdraw` permission (or Super Admin).
 * - Enforces Threshold Rule:
 *     If client.totalBalancePaise >= client.bonusThresholdLimitPaise:
 *       withdrawablePaise = min(client.totalBalancePaise, totalDepositPrincipalPaise)
 *     Else:
 *       withdrawablePaise = client.totalBalancePaise
 * - Atomically creates an APPROVED withdrawal and debits client's balance immediately.
 */
export const createClientWithdrawal = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    if (!req.user.isSuperAdmin && !req.user.permissions.canWithdraw) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You do not have Withdrawal permission.',
      });
    }

    const { clientId } = req.params;
    const {
      amountPaise,
      amount,
      paymentApp,
      paymentMethod,
      upiId,
      bankDetails,
      notes,
    } = req.body;

    let parsedAmountPaise = Number(amountPaise);
    if (isNaN(parsedAmountPaise) || parsedAmountPaise <= 0) {
      if (amount !== undefined && !isNaN(Number(amount))) {
        parsedAmountPaise = Math.round(Number(amount) * 100);
      }
    }

    if (isNaN(parsedAmountPaise) || parsedAmountPaise <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Withdrawal amount must be a positive value.',
      });
    }

    const client = await prisma.user.findUnique({
      where: { id: clientId },
    });

    if (!client || !isClientRole(client.role)) {
      return res.status(404).json({
        success: false,
        error: 'Target client account not found.',
      });
    }

    if (client.isBlocked) {
      return res.status(403).json({
        success: false,
        error: `Client "${client.name}" is currently blocked and cannot withdraw funds.`,
      });
    }

    // 1. Check total balance sufficiency
    if (client.totalBalancePaise < parsedAmountPaise) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance for ${client.name}. Available: ₹${(
          client.totalBalancePaise / 100
        ).toFixed(2)}, Requested: ₹${(parsedAmountPaise / 100).toFixed(2)}.`,
      });
    }

    // 2. Compute total approved deposit principal
    const depositAggregate = await prisma.transaction.aggregate({
      where: {
        userId: client.id,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.APPROVED,
      },
      _sum: { amountPaise: true },
    });
    const totalDepositPrincipalPaise = depositAggregate._sum.amountPaise || 0;

    // 3. Rule-Based Threshold Enforcement
    const isThresholdReached =
      client.totalBalancePaise >= client.bonusThresholdLimitPaise;
    const maxWithdrawablePaise = isThresholdReached
      ? Math.min(client.totalBalancePaise, totalDepositPrincipalPaise)
      : client.totalBalancePaise;

    if (parsedAmountPaise > maxWithdrawablePaise) {
      return res.status(400).json({
        success: false,
        error: `Requested withdrawal ₹${(parsedAmountPaise / 100).toFixed(
          2
        )} exceeds ${client.name}'s eligible withdrawable cash limit of ₹${(
          maxWithdrawablePaise / 100
        ).toFixed(2)}. Because total balance (₹${(
          client.totalBalancePaise / 100
        ).toFixed(2)}) reached/exceeded threshold limit (₹${(
          client.bonusThresholdLimitPaise / 100
        ).toFixed(2)}), bonus points are excluded.`,
        isThresholdReached,
        maxWithdrawablePaise,
        totalDepositPrincipalPaise,
      });
    }

    const paymentAppStr = upiId
      ? `UPI: ${upiId}`
      : bankDetails?.accountNumber
      ? `Bank: ${bankDetails.bankName || 'A/C'} (${bankDetails.accountNumber})`
      : paymentApp || paymentMethod || 'Direct Payout';

    const rawData = {
      ...(bankDetails || {}),
      upiId: upiId || null,
      notes: notes || null,
    };

    // 4. AUTO-ACCEPT Atomic Transaction: Create APPROVED withdrawal & debit client balance
    const [transaction, updatedClient] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          userId: client.id,
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.APPROVED,
          amountPaise: parsedAmountPaise,
          bonusPaise: 0,
          withdrawablePaise: maxWithdrawablePaise,
          paymentApp: paymentAppStr,
          rejectionReason: notes || null,
          rawOcrData: rawData,
          processedByAdminId: req.user.userId,
          processedByName: req.user.name,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              bonusPercentage: true,
              bonusThresholdLimitPaise: true,
              totalBalancePaise: true,
            },
          },
        },
      }),
      prisma.user.update({
        where: { id: client.id },
        data: {
          totalBalancePaise: {
            decrement: parsedAmountPaise,
          },
        },
        select: {
          id: true,
          name: true,
          totalBalancePaise: true,
        },
      }),
    ]);

    return res.status(201).json({
      success: true,
      message: `Payout auto-accepted! Debited ₹${(parsedAmountPaise / 100).toFixed(
        2
      )} from ${updatedClient.name}. New balance: ₹${(
        updatedClient.totalBalancePaise / 100
      ).toFixed(2)}.`,
      transaction,
      clientNewBalancePaise: updatedClient.totalBalancePaise,
      withdrawablePaise: maxWithdrawablePaise,
      isThresholdReached,
    });
  } catch (error: any) {
    console.error('Error in createClientWithdrawal:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process client withdrawal.',
    });
  }
};

/**
 * GET /api/admin/transactions
 * Returns master ledger of transactions with filtering (status, type, userId, search, pagination).
 */
export const getAllTransactions = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { status, type, userId, search, page, limit } = req.query;

    const whereClause: any = {};

    if (
      status &&
      (status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED')
    ) {
      whereClause.status = status as TransactionStatus;
    }

    if (type && (type === 'DEPOSIT' || type === 'WITHDRAWAL' || type === 'BONUS')) {
      whereClause.type = type as TransactionType;
    }

    if (userId && typeof userId === 'string') {
      whereClause.userId = userId;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      whereClause.OR = [
        { utr: { contains: q, mode: 'insensitive' } },
        { paymentApp: { contains: q, mode: 'insensitive' } },
        { processedByName: { contains: q, mode: 'insensitive' } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q } } },
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [total, transactions] = await Promise.all([
      prisma.transaction.count({ where: whereClause }),
      prisma.transaction.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              bonusPercentage: true,
              isBlocked: true,
              totalBalancePaise: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      transactions: transactions.map((t) => ({
        ...t,
        totalCreditPaise:
          t.type === 'DEPOSIT' ? t.amountPaise + t.bonusPaise : undefined,
      })),
    });
  } catch (error: any) {
    console.error('Error in getAllTransactions:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve transactions.',
    });
  }
};

/**
 * GET /api/admin/stats
 * Clean Operational KPI Metrics for Dashboard (Auto-Accept System).
 * Per specification: NO Liability Wallet and NO Pending Approval Request Queues.
 */
export const getAdminStats = async (
  _req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const [totalClients, totalEmployees, transactions] = await Promise.all([
      prisma.user.count({ where: { role: { in: [Role.CLIENT, Role.USER] } } }),
      prisma.user.count({ where: { role: Role.EMPLOYEE } }),
      prisma.transaction.findMany({
        where: { status: TransactionStatus.APPROVED },
        select: {
          type: true,
          amountPaise: true,
          bonusPaise: true,
        },
      }),
    ]);

    let totalApprovedDepositsPaise = 0;
    let totalApprovedWithdrawalsPaise = 0;
    let totalBonusGivenPaise = 0;

    for (const txn of transactions) {
      if (txn.type === TransactionType.DEPOSIT) {
        totalApprovedDepositsPaise += txn.amountPaise;
        totalBonusGivenPaise += txn.bonusPaise;
      } else if (txn.type === TransactionType.WITHDRAWAL) {
        totalApprovedWithdrawalsPaise += txn.amountPaise;
      } else if (txn.type === TransactionType.BONUS) {
        totalBonusGivenPaise += txn.amountPaise;
      }
    }

    return res.status(200).json({
      success: true,
      stats: {
        totalClients,
        totalEmployees,
        totalUsers: totalClients,
        totalTransactionsCount: transactions.length,
        totalApprovedDepositsPaise,
        totalApprovedDepositsRupees: totalApprovedDepositsPaise / 100,
        totalApprovedWithdrawalsPaise,
        totalApprovedWithdrawalsRupees: totalApprovedWithdrawalsPaise / 100,
        totalBonusGivenPaise,
        totalBonusGivenRupees: totalBonusGivenPaise / 100,
      },
    });
  } catch (error: any) {
    console.error('Error fetching admin stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve operational statistics.',
    });
  }
};
