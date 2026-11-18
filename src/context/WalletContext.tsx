import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import {
  Transaction,
  User,
  UserWalletSummary,
  BonusConfig,
  AdminStats,
  AppNotification,
  BankAccount,
} from '../types';
import { mockWalletService } from '../services/mockWalletService';
import { storageService } from '../services/storageService';
import { walletApi, adminApi } from '../services/api';
import { useAuth } from './AuthContext';
import { DEFAULT_BONUS_PERCENTAGE } from '../utils/constants';

interface WalletContextType {
  transactions: Transaction[];
  users: User[];
  bonusConfig: BonusConfig;
  userWallet: UserWalletSummary | null;
  adminStats: AdminStats | null;
  notifications: AppNotification[];
  unreadNotificationCount: number;
  isBalanceHidden: boolean;
  toggleHideBalance: () => void;
  refreshData: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  createDeposit: (params: {
    amountPaise: number;
    paymentMethod: string;
    upiId?: string;
    screenshotUri?: string;
    screenshotHash?: string;
    ocrResult?: import('../types').ExtractedPaymentDetails;
    ocrConfidence?: number;
    utrNumber?: string;
    senderName?: string;
    receiverName?: string;
    paymentAppName?: string;
    rawOcrText?: string;
    submissionSource?: 'gallery' | 'whatsapp_share' | 'manual';
    notes?: string;
  }) => Promise<{
    success: boolean;
    transaction?: Transaction;
    error?: string;
    isDuplicate?: boolean;
    status?: number;
  }>;
  createWithdrawal: (params: {
    amountPaise: number;
    paymentMethod?: string;
    upiId?: string;
    bankDetails?: BankAccount;
    notes?: string;
  }) => Promise<{ success: boolean; transaction?: Transaction; error?: string }>;
  approveDeposit: (
    transactionId: string
  ) => Promise<{ success: boolean; error?: string }>;
  rejectDeposit: (
    transactionId: string,
    reason: string
  ) => Promise<{ success: boolean; error?: string }>;
  approveWithdrawal: (
    transactionId: string
  ) => Promise<{ success: boolean; error?: string }>;
  rejectWithdrawal: (
    transactionId: string,
    reason: string
  ) => Promise<{ success: boolean; error?: string }>;
  updateBonusConfig: (
    percentage: number,
    enabled: boolean
  ) => Promise<BonusConfig>;
  toggleUserBlock: (userId: string) => Promise<User>;
  updateUserProfile: (userId: string, updates: Partial<User>) => Promise<User>;
  resetAllData: () => Promise<void>;
  markNotificationAsRead: (notificationId: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Helper to map backend transaction format to frontend Transaction
const mapBackendTxn = (t: any): Transaction => {
  let parsedOcr = t.ocrResult;
  if (t.rawOcrData) {
    if (typeof t.rawOcrData === 'string') {
      try {
        parsedOcr = JSON.parse(t.rawOcrData);
      } catch {
        parsedOcr = t.rawOcrData;
      }
    } else {
      parsedOcr = t.rawOcrData;
    }
  }

  return {
    id: t.id,
    userId: t.userId,
    userName: t.user?.name || t.userName || 'User',
    userPhone: t.user?.phone || t.userPhone || '',
    type: (t.type?.toLowerCase() || 'deposit') as any,
    status: (t.status?.toLowerCase() || 'pending') as any,
    amountPaise: t.amountPaise,
    bonusPercentage: t.user?.bonusPercentage ?? t.bonusPercentage ?? 10,
    bonusPaise: t.bonusPaise || 0,
    totalCreditPaise: t.amountPaise + (t.bonusPaise || 0),
    utrNumber: t.utr || t.utrNumber,
    withdrawablePaise:
      t.withdrawablePaise ?? t.eligibleWithdrawablePaise ?? t.amountPaise,
    eligibleWithdrawablePaise: t.eligibleWithdrawablePaise,
    isThresholdReached: t.isThresholdReached,
    totalDepositPrincipalPaise: t.totalDepositPrincipalPaise,
    paymentMethod: t.paymentApp || t.paymentMethod,
    upiId:
      parsedOcr?.upiId ||
      (t.paymentApp?.includes('UPI:')
        ? t.paymentApp.replace('UPI:', '').trim()
        : undefined),
    bankDetails: parsedOcr?.accountNumber ? parsedOcr : undefined,
    screenshotHash: t.imageHash || t.screenshotHash,
    screenshotUri: t.imageUrl || t.screenshotUri,
    paymentAppName: t.paymentApp || t.paymentAppName,
    ocrResult: parsedOcr,
    ocrConfidence: parsedOcr?.ocrConfidence ?? t.ocrConfidence ?? 0,
    submissionSource: t.submissionSource || (t.imageUrl ? 'gallery' : 'manual'),
    rejectionReason: t.rejectionReason,
    createdAt: t.createdAt,
    processedBy: t.processedByAdminId,
  };
};

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [bonusConfig, setBonusConfig] = useState<BonusConfig>({
    isEnabled: true,
    bonusPercentage: DEFAULT_BONUS_PERCENTAGE,
    updatedAt: new Date().toISOString(),
  });
  const [userWallet, setUserWallet] = useState<UserWalletSummary | null>(null);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isBalanceHidden, setIsBalanceHidden] = useState<boolean>(false);

