import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { Role, TransactionType, TransactionStatus } from '@prisma/client';
import { isClientRole } from '../utils/permissions';
import {
  getRunningDailyBonusRate,
  setRunningDailyBonusRate,
  setRunningDailySettings,
  getTodayDateString,
} from '../utils/dailyBonus';

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
      submissionSource === 'manual'
        ? false
        : submissionSource === 'ocr' ||
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

    // Validate or auto-create Client account on-the-fly
    let client: any = null;
    if (clientId && clientId !== 'new') {
      client = await prisma.user.findUnique({
        where: { id: clientId },
      });
    }

    // On-the-fly client creation by name & phone if client not found or clientId === 'new'
    const { clientName, clientPhone } = req.body;
    if (!client && clientName && typeof clientName === 'string' && clientName.trim()) {
      const cleanName = clientName.trim();
      const cleanClientPhone =
        clientPhone && typeof clientPhone === 'string' && clientPhone.trim()
          ? clientPhone.trim()
          : null;

      if (!cleanClientPhone) {
        return res.status(400).json({
          success: false,
          error: 'Client phone number is required to register a new client.',
        });
      }

      // Check if phone already registered
      const existingClient = await prisma.user.findUnique({
        where: { phone: cleanClientPhone },
      });

      if (existingClient) {
        client = existingClient;
      } else {
        // Fetch running daily rates for new client default setup
        const dailySettings = await getRunningDailyBonusRate();
        // Create new client account on-the-fly
        client = await prisma.user.create({
          data: {
            name: cleanName,
            phone: cleanClientPhone,
            role: Role.CLIENT,
            bonusPercentage: dailySettings.isActive ? dailySettings.percentage : 0.0,
            bonusThresholdLimitPaise: dailySettings.isThresholdActive
              ? dailySettings.thresholdLimitPaise
              : 1500000,
            totalBalancePaise: 0,
          },
        });
      }
    }

    if (!client || !isClientRole(client.role)) {
      return res.status(404).json({
        success: false,
        error: 'Target client account not found. Please provide a valid client ID or name & phone number.',
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

    // Strict Anti-Tamper Rule: Scanned values (amount & UTR) cannot be modified in OCR mode.
    // If manual adjustments or direct entry are needed, staff must submit as Direct Deposit ('manual').
    if (isOcrSubmission) {
      if (!cleanImageHash && !imageUrl && !screenshotUri) {
        return res.status(400).json({
          success: false,
          error: 'A receipt screenshot is required for OCR deposit submissions.',
        });
      }

      if (rawOcrData && typeof rawOcrData === 'object') {
        const ocrAmountPaise =
          typeof rawOcrData.amountPaise === 'number' ? rawOcrData.amountPaise : null;

        if (ocrAmountPaise && ocrAmountPaise > 0) {
          if (ocrAmountPaise !== parsedAmountPaise) {
            return res.status(400).json({
              success: false,
              error: `Anti-tamper violation: Scanned deposit amount (₹${(ocrAmountPaise / 100).toLocaleString('en-IN')}) cannot be modified in OCR mode. To enter or modify deposit values manually, please submit via Direct Deposit.`,
            });
          }
        } else {
          return res.status(400).json({
            success: false,
            error:
              'OCR could not detect the deposit amount from this screenshot. To enter values manually, please submit via Direct Deposit.',
          });
        }

        const detectedUtr =
          rawOcrData.utrNumber ||
          rawOcrData.upiRefNumber ||
          (rawOcrData.transactionId && !rawOcrData.transactionId.startsWith('TXN-')
            ? rawOcrData.transactionId
            : null);

        if (detectedUtr) {
          const cleanDetected = detectedUtr.toString().trim().replace(/[\s-]/g, '').toLowerCase();
          const cleanProvided = cleanUtr ? cleanUtr.trim().replace(/[\s-]/g, '').toLowerCase() : '';

          if (cleanDetected && cleanProvided && cleanDetected !== cleanProvided) {
            return res.status(400).json({
              success: false,
              error: `Anti-tamper violation: Scanned UTR (${detectedUtr}) cannot be modified in OCR mode. To enter or modify reference details manually, please submit via Direct Deposit.`,
            });
          }
        }
      }
    }

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

    // 3. Calculate bonus: automatically applies the running daily bonus rate set by superadmin (defaults to 0% if none set)
    const dailyBonusInfo = await getRunningDailyBonusRate();
    const bonusRate = dailyBonusInfo.isActive ? dailyBonusInfo.percentage : 0.0;
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
            ? {
                ...(typeof rawOcrData === 'object' ? rawOcrData : {}),
                notes: notes || undefined,
                dailyBonusApplied: bonusRate,
                dailyBonusDate: dailyBonusInfo.date,
                submissionSource: isOcrSubmission ? 'ocr' : 'manual',
              }
            : {
                notes: notes || undefined,
                dailyBonusApplied: bonusRate,
                dailyBonusDate: dailyBonusInfo.date,
                submissionSource: isOcrSubmission ? 'ocr' : 'manual',
              },
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
          bonusPercentage: bonusRate,
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

    // 2. Fetch last approved deposit and aggregate stats to find active bonus
    const [lastDeposit, depositAggregate] = await Promise.all([
      prisma.transaction.findFirst({
        where: {
          userId: client.id,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.APPROVED,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.aggregate({
        where: {
          userId: client.id,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.APPROVED,
        },
        _sum: { amountPaise: true, bonusPaise: true },
      }),
    ]);

    const totalDepositPrincipalPaise = depositAggregate._sum.amountPaise || 0;
    const totalBonusCreditedPaise = depositAggregate._sum.bonusPaise || 0;
    const lastDepositBonusPaise = lastDeposit?.bonusPaise || 0;

    // Active bonus attached to client based on the deposit bonus percentage allocated:
    let activeBonusPaise =
      lastDepositBonusPaise > 0
        ? lastDepositBonusPaise
        : Math.min(totalBonusCreditedPaise, client.totalBalancePaise);

    // If no previous deposit record, calculate bonus portion from client's allocated bonus percentage
    if (activeBonusPaise <= 0 && client.bonusPercentage > 0 && client.totalBalancePaise > 0) {
      activeBonusPaise = Math.round(
        (client.totalBalancePaise * client.bonusPercentage) / (100 + client.bonusPercentage)
      );
    }

    // 3. Rule-Based Threshold Start Limit Enforcement:
    // If requested withdrawal >= client's threshold start limit:
    //   Threshold triggers! The active bonus cannot be withdrawn in cash:
    //   bonusExcludedPaise = min(activeBonusPaise, parsedAmountPaise)
    //   actualPayoutPaise = parsedAmountPaise - bonusExcludedPaise
    // If requested withdrawal < threshold start limit:
    //   Threshold does NOT trigger! Full requested amount is withdrawable without deduction:
    //   bonusExcludedPaise = 0
    //   actualPayoutPaise = parsedAmountPaise
    const thresholdStartLimitPaise = client.bonusThresholdLimitPaise;
    const isThresholdApplied =
      parsedAmountPaise >= thresholdStartLimitPaise && activeBonusPaise > 0;

    const bonusExcludedPaise = isThresholdApplied
      ? Math.min(activeBonusPaise, parsedAmountPaise)
      : 0;

    const actualPayoutPaise = parsedAmountPaise - bonusExcludedPaise;

    const paymentAppStr = upiId
      ? `UPI: ${upiId}`
      : bankDetails?.accountNumber
      ? `Bank: ${bankDetails.bankName || 'A/C'} (${bankDetails.accountNumber})`
      : paymentApp || paymentMethod || 'Direct Payout';

    const rawData = {
      ...(bankDetails || {}),
      upiId: upiId || null,
      notes: notes || null,
      requestedAmountPaise: parsedAmountPaise,
      thresholdStartLimitPaise,
      isThresholdApplied,
      activeBonusPaise,
      bonusExcludedPaise,
      actualPayoutPaise,
    };

    // 4. AUTO-ACCEPT Atomic Transaction: Create APPROVED withdrawal & debit client balance
    const [transaction, updatedClient] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          userId: client.id,
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.APPROVED,
          amountPaise: parsedAmountPaise, // Requested debited amount
          bonusPaise: bonusExcludedPaise, // Bonus excluded from cashout
          withdrawablePaise: actualPayoutPaise, // Actual net cash payout sent
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
      message: isThresholdApplied
        ? `Withdrawal processed! Requested ₹${(parsedAmountPaise / 100).toFixed(
            2
          )}. Threshold start limit (₹${(thresholdStartLimitPaise / 100).toFixed(
            2
          )}) applied: ₹${(bonusExcludedPaise / 100).toFixed(
            2
          )} bonus was excluded. Net payout to ${updatedClient.name} is ₹${(
            actualPayoutPaise / 100
          ).toFixed(2)}.`
        : `Withdrawal processed! Paid out ₹${(actualPayoutPaise / 100).toFixed(
            2
          )} to ${updatedClient.name}.`,
      transaction,
      requestedAmountPaise: parsedAmountPaise,
      bonusExcludedPaise,
      actualPayoutPaise,
      withdrawablePaise: actualPayoutPaise,
      isThresholdApplied,
      thresholdStartLimitPaise,
      clientNewBalancePaise: updatedClient.totalBalancePaise,
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

/**
 * GET /api/admin/daily-bonus
 * Returns the active daily running bonus configuration.
 */
export const getDailyBonusConfig = async (
  _req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const dailyInfo = await getRunningDailyBonusRate();
    return res.status(200).json({
      success: true,
      ...dailyInfo,
      message: dailyInfo.isActive
        ? `Today's running bonus rate is ${dailyInfo.percentage}%.`
        : 'No bonus is currently active for today (0%).',
    });
  } catch (error: any) {
    console.error('Error fetching daily bonus config:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve daily bonus configuration.',
    });
  }
};

/**
 * POST /api/admin/daily-bonus
 * Manage running daily bonus and running threshold limit.
 * Permitted for Super Admin and employees granted `canSetBonus` or `canSetThreshold`.
 */
export const updateDailyBonusConfig = async (
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

    const isSuperAdmin = Boolean(req.user.isSuperAdmin);
    const canSetBonus = isSuperAdmin || Boolean(req.user.permissions?.canSetBonus);
    const canSetThreshold = isSuperAdmin || Boolean(req.user.permissions?.canSetThreshold);

    if (!canSetBonus && !canSetThreshold) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You do not have permission to manage daily bonus or threshold rules.',
      });
    }

    const {
      percentage,
      isActive,
      thresholdLimit,
      thresholdLimitPaise,
      isThresholdActive,
    } = req.body;

    let parsedRate: number | undefined = undefined;
    let parsedIsActive: boolean | undefined = undefined;

    // Validate Bonus modifications
    if (percentage !== undefined || isActive !== undefined) {
      if (!canSetBonus) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You do not have permission to modify daily bonus rates.',
        });
      }
      if (percentage !== undefined) {
        parsedRate = Number(percentage);
        if (isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
          return res.status(400).json({
            success: false,
            error: 'Bonus percentage must be between 0% and 100%.',
          });
        }
      }
      if (isActive !== undefined) {
        parsedIsActive = Boolean(isActive);
      }
    }

    // Validate Threshold modifications
    let parsedThresholdPaise: number | undefined = undefined;
    let parsedIsThresholdActive: boolean | undefined = undefined;

    if (
      thresholdLimit !== undefined ||
      thresholdLimitPaise !== undefined ||
      isThresholdActive !== undefined
    ) {
      if (!canSetThreshold) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You do not have permission to modify daily threshold rules.',
        });
      }
      if (thresholdLimitPaise !== undefined) {
        parsedThresholdPaise = Math.max(0, Math.round(Number(thresholdLimitPaise)));
      } else if (thresholdLimit !== undefined) {
        parsedThresholdPaise = Math.max(0, Math.round(Number(thresholdLimit) * 100));
      }
      if (isThresholdActive !== undefined) {
        parsedIsThresholdActive = Boolean(isThresholdActive);
      }
    }

    const record = await setRunningDailySettings({
      percentage: parsedRate,
      isActive: parsedIsActive,
      thresholdLimitPaise: parsedThresholdPaise,
      isThresholdActive: parsedIsThresholdActive,
      adminId: req.user.userId,
      adminName: req.user.name,
    });

    return res.status(200).json({
      success: true,
      message: 'Daily rates and threshold rules updated successfully.',
      dailyBonus: record,
      percentage: record.percentage,
      isActive: record.isActive,
      thresholdLimitPaise: record.thresholdLimitPaise,
      thresholdLimitRupees: Math.round(record.thresholdLimitPaise / 100),
      isThresholdActive: record.isThresholdActive,
      date: record.date,
    });
  } catch (error: any) {
    console.error('Error updating daily bonus & threshold config:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update daily bonus or threshold configuration.',
    });
  }
};
