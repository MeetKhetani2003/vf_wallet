import fs from 'fs';
import path from 'path';
import prisma from './prisma';
import { TransactionType, TransactionStatus } from '@prisma/client';

export interface BackupSnapshotItem {
  id: string;
  title: string;
  backupType: 'FULL_RESET' | 'SINGLE_TRANSACTION';
  createdById: string;
  createdByName: string;
  createdAt: string;
  transactionCount: number;
  totalDepositPaise: number;
  totalWithdrawPaise: number;
  transactionIds: string[];
  singleTransactionId?: string;
  isRestored: boolean;
  restoredAt?: string | null;
  restoredById?: string | null;
  restoredByName?: string | null;
  canUndoUntil?: string | null; // ISO string: restoredAt + 5 minutes
  isPermanentlyDeleted: boolean;
  transactions?: any[];
  clientBalances?: Array<{
    userId: string;
    totalBalancePaise: number;
    activeBonusPaise: number;
  }>;
}

const SETTING_PREFIX = 'backup_snapshot_';

/**
 * Creates a full application reset backup.
 * Soft-deletes (archives) all active transactions and resets application state to zero,
 * while safely preserving all data in MongoDB.
 */
export const createAppResetBackup = async (adminId: string, adminName: string) => {
  // 1. Fetch all active (non-archived) transactions
  const activeTransactions = (await prisma.transaction.findMany({
    where: {
      isArchived: false,
    } as any,
    include: {
      user: {
        select: { id: true, name: true, phone: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })) as any[];

  // 2. Fetch all current client balances to snapshot their state
  const clientBalances = await prisma.user.findMany({
    where: { role: 'CLIENT' },
    select: {
      id: true,
      totalBalancePaise: true,
      activeBonusPaise: true,
    },
  });

  const transactionIds = activeTransactions.map((t) => t.id);
  const now = new Date();
  const snapshotId = `backup_${now.getTime()}_${Math.random().toString(36).substring(2, 7)}`;
  const dateStr = now.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  let totalDepositPaise = 0;
  let totalWithdrawPaise = 0;

  for (const t of activeTransactions) {
    if (t.type === TransactionType.DEPOSIT && t.status === TransactionStatus.APPROVED) {
      totalDepositPaise += t.amountPaise;
    } else if (t.type === TransactionType.WITHDRAWAL && t.status === TransactionStatus.APPROVED) {
      totalWithdrawPaise += t.amountPaise;
    }
  }

  const snapshot: BackupSnapshotItem = {
    id: snapshotId,
    title: `App Reset Backup - ${dateStr}`,
    backupType: 'FULL_RESET',
    createdById: adminId,
    createdByName: adminName,
    createdAt: now.toISOString(),
    transactionCount: activeTransactions.length,
    totalDepositPaise,
    totalWithdrawPaise,
    transactionIds,
    isRestored: false,
    isPermanentlyDeleted: false,
    transactions: activeTransactions.map((t) => ({
      id: t.id,
      userId: t.userId,
      userName: t.user?.name,
      userPhone: t.user?.phone,
      type: t.type,
      status: t.status,
      amountPaise: t.amountPaise,
      bonusPaise: t.bonusPaise,
      cashPaidPaise: t.cashPaidPaise,
      utr: t.utr,
      imageUrl: t.imageUrl,
      createdAt: t.createdAt,
    })),
    clientBalances: clientBalances.map((c) => ({
      userId: c.id,
      totalBalancePaise: c.totalBalancePaise,
      activeBonusPaise: c.activeBonusPaise,
    })),
  };

  // 3. Save snapshot document in SystemSetting
  await prisma.systemSetting.upsert({
    where: { key: `${SETTING_PREFIX}${snapshotId}` },
    create: {
      key: `${SETTING_PREFIX}${snapshotId}`,
      value: JSON.stringify(snapshot),
    },
    update: {
      value: JSON.stringify(snapshot),
    },
  });

  // 4. Soft-delete transactions from active live view
  if (transactionIds.length > 0) {
    await prisma.transaction.updateMany({
      where: { id: { in: transactionIds } },
      data: {
        isArchived: true,
        archivedAt: now,
        archivedById: adminId,
        backupBatchId: snapshotId,
      } as any,
    });
  }

  // 5. Reset client balances to zero state (so the live application displays clean zero state)
  await prisma.user.updateMany({
    where: { role: 'CLIENT' },
    data: {
      totalBalancePaise: 0,
      activeBonusPaise: 0,
      lastDepositAmountPaise: 0,
      cycleWithdrawnPaise: 0,
      isBonusDeductedInCycle: false,
    },
  });

  return snapshot;
};

/**
 * Soft-deletes a single transaction and marks it restorable in Backup & Restore.
 */
export const createSingleTransactionBackup = async (
  transactionId: string,
  adminId: string,
  adminName: string
) => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      user: {
        select: { id: true, name: true, phone: true },
      },
    },
  });

  if (!transaction) {
    throw new Error(`Transaction with ID "${transactionId}" not found.`);
  }

  const now = new Date();
  const snapshotId = `single_${now.getTime()}_${Math.random().toString(36).substring(2, 7)}`;
  const dateStr = now.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const snapshot: BackupSnapshotItem = {
    id: snapshotId,
    title: `Deleted ${transaction.type} #${transaction.utr || transaction.id.slice(-6)} - ${dateStr}`,
    backupType: 'SINGLE_TRANSACTION',
    createdById: adminId,
    createdByName: adminName,
    createdAt: now.toISOString(),
    transactionCount: 1,
    totalDepositPaise: transaction.type === TransactionType.DEPOSIT ? transaction.amountPaise : 0,
    totalWithdrawPaise: transaction.type === TransactionType.WITHDRAWAL ? transaction.amountPaise : 0,
    transactionIds: [transaction.id],
    singleTransactionId: transaction.id,
    isRestored: false,
    isPermanentlyDeleted: false,
    transactions: [
      {
        id: transaction.id,
        userId: transaction.userId,
        userName: transaction.user?.name,
        userPhone: transaction.user?.phone,
        type: transaction.type,
        status: transaction.status,
        amountPaise: transaction.amountPaise,
        bonusPaise: transaction.bonusPaise,
        cashPaidPaise: transaction.cashPaidPaise,
        utr: transaction.utr,
        imageUrl: transaction.imageUrl,
        createdAt: transaction.createdAt,
      },
    ],
  };

  // 1. Save in SystemSetting
  await prisma.systemSetting.upsert({
    where: { key: `${SETTING_PREFIX}${snapshotId}` },
    create: {
      key: `${SETTING_PREFIX}${snapshotId}`,
      value: JSON.stringify(snapshot),
    },
    update: {
      value: JSON.stringify(snapshot),
    },
  });

  // 2. Mark transaction as archived (soft-deleted)
  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      isArchived: true,
      archivedAt: now,
      archivedById: adminId,
      backupBatchId: snapshotId,
    },
  });

  // 3. Deduct/Adjust the transaction amount from client's points balance if approved
  if (transaction.status === TransactionStatus.APPROVED) {
    if (transaction.type === TransactionType.DEPOSIT) {
      const netPoints = transaction.amountPaise + transaction.bonusPaise;
      await prisma.user.update({
        where: { id: transaction.userId },
        data: {
          totalBalancePaise: { decrement: netPoints },
        },
      });
    } else if (transaction.type === TransactionType.WITHDRAWAL) {
      await prisma.user.update({
        where: { id: transaction.userId },
        data: {
          totalBalancePaise: { increment: transaction.amountPaise },
        },
      });
    }
  }

  return snapshot;
};

