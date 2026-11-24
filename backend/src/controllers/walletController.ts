import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { TransactionType, TransactionStatus } from '@prisma/client';
import { getRunningDailyBonusRate } from '../utils/dailyBonus';

/**
 * POST /api/wallet/deposit
 * User creates a deposit request (from OCR or manual).
 * Validates duplicate imageHash and UTR to prevent double-spending.
 * Locks snapshot bonus rate based on user's custom bonusPercentage.
 */
export const createDepositRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    const userId = req.user.userId;
    const {
      amountPaise,
      amount,
      utr,
      imageHash,
      imageUrl,
      screenshotUri,
      paymentApp,
      rawOcrData,
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
        error: 'Deposit amount must be a positive integer in paise.',
      });
    }

    const cleanUtr = utr && typeof utr === 'string' && utr.trim() ? utr.trim() : null;
    const cleanImageHash =
      imageHash && typeof imageHash === 'string' && imageHash.trim()
        ? imageHash.trim()
        : null;

    // 1. Anti-fraud: Check duplicate screenshot image hash
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
          error: 'This payment screenshot has already been submitted.',
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
          error: 'This transaction reference (UTR) already exists.',
          duplicateType: 'utr',
          existingTransactionId: existingUtr.id,
        });
      }
    }

    // 3. Fetch latest user bonus configuration
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        bonusPercentage: true,
        isBlocked: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been suspended by an administrator.',
      });
    }

    // 4. Calculate bonus based on user's custom bonus percentage or daily running bonus
    const dailyBonusInfo = await getRunningDailyBonusRate();
    const bonusRate =
      user.bonusPercentage && user.bonusPercentage > 0
        ? user.bonusPercentage
        : dailyBonusInfo.isActive
        ? dailyBonusInfo.percentage
        : 0.0;
    const calculatedBonusPaise = Math.round((parsedAmountPaise * bonusRate) / 100);

    // 5. Create PENDING deposit transaction
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.PENDING,
        amountPaise: parsedAmountPaise,
        bonusPaise: calculatedBonusPaise,
        withdrawablePaise: 0,
        utr: cleanUtr,
        imageHash: cleanImageHash,
        imageUrl: imageUrl || screenshotUri || null,
        paymentApp: paymentApp || null,
        rawOcrData: rawOcrData || undefined,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Deposit request submitted successfully. Pending admin verification.',
      transaction: {
        ...transaction,
        bonusPercentage: bonusRate,
        totalCreditPaise: transaction.amountPaise + transaction.bonusPaise,
      },
    });
  } catch (error: any) {
    console.error('Error creating deposit request:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process deposit request.',
    });
  }
};

/**
 * POST /api/wallet/withdraw
 * User creates a withdrawal request with points cycle deduction rules.
 * Debits points balance. If qualifying cashout (reaches balance or previous deposit),
 * active cycle bonus is deducted from cash payout.
 */
