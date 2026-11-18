import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { TransactionType, TransactionStatus } from '@prisma/client';

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
        bonusThresholdLimitPaise: true,
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

    // 4. Calculate bonus based on user's bonus percentage
    const bonusRate = user.bonusPercentage || 10.0;
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
 * User creates a withdrawal request with rule-based threshold evaluation.
 * If totalBalancePaise >= bonusThresholdLimitPaise, withdrawablePaise = min(totalBalancePaise, totalDepositPrincipalPaise).
 * Otherwise, full balance is withdrawable.
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
      paymentApp,
      paymentMethod,
      upiId,
      bankDetails,
      notes,
    } = req.body;

    const parsedAmountPaise = Number(amountPaise);
    if (isNaN(parsedAmountPaise) || parsedAmountPaise <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Withdrawal amount must be a positive integer in paise.',
      });
    }

    // 1. Fetch user with current balance and threshold limit
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        totalBalancePaise: true,
        bonusThresholdLimitPaise: true,
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

    // 2. Check total points sufficiency
    if (user.totalBalancePaise < parsedAmountPaise) {
      return res.status(400).json({
        success: false,
        error: `Insufficient wallet balance. Total points: ₹${(
          user.totalBalancePaise / 100
        ).toFixed(2)}, Requested: ₹${(parsedAmountPaise / 100).toFixed(2)}.`,
      });
    }

    // 3. Compute total approved deposit principal
    const depositAggregate = await prisma.transaction.aggregate({
      where: {
        userId,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.APPROVED,
      },
      _sum: {
        amountPaise: true,
      },
    });
    const totalDepositPrincipalPaise = depositAggregate._sum.amountPaise || 0;

    // 4. Rule-Based Withdrawal Logic:
    // If totalBalancePaise >= bonusThresholdLimitPaise,
    // withdrawablePaise = min(totalBalancePaise, totalDepositPrincipalPaise) (bonus points excluded beyond limit).
    // Otherwise, full eligible balance is withdrawable.
    const isThresholdReached =
      user.totalBalancePaise >= user.bonusThresholdLimitPaise;
    const maxWithdrawablePaise = isThresholdReached
      ? Math.min(user.totalBalancePaise, totalDepositPrincipalPaise)
      : user.totalBalancePaise;

    if (parsedAmountPaise > maxWithdrawablePaise) {
      return res.status(400).json({
        success: false,
        error: `Requested withdrawal amount ₹${(
          parsedAmountPaise / 100
        ).toFixed(2)} exceeds your eligible withdrawable real cash limit of ₹${(
          maxWithdrawablePaise / 100
        ).toFixed(2)}. Because your total points (₹${(
          user.totalBalancePaise / 100
        ).toFixed(2)}) have reached or exceeded your threshold limit of ₹${(
          user.bonusThresholdLimitPaise / 100
        ).toFixed(2)}, bonus points cannot be withdrawn.`,
        isThresholdReached,
        maxWithdrawablePaise,
        totalBalancePaise: user.totalBalancePaise,
        bonusThresholdLimitPaise: user.bonusThresholdLimitPaise,
        totalDepositPrincipalPaise,
      });
    }

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

    // 5. Create PENDING withdrawal transaction record
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING,
        amountPaise: parsedAmountPaise,
        bonusPaise: 0,
        withdrawablePaise: maxWithdrawablePaise,
        paymentApp: paymentAppStr,
        rejectionReason: notes || null,
        rawOcrData: rawData || undefined,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request created. Awaiting administrator approval.',
      transaction,
      withdrawablePaise: maxWithdrawablePaise,
      isThresholdReached,
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
          bonusThresholdLimitPaise: true,
        },
      }),
      prisma.transaction.findMany({
        where: { userId },
      }),
    ]);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    let totalDepositPaise = 0;
    let totalBonusPaise = 0;
    let totalWithdrawalPaise = 0;
    let pendingDepositCount = 0;
    let pendingWithdrawalCount = 0;

    for (const txn of transactions) {
      if (txn.type === 'DEPOSIT') {
        if (txn.status === 'APPROVED') {
          totalDepositPaise += txn.amountPaise;
          totalBonusPaise += txn.bonusPaise;
        } else if (txn.status === 'PENDING') {
          pendingDepositCount += 1;
        }
      } else if (txn.type === 'WITHDRAWAL') {
        if (txn.status === 'APPROVED') {
          totalWithdrawalPaise += txn.amountPaise;
        } else if (txn.status === 'PENDING') {
          pendingWithdrawalCount += 1;
        }
      } else if (txn.type === 'BONUS' && txn.status === 'APPROVED') {
        totalBonusPaise += txn.amountPaise;
      }
    }

    const isThresholdReached =
      user.totalBalancePaise >= user.bonusThresholdLimitPaise;
    const withdrawablePaise = isThresholdReached
      ? Math.min(user.totalBalancePaise, totalDepositPaise)
      : user.totalBalancePaise;

    return res.status(200).json({
      success: true,
      wallet: {
        userId: user.id,
        availableBalancePaise: user.totalBalancePaise,
        availableBalanceRupees: user.totalBalancePaise / 100,
        withdrawablePaise,
        withdrawableRupees: withdrawablePaise / 100,
        isThresholdReached,
        bonusThresholdLimitPaise: user.bonusThresholdLimitPaise,
        bonusThresholdLimitRupees: user.bonusThresholdLimitPaise / 100,
        totalDepositPaise,
        totalDepositRupees: totalDepositPaise / 100,
        totalBonusPaise,
        totalBonusRupees: totalBonusPaise / 100,
        totalWithdrawalPaise,
        totalWithdrawalRupees: totalWithdrawalPaise / 100,
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