  /**
   * Refreshes wallet balances and transaction history from live backend
   */
  const refreshData = useCallback(async () => {
    try {
      if (user) {
        if (user.role === 'user') {
          // 1. Fetch live user history from GET /api/wallet/history
          const historyRes = await walletApi.getTransactions();
          if (historyRes.success && Array.isArray(historyRes.transactions)) {
            setTransactions(historyRes.transactions.map(mapBackendTxn));
          } else {
            const localTxns = await storageService.getTransactions();
            setTransactions(localTxns.filter((t) => t.userId === user.id));
          }

          // 2. Fetch live user wallet summary from GET /api/wallet/summary
          const summaryRes = await walletApi.getSummary();
          if (summaryRes.success && summaryRes.wallet) {
            setUserWallet({
              userId: user.id,
              totalDepositPaise: summaryRes.wallet.totalDepositPaise,
              totalBonusPaise: summaryRes.wallet.totalBonusPaise,
              totalCreditPaise:
                summaryRes.wallet.totalDepositPaise +
                summaryRes.wallet.totalBonusPaise,
              totalWithdrawalPaise: summaryRes.wallet.totalWithdrawalPaise,
              availableBalancePaise: summaryRes.wallet.availableBalancePaise,
              pendingDepositCount: summaryRes.wallet.pendingDepositCount,
              pendingWithdrawalCount: summaryRes.wallet.pendingWithdrawalCount,
              withdrawablePaise: summaryRes.wallet.withdrawablePaise,
              withdrawableRupees: summaryRes.wallet.withdrawableRupees,
              isThresholdReached: summaryRes.wallet.isThresholdReached,
              bonusThresholdLimitPaise: summaryRes.wallet.bonusThresholdLimitPaise,
            });
          } else {
            const localWallet = await mockWalletService.getUserWalletSummary(user.id);
            setUserWallet(localWallet);
          }
        } else if (user.role === 'admin') {
          // 1. Fetch live platform transactions, operational stats, and client roster in parallel
          const [txnsRes, statsRes, clientsRes] = await Promise.all([
            adminApi.getAllTransactions(),
            adminApi.getAdminStats(),
            adminApi.getUsers({ role: 'CLIENT' }),
          ]);

          if (txnsRes.success && Array.isArray(txnsRes.transactions)) {
            setTransactions(txnsRes.transactions.map(mapBackendTxn));
          }

          if (statsRes.success && statsRes.stats) {
            setAdminStats(statsRes.stats);
          }

          if (clientsRes.success && Array.isArray(clientsRes.users)) {
            const mappedClients: User[] = clientsRes.users.map((u: any) => ({
              id: u.id,
              name: u.name,
              phone: u.phone,
              email: u.email || '',
              role: 'user',
              accountType: u.accountType || 'CLIENT',
              status: u.isBlocked ? 'blocked' : 'active',
              createdAt: u.createdAt,
              upiId: u.upiId || undefined,
              bankAccount: u.bankAccount || undefined,
              bonusPercentage: u.bonusPercentage ?? 10.0,
              bonusThresholdLimitPaise: u.bonusThresholdLimitPaise ?? 1000000,
              totalBalancePaise: u.totalBalancePaise || 0,
              totalDepositPrincipalPaise: u.totalDepositPrincipalPaise || 0,
              withdrawablePaise: u.withdrawablePaise ?? u.totalBalancePaise ?? 0,
              isThresholdReached: Boolean(u.isThresholdReached),
            }));
            setUsers(mappedClients);
          }
        }
      } else {
        setTransactions([]);
        setUsers([]);
      }

      const [config, notifs] = await Promise.all([
        storageService.getBonusConfig(),
        storageService.getNotifications(),
      ]);
      setBonusConfig(config);
      setNotifications(notifs);
    } catch (e) {
      console.error('Failed to load wallet context data:', e);
    }
  }, [user]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const refreshBalance = refreshData;

  const toggleHideBalance = () => {
    setIsBalanceHidden((prev) => !prev);
  };

  /**
   * Submits a PENDING deposit to POST /api/wallet/deposit
   */
  const createDeposit = async (params: {
    amountPaise: number;
    paymentMethod: string;
    upiId?: string;
    screenshotUri?: string;
    screenshotHash?: string;
    ocrResult?: import('../types').ExtractedPaymentDetails;
    ocrConfidence?: number;
    utrNumber?: string;
    senderName?: string;
    receiverName?: string;
    paymentAppName?: string;
    rawOcrText?: string;
    submissionSource?: 'gallery' | 'whatsapp_share' | 'manual';
    notes?: string;
  }) => {
    if (!user) return { success: false, error: 'User not authenticated' };

    try {
      // 1. Live Backend API Call: POST /api/wallet/deposit
      const res = await walletApi.createDeposit({
        amountPaise: params.amountPaise,
        utr: params.utrNumber,
        imageHash: params.screenshotHash,
        imageUrl: params.screenshotUri,
        paymentApp: params.paymentAppName || params.paymentMethod,
        rawOcrData: params.ocrResult,
      });

      if (res.success && res.transaction) {
        await refreshData();
        return {
          success: true,
          transaction: mapBackendTxn(res.transaction),
        };
      }

      // Handle duplicate UTR or duplicate image hash alert from backend (HTTP 409)
      if (res.status === 409 || res.error?.includes('already')) {
        return {
          success: false,
          isDuplicate: true,
          status: 409,
          error: res.error || 'Duplicate UTR or screenshot already submitted.',
        };
      }

      if (res.error && !res.isNetworkError) {
        return { success: false, error: res.error };
      }
    } catch (e: any) {
      console.warn('Backend deposit failed, using fallback:', e);
    }

    // 2. Offline Fallback
    const fallback = await mockWalletService.createDepositRequest({
      userId: user.id,
      userName: user.name,
      userPhone: user.phone,
      ...params,
    });
    if (fallback.success) {
      await refreshData();
    }
    return fallback;
  };

  const createWithdrawal = async (params: {
    amountPaise: number;
    paymentMethod?: string;
    upiId?: string;
    bankDetails?: BankAccount;
    notes?: string;
  }) => {
    if (!user) return { success: false, error: 'User not authenticated' };

    try {
      const res = await walletApi.createWithdrawal({
        amountPaise: params.amountPaise,
        paymentApp: params.paymentMethod,
        paymentMethod: params.paymentMethod,
        upiId: params.upiId,
        bankDetails: params.bankDetails,
        notes: params.notes,
      });

      if (res.success && res.transaction) {
        await refreshData();
        return {
          success: true,
          transaction: mapBackendTxn(res.transaction),
        };
      }

      if (res.error && !res.isNetworkError) {
        return { success: false, error: res.error };
      }
    } catch (e) {
      console.warn('Backend withdrawal failed, using fallback:', e);
    }

    const fallback = await mockWalletService.createWithdrawalRequest({
      userId: user.id,
      userName: user.name,
      userPhone: user.phone,
      ...params,
    });
    if (fallback.success) {
      await refreshData();
    }
    return fallback;
  };

  /**
   * Approves a deposit via POST /api/admin/transactions/:id/approve
   */
  const approveDeposit = async (transactionId: string) => {
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Only admins can approve deposits.' };
    }

    try {
      const res = await adminApi.approveDeposit(transactionId);
      if (res.success) {
        await refreshData();
        return { success: true };
      }
      if (res.error && !res.isNetworkError) {
        return { success: false, error: res.error };
      }
    } catch (e) {
      console.warn('Backend approve failed, checking fallback:', e);
    }

    const fallback = await mockWalletService.approveDeposit(
      transactionId,
      user.id,
      user.name
    );
    if (fallback.success) {
      await refreshData();
    }
    return fallback;
  };