export const createWithdrawalRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    const userId = req.user.userId;
    const {
      amountPaise,
      amount,
      paymentApp,
      paymentMethod,
      upiId,
      bankDetails,
      notes,
      imageUrl,
      screenshotUri,
      imageHash,
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
        error: 'Withdrawal amount must be a positive integer in paise.',
      });
    }

    // 1. Fetch user with current balance and cycle tracking fields
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        totalBalancePaise: true,
        activeBonusPaise: true,
        lastDepositAmountPaise: true,
        cycleWithdrawnPaise: true,
        isBonusDeductedInCycle: true,
        isBlocked: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been suspended by an administrator.',
      });
    }

    // 2. Points & Cycle Deduction Rules:
    // Withdrawal is NOT restricted by current wallet points balance.
    // 1. Check if any withdrawal was already done without deposit again in this cycle:
    const wasWithdrawalAlreadyDoneInCycle = Boolean(user.isBonusDeductedInCycle);
    const activeBonusPaise = user.activeBonusPaise || 0;
    const previousCycleWithdrawn = user.cycleWithdrawnPaise || 0;
    const newCycleWithdrawn = previousCycleWithdrawn + parsedAmountPaise;

    let bonusExcludedPaise = 0;
    let isBonusDeductionTriggered = false;

    if (wasWithdrawalAlreadyDoneInCycle) {
      // If any withdrawal was already done without deposit again, give all demanded points
      bonusExcludedPaise = 0;
      isBonusDeductionTriggered = false;
    } else {
      // If withdrawal is equal to balance or greater than balance: deduct bonus points from last deposit
      if (parsedAmountPaise >= user.totalBalancePaise && activeBonusPaise > 0) {
        bonusExcludedPaise = activeBonusPaise;
        isBonusDeductionTriggered = true;
      } else {
        bonusExcludedPaise = 0;
        isBonusDeductionTriggered = false;
      }
    }

    const expectedCashPayoutPaise = Math.max(0, parsedAmountPaise - bonusExcludedPaise);

    const paymentAppStr = upiId
      ? `UPI: ${upiId}`
      : bankDetails?.accountNumber
      ? `Bank: ${bankDetails.bankName || 'A/C'} (${bankDetails.accountNumber})`
      : paymentApp || paymentMethod || 'Direct Withdrawal';

    const rawData = bankDetails
      ? { ...bankDetails, upiId: upiId || null }
      : upiId
      ? { upiId }
      : undefined;

    // 4. Create PENDING withdrawal transaction record
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING,
        amountPaise: parsedAmountPaise,
        bonusPaise: bonusExcludedPaise,
        cashPaidPaise: expectedCashPayoutPaise,
        withdrawablePaise: expectedCashPayoutPaise,
        imageUrl: imageUrl || screenshotUri || null,
        imageHash: imageHash || null,
        paymentApp: paymentAppStr,
        rejectionReason: notes || null,
        rawOcrData: {
          ...(typeof rawData === 'object' ? rawData : {}),
          requestedPointsPaise: parsedAmountPaise,
          bonusExcludedPaise,
          expectedCashPayoutPaise,
          activeBonusAtStartPaise: activeBonusPaise,
          isBonusDeductionTriggered,
        },
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request created. Awaiting administrator approval.',
      transaction,
      requestedPointsPaise: parsedAmountPaise,
      bonusDeductedPaise: bonusExcludedPaise,
      expectedCashPayoutPaise,
      isBonusDeductionTriggered,
    });
  } catch (error: any) {
    console.error('Error creating withdrawal request:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process withdrawal request.',
    });
  }
};

/**
 * GET /api/wallet/transactions
 * Returns authenticated user's transaction history with filtering.
 */
export const getUserTransactions = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    const userId = req.user.userId;
    const { type, status, page, limit } = req.query;

    const whereClause: any = { userId };

    if (type && (type === 'DEPOSIT' || type === 'WITHDRAWAL' || type === 'BONUS')) {
      whereClause.type = type as TransactionType;
    }

    if (status && (status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED')) {
      whereClause.status = status as TransactionStatus;
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [total, transactions] = await Promise.all([
      prisma.transaction.count({ where: whereClause }),
      prisma.transaction.findMany({
        where: whereClause,
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
        cashPaidPaise:
          t.type === 'WITHDRAWAL'
            ? t.cashPaidPaise || Math.max(0, t.amountPaise - t.bonusPaise)
            : 0,
        bonusDeductedPaise: t.type === 'WITHDRAWAL' ? t.bonusPaise : 0,
        totalCreditPaise: t.type === 'DEPOSIT' ? t.amountPaise + t.bonusPaise : undefined,
      })),
    });
  } catch (error: any) {
    console.error('Error in getUserTransactions:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve transaction history.',
    });
  }
};

/**
 * GET /api/wallet/summary
 * Returns wallet metrics: current available balance, total approved deposits,
 * total bonuses earned, total approved withdrawals, and pending counts.
 */
