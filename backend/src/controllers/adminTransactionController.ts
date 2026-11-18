import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { TransactionType, TransactionStatus } from '@prisma/client';

/**
 * GET /api/admin/transactions
 * Returns master list of transactions with filtering (status, type, search, pagination).
 */
export const getAllTransactions = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { status, type, userId, search, page, limit } = req.query;

    const whereClause: any = {};

    if (status && (status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED')) {
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
        totalCreditPaise: t.type === 'DEPOSIT' ? t.amountPaise + t.bonusPaise : undefined,
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
 * PATCH /api/admin/transactions/:id/approve-deposit
 * Approves a pending deposit.
 * Atomically credits the user's wallet: amountPaise + bonusPaise.
 */
export const approveDeposit = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const adminId = req.user?.userId;
    const { id } = req.params;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }

    if (transaction.type !== TransactionType.DEPOSIT) {
      return res.status(400).json({
        success: false,
        error: 'Only DEPOSIT transactions can be approved through this endpoint.',
      });
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      return res.status(400).json({
        success: false,
        error: `Transaction is already ${transaction.status}.`,
      });
    }

    const totalCredit = transaction.amountPaise + transaction.bonusPaise;

    // Atomic execution: update status + increment user balance
    const [updatedTxn, updatedUser] = await prisma.$transaction([
      prisma.transaction.update({
        where: { id },
        data: {
          status: TransactionStatus.APPROVED,
          processedByAdminId: adminId || null,
        },
      }),
      prisma.user.update({
        where: { id: transaction.userId },
        data: {
          totalBalancePaise: {
            increment: totalCredit,
          },
        },
        select: {
          id: true,
          name: true,
          totalBalancePaise: true,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: `Deposit approved. Credited ₹${(totalCredit / 100).toFixed(2)} (Principal: ₹${(
        transaction.amountPaise / 100
      ).toFixed(2)}, Bonus: ₹${(transaction.bonusPaise / 100).toFixed(2)}) to ${
        updatedUser.name
      }.`,
      transaction: updatedTxn,
      creditedTotalPaise: totalCredit,
      userNewBalancePaise: updatedUser.totalBalancePaise,
    });
  } catch (error: any) {
    console.error('Error approving deposit:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to approve deposit transaction.',
    });
  }
};

/**
 * PATCH /api/admin/transactions/:id/reject-deposit
 * Rejects a pending deposit with an explanation reason.
 * Does not alter wallet balance.
 */
export const rejectDeposit = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const adminId = req.user?.userId;
    const { id } = req.params;
    const { rejectionReason } = req.body;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }

    if (transaction.type !== TransactionType.DEPOSIT) {
      return res.status(400).json({
        success: false,
        error: 'Only DEPOSIT transactions can be rejected through this endpoint.',
      });
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      return res.status(400).json({
        success: false,
        error: `Transaction is already ${transaction.status}.`,
      });
    }

    const updatedTxn = await prisma.transaction.update({
      where: { id },
      data: {
        status: TransactionStatus.REJECTED,
        rejectionReason: rejectionReason || 'Deposit verification failed.',
        processedByAdminId: adminId || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Deposit request has been rejected.',
      transaction: updatedTxn,
    });
  } catch (error: any) {
    console.error('Error rejecting deposit:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to reject deposit.',
    });
  }
};

/**
 * PATCH /api/admin/transactions/:id/approve-withdrawal
 * Verifies live balance, approves withdrawal, and atomically debits wallet.
 */
export const approveWithdrawal = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const adminId = req.user?.userId;
    const { id } = req.params;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }

    if (transaction.type !== TransactionType.WITHDRAWAL) {
      return res.status(400).json({
        success: false,
        error: 'Only WITHDRAWAL transactions can be approved through this endpoint.',
      });
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      return res.status(400).json({
        success: false,
        error: `Transaction is already ${transaction.status}.`,
      });
    }

    // Re-verify current live balance
    if (transaction.user.totalBalancePaise < transaction.amountPaise) {
      return res.status(400).json({
        success: false,
        error: `Cannot approve withdrawal. User available balance (₹${(
          transaction.user.totalBalancePaise / 100
        ).toFixed(2)}) is less than requested withdrawal (₹${(
          transaction.amountPaise / 100
        ).toFixed(2)}).`,
      });
    }

    // Atomic execution: update status + decrement user balance
    const [updatedTxn, updatedUser] = await prisma.$transaction([
      prisma.transaction.update({
        where: { id },
        data: {
          status: TransactionStatus.APPROVED,
          processedByAdminId: adminId || null,
        },
      }),
      prisma.user.update({
        where: { id: transaction.userId },
        data: {
          totalBalancePaise: {
            decrement: transaction.amountPaise,
          },
        },
        select: {
          id: true,
          name: true,
          totalBalancePaise: true,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: `Withdrawal approved. Debited ₹${(
        transaction.amountPaise / 100
      ).toFixed(2)} from ${updatedUser.name}.`,
      transaction: updatedTxn,
      userNewBalancePaise: updatedUser.totalBalancePaise,
    });
  } catch (error: any) {
    console.error('Error approving withdrawal:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to approve withdrawal.',
    });
  }
};

/**
 * PATCH /api/admin/transactions/:id/reject-withdrawal
 * Rejects a withdrawal request. No balance is deducted.
 */