/**
 * Retrieves all backup snapshots & soft-deleted items with live 5-minute undo state.
 */
export const getAllBackupSnapshots = async (): Promise<
  (BackupSnapshotItem & { canUndo: boolean; undoSecondsRemaining: number })[]
> => {
  const records = await prisma.systemSetting.findMany({
    where: {
      key: { startsWith: SETTING_PREFIX },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const now = Date.now();
  const results: (BackupSnapshotItem & { canUndo: boolean; undoSecondsRemaining: number })[] = [];

  for (const r of records) {
    try {
      const parsed: BackupSnapshotItem = JSON.parse(r.value);
      if (parsed.isPermanentlyDeleted) continue;

      let canUndo = false;
      let undoSecondsRemaining = 0;

      if (parsed.isRestored && parsed.canUndoUntil) {
        const untilMs = new Date(parsed.canUndoUntil).getTime();
        if (untilMs > now) {
          canUndo = true;
          undoSecondsRemaining = Math.max(0, Math.round((untilMs - now) / 1000));
        }
      }

      results.push({
        ...parsed,
        canUndo,
        undoSecondsRemaining,
      });
    } catch (e) {
      console.warn('Failed to parse backup snapshot:', r.key, e);
    }
  }

  // Sort by createdAt descending
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
};

/**
 * Restores an archived snapshot or deleted transaction.
 * Current live data stays as it is (restored items are safely merged in).
 * Sets a 5-minute undo window.
 */
export const restoreBackupSnapshot = async (
  snapshotId: string,
  adminId: string,
  adminName: string
) => {
  const record = await prisma.systemSetting.findUnique({
    where: { key: `${SETTING_PREFIX}${snapshotId}` },
  });

  if (!record) {
    throw new Error(`Backup snapshot "${snapshotId}" not found.`);
  }

  const snapshot: BackupSnapshotItem = JSON.parse(record.value);
  if (snapshot.isPermanentlyDeleted) {
    throw new Error(`This backup snapshot has been permanently deleted.`);
  }

  const now = new Date();
  const canUndoUntil = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes window

  // 1. Un-archive transactions
  if (snapshot.transactionIds && snapshot.transactionIds.length > 0) {
    await prisma.transaction.updateMany({
      where: { id: { in: snapshot.transactionIds } },
      data: {
        isArchived: false,
        backupBatchId: null,
      } as any,
    });

    // 2. Restore points to clients without affecting other current data
    if (snapshot.backupType === 'FULL_RESET' && snapshot.clientBalances) {
      for (const cb of snapshot.clientBalances) {
        if (cb.totalBalancePaise > 0) {
          await prisma.user.update({
            where: { id: cb.userId },
            data: {
              totalBalancePaise: { increment: cb.totalBalancePaise },
              activeBonusPaise: cb.activeBonusPaise,
            },
          });
        }
      }
    } else if (snapshot.backupType === 'SINGLE_TRANSACTION' && snapshot.transactions) {
      for (const t of snapshot.transactions) {
        if (t.status === TransactionStatus.APPROVED) {
          if (t.type === TransactionType.DEPOSIT) {
            const netPoints = t.amountPaise + (t.bonusPaise || 0);
            await prisma.user.update({
              where: { id: t.userId },
              data: {
                totalBalancePaise: { increment: netPoints },
              },
            });
          } else if (t.type === TransactionType.WITHDRAWAL) {
            await prisma.user.update({
              where: { id: t.userId },
              data: {
                totalBalancePaise: { decrement: t.amountPaise },
              },
            });
          }
        }
      }
    }
  }

  // 3. Update snapshot metadata with 5-minute undo timer
  snapshot.isRestored = true;
  snapshot.restoredAt = now.toISOString();
  snapshot.restoredById = adminId;
  snapshot.restoredByName = adminName;
  snapshot.canUndoUntil = canUndoUntil.toISOString();

  await prisma.systemSetting.update({
    where: { key: `${SETTING_PREFIX}${snapshotId}` },
    data: { value: JSON.stringify(snapshot) },
  });

  return {
    ...snapshot,
    canUndo: true,
    undoSecondsRemaining: 300,
  };
};

/**
 * Undoes a restore within the 5-minute window.
 */
export const undoRestoreBackupSnapshot = async (snapshotId: string) => {
  const record = await prisma.systemSetting.findUnique({
    where: { key: `${SETTING_PREFIX}${snapshotId}` },
  });

  if (!record) {
    throw new Error(`Backup snapshot "${snapshotId}" not found.`);
  }

  const snapshot: BackupSnapshotItem = JSON.parse(record.value);
  if (!snapshot.isRestored) {
    throw new Error(`This backup is not currently in restored state.`);
  }

  if (!snapshot.canUndoUntil || new Date(snapshot.canUndoUntil).getTime() < Date.now()) {
    throw new Error(`The 5-minute undo window has expired. This action can no longer be undone.`);
  }

  // 1. Re-archive transactions
  if (snapshot.transactionIds && snapshot.transactionIds.length > 0) {
    await prisma.transaction.updateMany({
      where: { id: { in: snapshot.transactionIds } },
      data: {
        isArchived: true,
        backupBatchId: snapshotId,
      } as any,
    });

    // 2. Reverse balance changes that were restored
    if (snapshot.backupType === 'FULL_RESET' && snapshot.clientBalances) {
      for (const cb of snapshot.clientBalances) {
        if (cb.totalBalancePaise > 0) {
          await prisma.user.update({
            where: { id: cb.userId },
            data: {
              totalBalancePaise: { decrement: cb.totalBalancePaise },
            },
          });
        }
      }
    } else if (snapshot.backupType === 'SINGLE_TRANSACTION' && snapshot.transactions) {
      for (const t of snapshot.transactions) {
        if (t.status === TransactionStatus.APPROVED) {
          if (t.type === TransactionType.DEPOSIT) {
            const netPoints = t.amountPaise + (t.bonusPaise || 0);
            await prisma.user.update({
              where: { id: t.userId },
              data: {
                totalBalancePaise: { decrement: netPoints },
              },
            });
          } else if (t.type === TransactionType.WITHDRAWAL) {
            await prisma.user.update({
              where: { id: t.userId },
              data: {
                totalBalancePaise: { increment: t.amountPaise },
              },
            });
          }
        }
      }
    }
  }

  // 3. Mark undo completed
  snapshot.isRestored = false;
  snapshot.canUndoUntil = null;

  await prisma.systemSetting.update({
    where: { key: `${SETTING_PREFIX}${snapshotId}` },
    data: { value: JSON.stringify(snapshot) },
  });

  return {
    ...snapshot,
    canUndo: false,
    undoSecondsRemaining: 0,
  };
};

/**
 * Permanently deletes a backup snapshot from the database and deletes associated screenshot images.
 */
export const deleteBackupPermanently = async (snapshotId: string) => {
  const record = await prisma.systemSetting.findUnique({
    where: { key: `${SETTING_PREFIX}${snapshotId}` },
  });

  if (!record) {
    throw new Error(`Backup snapshot "${snapshotId}" not found.`);
  }

  const snapshot: BackupSnapshotItem = JSON.parse(record.value);
  let deletedImagesCount = 0;

  // 1. Find and delete physical screenshot files
  if (snapshot.transactionIds && snapshot.transactionIds.length > 0) {
    const txnsWithImages = await prisma.transaction.findMany({
      where: { id: { in: snapshot.transactionIds } },
      select: { imageUrl: true },
    });

    for (const t of txnsWithImages) {
      if (t.imageUrl) {
        try {
          const cleanPath = t.imageUrl.replace(/^file:\/\//, '');
          if (fs.existsSync(cleanPath)) {
            fs.unlinkSync(cleanPath);
            deletedImagesCount++;
          }
        } catch (err) {
          console.warn('Could not delete image file:', t.imageUrl, err);
        }
      }
    }

    // 2. Permanently delete transaction records from MongoDB
    await prisma.transaction.deleteMany({
      where: { id: { in: snapshot.transactionIds } },
    });
  }

  // 3. Permanently remove snapshot setting
  await prisma.systemSetting.delete({
    where: { key: `${SETTING_PREFIX}${snapshotId}` },
  });

  return {
    success: true,
    deletedTransactionsCount: snapshot.transactionIds?.length || 0,
    deletedImagesCount,
  };
};