export const getUserWalletSummary = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    const userId = req.user.userId;

    const [user, transactions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          phone: true,
          totalBalancePaise: true,
          bonusPercentage: true,
          activeBonusPaise: true,
          lastDepositAmountPaise: true,
          cycleWithdrawnPaise: true,
          isBonusDeductedInCycle: true,
        },
      }),
      prisma.transaction.findMany({
        where: { userId },
      }),
    ]);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    let totalCashDepositedPaise = 0;
    let totalPointsDepositedPaise = 0;
    let totalPointsWithdrawnPaise = 0;
    let totalCashWithdrawnPaise = 0;
    let totalBonusEarnedPaise = 0;
    let totalBonusDeductedPaise = 0;
    let pendingDepositCount = 0;
    let pendingWithdrawalCount = 0;

    for (const txn of transactions) {
      if (txn.type === 'DEPOSIT') {
        if (txn.status === 'APPROVED') {
          totalCashDepositedPaise += txn.amountPaise;
          totalBonusEarnedPaise += txn.bonusPaise;
          totalPointsDepositedPaise += txn.amountPaise + txn.bonusPaise;
        } else if (txn.status === 'PENDING') {
          pendingDepositCount += 1;
        }
      } else if (txn.type === 'WITHDRAWAL') {
        if (txn.status === 'APPROVED') {
          totalPointsWithdrawnPaise += txn.amountPaise;
          totalBonusDeductedPaise += txn.bonusPaise;
          totalCashWithdrawnPaise +=
            txn.cashPaidPaise || Math.max(0, txn.amountPaise - txn.bonusPaise);
        } else if (txn.status === 'PENDING') {
          pendingWithdrawalCount += 1;
        }
      } else if (txn.type === 'BONUS' && txn.status === 'APPROVED') {
        totalBonusEarnedPaise += txn.amountPaise;
        totalPointsDepositedPaise += txn.amountPaise;
      }
    }

    const hasActiveBonus = (user.activeBonusPaise || 0) > 0 && !user.isBonusDeductedInCycle;
    const activeBonusPaise = hasActiveBonus ? user.activeBonusPaise : 0;
    const netCashIfFullCashoutPaise = Math.max(0, user.totalBalancePaise - activeBonusPaise);

    return res.status(200).json({
      success: true,
      wallet: {
        userId: user.id,
        availableBalancePaise: user.totalBalancePaise,
        availableBalanceRupees: user.totalBalancePaise / 100,
        // The 4 Core Metrics
        totalCashDepositedPaise,
        totalCashDepositedRupees: totalCashDepositedPaise / 100,
        totalPointsDepositedPaise,
        totalPointsDepositedPoints: totalPointsDepositedPaise / 100,
        totalPointsWithdrawnPaise,
        totalPointsWithdrawnPoints: totalPointsWithdrawnPaise / 100,
        totalCashWithdrawnPaise,
        totalCashWithdrawnRupees: totalCashWithdrawnPaise / 100,
        totalBonusDeductedPaise,
        totalBonusDeductedRupees: totalBonusDeductedPaise / 100,

        // Bonus and Cycle Metrics
        activeBonusPaise,
        activeBonusRupees: activeBonusPaise / 100,
        isBonusDeductedInCycle: user.isBonusDeductedInCycle,
        cycleWithdrawnPaise: user.cycleWithdrawnPaise,
        lastDepositAmountPaise: user.lastDepositAmountPaise,
        withdrawablePaise: user.totalBalancePaise,
        withdrawableRupees: user.totalBalancePaise / 100,
        netCashIfFullCashoutPaise,
        netCashIfFullCashoutRupees: netCashIfFullCashoutPaise / 100,

        // Backward compatibility
        totalDepositPaise: totalCashDepositedPaise,
        totalDepositRupees: totalCashDepositedPaise / 100,
        totalBonusPaise: totalBonusEarnedPaise,
        totalBonusRupees: totalBonusEarnedPaise / 100,
        totalWithdrawalPaise: totalPointsWithdrawnPaise,
        totalWithdrawalRupees: totalPointsWithdrawnPaise / 100,
        pendingDepositCount,
        pendingWithdrawalCount,
        bonusPercentage: user.bonusPercentage,
      },
    });
  } catch (error: any) {
    console.error('Error in getUserWalletSummary:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve wallet summary.',
    });
  }
};