export const rejectWithdrawal = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const adminId = req.user?.userId;
    const { id } = req.params;
    const { rejectionReason } = req.body;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }

    if (transaction.type !== TransactionType.WITHDRAWAL) {
      return res.status(400).json({
        success: false,
        error: 'Only WITHDRAWAL transactions can be rejected through this endpoint.',
      });
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      return res.status(400).json({
        success: false,
        error: `Transaction is already ${transaction.status}.`,
      });
    }

    const updatedTxn = await prisma.transaction.update({
      where: { id },
      data: {
        status: TransactionStatus.REJECTED,
        rejectionReason: rejectionReason || 'Withdrawal rejected by administrator.',
        processedByAdminId: adminId || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Withdrawal request has been rejected.',
      transaction: updatedTxn,
    });
  } catch (error: any) {
    console.error('Error rejecting withdrawal:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to reject withdrawal.',
    });
  }
};

/**
 * GET /api/admin/stats
 * Platform KPI metrics for Admin Dashboard.
 */
export const getAdminStats = async (
  _req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const [totalUsers, users, transactions] = await Promise.all([
      prisma.user.count({ where: { role: 'USER' } }),
      prisma.user.findMany({
        where: { role: 'USER' },
        select: { totalBalancePaise: true },
      }),
      prisma.transaction.findMany({
        select: {
          type: true,
          status: true,
          amountPaise: true,
          bonusPaise: true,
        },
      }),
    ]);

    let totalApprovedDepositsPaise = 0;
    let totalApprovedWithdrawalsPaise = 0;
    let totalBonusGivenPaise = 0;
    let pendingDepositRequestsCount = 0;
    let pendingWithdrawalRequestsCount = 0;

    for (const txn of transactions) {
      if (txn.type === TransactionType.DEPOSIT) {
        if (txn.status === TransactionStatus.APPROVED) {
          totalApprovedDepositsPaise += txn.amountPaise;
          totalBonusGivenPaise += txn.bonusPaise;
        } else if (txn.status === TransactionStatus.PENDING) {
          pendingDepositRequestsCount += 1;
        }
      } else if (txn.type === TransactionType.WITHDRAWAL) {
        if (txn.status === TransactionStatus.APPROVED) {
          totalApprovedWithdrawalsPaise += txn.amountPaise;
        } else if (txn.status === TransactionStatus.PENDING) {
          pendingWithdrawalRequestsCount += 1;
        }
      } else if (txn.type === TransactionType.BONUS && txn.status === TransactionStatus.APPROVED) {
        totalBonusGivenPaise += txn.amountPaise;
      }
    }

    const totalWalletLiabilityPaise = users.reduce(
      (sum, u) => sum + u.totalBalancePaise,
      0
    );

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalApprovedDepositsPaise,
        totalApprovedDepositsRupees: totalApprovedDepositsPaise / 100,
        totalApprovedWithdrawalsPaise,
        totalApprovedWithdrawalsRupees: totalApprovedWithdrawalsPaise / 100,
        totalBonusGivenPaise,
        totalBonusGivenRupees: totalBonusGivenPaise / 100,
        totalWalletLiabilityPaise,
        totalWalletLiabilityRupees: totalWalletLiabilityPaise / 100,
        pendingDepositRequestsCount,
        pendingWithdrawalRequestsCount,
      },
    });
  } catch (error: any) {
    console.error('Error fetching admin stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve administrative statistics.',
    });
  }
};

/**
 * GET /api/admin/pending-deposits
 * Returns pending deposits awaiting screenshot verification, including user details.
 */
export const getPendingDeposits = async (
  _req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.PENDING,
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
            isBlocked: true,
            totalBalancePaise: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      total: transactions.length,
      transactions: transactions.map((t) => ({
        ...t,
        totalCreditPaise: t.amountPaise + t.bonusPaise,
      })),
    });
  } catch (error: any) {
    console.error('Error fetching pending deposits:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve pending deposits.',
    });
  }
};

/**
 * GET /api/admin/pending-withdrawals
 * Returns all PENDING withdrawal requests with user profile details,
 * calculated total deposit principal, and eligible withdrawable cash.
 */
export const getPendingWithdrawals = async (
  _req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING,
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
            isBlocked: true,
            totalBalancePaise: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = Array.from(new Set(transactions.map((t) => t.userId)));
    const depositSums = await prisma.transaction.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.APPROVED,
      },
      _sum: {
        amountPaise: true,
      },
    });

    const depositMap = new Map<string, number>();
    for (const d of depositSums) {
      depositMap.set(d.userId, d._sum.amountPaise || 0);
    }

    const enrichedTransactions = transactions.map((t) => {
      const userTotalDeposit = depositMap.get(t.userId) || 0;
      const userBal = t.user.totalBalancePaise;
      const userLimit = t.user.bonusThresholdLimitPaise;
      const isThresholdReached = userBal >= userLimit;
      const eligibleWithdrawablePaise = isThresholdReached
        ? Math.min(userBal, userTotalDeposit)
        : userBal;

      return {
        ...t,
        totalDepositPrincipalPaise: userTotalDeposit,
        isThresholdReached,
        eligibleWithdrawablePaise,
      };
    });

    return res.status(200).json({
      success: true,
      total: enrichedTransactions.length,
      transactions: enrichedTransactions,
    });
  } catch (error: any) {
    console.error('Error fetching pending withdrawals:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve pending withdrawals.',
    });
  }
};