  /**
   * Rejects a deposit via POST /api/admin/transactions/:id/reject
   */
  const rejectDeposit = async (transactionId: string, reason: string) => {
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Only admins can reject deposits.' };
    }

    try {
      const res = await adminApi.rejectDeposit(transactionId, reason);
      if (res.success) {
        await refreshData();
        return { success: true };
      }
      if (res.error && !res.isNetworkError) {
        return { success: false, error: res.error };
      }
    } catch (e) {
      console.warn('Backend reject failed, checking fallback:', e);
    }

    const fallback = await mockWalletService.rejectDeposit(
      transactionId,
      reason,
      user.id,
      user.name
    );
    if (fallback.success) {
      await refreshData();
    }
    return fallback;
  };

  const approveWithdrawal = async (transactionId: string) => {
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Only admins can approve withdrawals.' };
    }

    try {
      const res = await adminApi.approveWithdrawal(transactionId);
      if (res.success) {
        await refreshData();
        return { success: true };
      }
      if (res.error && !res.isNetworkError) {
        return { success: false, error: res.error };
      }
    } catch (e) {
      console.warn('Backend approve withdrawal failed:', e);
    }

    const res = await mockWalletService.approveWithdrawal(
      transactionId,
      user.id,
      user.name
    );
    if (res.success) {
      await refreshData();
    }
    return res;
  };

  const rejectWithdrawal = async (transactionId: string, reason: string) => {
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Only admins can reject withdrawals.' };
    }

    try {
      const res = await adminApi.rejectWithdrawal(transactionId, reason);
      if (res.success) {
        await refreshData();
        return { success: true };
      }
      if (res.error && !res.isNetworkError) {
        return { success: false, error: res.error };
      }
    } catch (e) {
      console.warn('Backend reject withdrawal failed:', e);
    }

    const res = await mockWalletService.rejectWithdrawal(
      transactionId,
      reason,
      user.id,
      user.name
    );
    if (res.success) {
      await refreshData();
    }
    return res;
  };

  const updateBonusConfig = async (percentage: number, enabled: boolean) => {
    const updated = await mockWalletService.updateBonusConfig(
      percentage,
      enabled,
      user?.name
    );
    setBonusConfig(updated);
    return updated;
  };

  const toggleUserBlock = async (userId: string) => {
    try {
      const res = await adminApi.toggleBlockUser(userId);
      if (res.success && res.user) {
        await refreshData();
        return res.user;
      }
    } catch (e) {
      console.warn('Backend toggle block failed:', e);
    }
    const updated = await mockWalletService.toggleUserBlockStatus(userId);
    setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    return updated;
  };

  const updateUserProfile = async (userId: string, updates: Partial<User>) => {
    const updated = await mockWalletService.updateUserProfile(userId, updates);
    setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    return updated;
  };

  const resetAllData = async () => {
    await storageService.resetAllApplicationData();
    await refreshData();
  };

  const markNotificationAsRead = async (notificationId: string) => {
    const notifs = await storageService.getNotifications();
    const updatedNotifs = notifs.map((n) =>
      n.id === notificationId ? { ...n, read: true } : n
    );
    await storageService.setNotifications(updatedNotifs);
    setNotifications(updatedNotifs);
  };

  const unreadNotificationCount = notifications.filter((n) => !n.read).length;

  return (
    <WalletContext.Provider
      value={{
        transactions,
        users,
        bonusConfig,
        userWallet,
        adminStats,
        notifications,
        unreadNotificationCount,
        isBalanceHidden,
        toggleHideBalance,
        refreshData,
        refreshBalance,
        createDeposit,
        createWithdrawal,
        approveDeposit,
        rejectDeposit,
        approveWithdrawal,
        rejectWithdrawal,
        updateBonusConfig,
        toggleUserBlock,
        updateUserProfile,
        resetAllData,
        markNotificationAsRead,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
