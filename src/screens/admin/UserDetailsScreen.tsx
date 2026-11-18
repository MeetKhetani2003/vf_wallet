import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  Modal,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { Header } from '../../components/common/Header';
import { StatusBadge } from '../../components/common/StatusBadge';
import { TransactionRow } from '../../components/cards/TransactionRow';
import { PrimaryButton } from '../../components/buttons/PrimaryButton';
import { SecondaryButton } from '../../components/buttons/SecondaryButton';
import { ConfirmationModal } from '../../components/modals/ConfirmationModal';
import { CustomInput } from '../../components/inputs/CustomInput';
import { useWallet } from '../../hooks/useWallet';
import { adminApi } from '../../services/api';
import { formatPaiseToINR } from '../../utils/currency';
import { calculateUserWallet } from '../../utils/calculations';
import { User, Transaction, UserWalletSummary } from '../../types';

export const UserDetailsScreen = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { userId, userInitial } = route.params || {};

  const {
    users: localUsers,
    transactions: contextTransactions,
    toggleUserBlock: localToggleBlock,
    updateUserProfile: localUpdateProfile,
  } = useWallet();

  // Find local user fallback if available
  const initialUser =
    userInitial || localUsers.find((u) => u.id === userId) || null;

  const [user, setUser] = useState<User | null>(initialUser);
  const [liveTransactions, setLiveTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(!initialUser);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Modals state
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [bonusModalVisible, setBonusModalVisible] = useState(false);

  // Edit Profile form
  const [editName, setEditName] = useState(initialUser?.name || '');
  const [editPhone, setEditPhone] = useState(initialUser?.phone || '');
  const [editUpi, setEditUpi] = useState(initialUser?.upiId || '');

  // Edit Bonus form
  const [editBonusRate, setEditBonusRate] = useState(
    String(initialUser?.bonusPercentage ?? 10.0)
  );
  const [editThresholdLimit, setEditThresholdLimit] = useState(
    String(
      initialUser?.bonusThresholdLimitPaise
        ? initialUser.bonusThresholdLimitPaise / 100
        : 10000
    )
  );
  const [isSubmittingBonus, setIsSubmittingBonus] = useState(false);

  /**
   * Fetches user profile and ledger from the backend API
   */
  const fetchUserDetails = useCallback(async (isRefresh = false) => {
    if (!userId) return;
    if (isRefresh) setRefreshing(true);

    try {
      const res = await adminApi.getUserById(userId);

      if (res.success && res.user) {
        const u = res.user;
        const normalized: User = {
          id: u.id,
          name: u.name,
          phone: u.phone,
          email: u.email || `${u.phone}@vfwallet.local`,
          role: 'user',
          status: u.isBlocked ? 'blocked' : 'active',
          createdAt: u.createdAt,
          bonusPercentage: u.bonusPercentage ?? 10.0,
          bonusThresholdLimitPaise: u.bonusThresholdLimitPaise ?? 1000000,
          totalBalancePaise: u.totalBalancePaise || 0,
        };

        setUser(normalized);
        setEditName(normalized.name);
        setEditPhone(normalized.phone);
        setEditBonusRate(String(normalized.bonusPercentage ?? 10.0));
        setEditThresholdLimit(
          String(
            normalized.bonusThresholdLimitPaise
              ? normalized.bonusThresholdLimitPaise / 100
              : 10000
          )
        );

        if (Array.isArray(u.transactions)) {
          setLiveTransactions(u.transactions);
        }
      }
    } catch (e) {
      console.warn('Could not fetch live user details from backend:', e);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchUserDetails();
  }, [fetchUserDetails]);

  // Combine live and context transactions for this user
  const userTransactions = (
    liveTransactions.length > 0
      ? liveTransactions
      : contextTransactions.filter((t) => t.userId === userId)
  ).sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Compute or format wallet summary
  let walletSummary: UserWalletSummary;
  if (user) {
    walletSummary = calculateUserWallet(user.id, userTransactions);
    if (user.totalBalancePaise !== undefined) {
      walletSummary.availableBalancePaise = user.totalBalancePaise;
    }
  } else {
    walletSummary = {
      userId: userId || '',
      totalDepositPaise: 0,
      totalBonusPaise: 0,
      totalCreditPaise: 0,
      totalWithdrawalPaise: 0,
      availableBalancePaise: 0,
      pendingDepositCount: 0,
      pendingWithdrawalCount: 0,
    };
  }

  // Handle Block / Unblock Toggle
  const handleToggleBlock = async () => {
    if (!user) return;
    setBlockModalVisible(false);

    const targetBlocked = user.status === 'active';

    try {
      // 1. Try Live Backend API
      const res = await adminApi.toggleBlockUser(user.id, targetBlocked);
      if (res.success && res.user) {
        setUser((prev) =>
          prev ? { ...prev, status: res.user.isBlocked ? 'blocked' : 'active' } : null
        );
      }
    } catch {
      // Offline fallback
    }

    // 2. Also toggle in local wallet state
    await localToggleBlock(user.id);
    setUser((prev) =>
      prev ? { ...prev, status: targetBlocked ? 'blocked' : 'active' } : null
    );

    Alert.alert(
      'Account Updated',
      `User ${user.name} is now ${targetBlocked ? 'blocked' : 'active'}.`
    );
  };

  // Handle Save Edit Profile
  const handleSaveEdit = async () => {
    if (!user) return;
    if (!editName.trim()) {
      Alert.alert('Required', 'Name cannot be empty.');
      return;
    }

    await localUpdateProfile(user.id, {
      name: editName.trim(),
      phone: editPhone.trim(),
      upiId: editUpi.trim(),
    });

    setUser((prev) =>
      prev
        ? {
            ...prev,
            name: editName.trim(),
            phone: editPhone.trim(),
            upiId: editUpi.trim(),
          }
        : null
    );

    setEditModalVisible(false);
    Alert.alert('Updated', 'User profile saved.');
  };

  // Handle Save Bonus Configuration
  const handleSaveBonusConfig = async () => {
    if (!user) return;
    const rate = parseFloat(editBonusRate);
    const limit = parseFloat(editThresholdLimit);

    if (isNaN(rate) || rate < 0 || rate > 100) {
      Alert.alert('Invalid Input', 'Bonus percentage must be between 0 and 100.');
      return;
    }

    if (isNaN(limit) || limit < 0) {
      Alert.alert('Invalid Input', 'Bonus threshold limit must be positive.');
      return;
    }

    setIsSubmittingBonus(true);
    try {
      const res = await adminApi.updateUserBonusConfig(user.id, {
        bonusPercentage: rate,
        bonusThresholdLimit: limit,
      });

      if (res.success && res.user) {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                bonusPercentage: res.user.bonusPercentage,
                bonusThresholdLimitPaise: res.user.bonusThresholdLimitPaise,
              }
            : null
        );
        Alert.alert(
          'Bonus Config Updated! 🎁',
          `Set to ${res.user.bonusPercentage}% bonus with ${formatPaiseToINR(
            res.user.bonusThresholdLimitPaise
          )} threshold limit.`
        );
        setBonusModalVisible(false);
      } else {
        Alert.alert('Error', res.error || 'Failed to update bonus configuration.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update bonus configuration.');
    } finally {
      setIsSubmittingBonus(false);
    }
  };

  if (isLoading) {
    return (
      <ScreenContainer backgroundColor={colors.background}>
        <Header title="User Details" showBack onBackPress={() => navigation.goBack()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading user profile...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!user) {
    return (
      <ScreenContainer backgroundColor={colors.background}>
        <Header title="User Details" showBack onBackPress={() => navigation.goBack()} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textLight} />
          <Text style={styles.notFoundTitle}>User Record Not Found</Text>
          <Text style={styles.notFoundSub}>
            ID: {userId || 'Unknown'} could not be retrieved from the database.
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => fetchUserDetails(true)}
          >
            <Text style={styles.retryBtnText}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer
      scrollable
      refreshing={refreshing}
      onRefresh={() => fetchUserDetails(true)}
      backgroundColor={colors.background}
    >
      <Header
        title="User Profile"
        subtitle={user.id}
        showBack
        onBackPress={() => navigation.goBack()}
        rightAction={
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => {
              setEditName(user.name);
              setEditPhone(user.phone);
              setEditUpi(user.upiId || '');
              setEditModalVisible(true);
            }}
          >
            <Ionicons name="create-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <View style={styles.content}>
        {/* Main User Profile Card */}
        <View style={styles.card}>
          <View style={styles.profileRow}>
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {user.name.slice(0, 2).toUpperCase()}
                </Text>
              </View>
            )}

            <View style={styles.userInfoCol}>
              <View style={styles.nameRow}>
                <Text style={styles.nameText}>{user.name}</Text>
                <StatusBadge status={user.status} size="sm" />
              </View>
              <Text style={styles.emailText}>{user.email}</Text>
              <Text style={styles.phoneText}>+91 {user.phone}</Text>
              <Text style={styles.dateText}>
                Registered:{' '}
                {new Date(user.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </Text>
            </View>
          </View>

          {/* Block / Unblock CTA Button */}
          <View style={styles.actionRow}>
            <SecondaryButton
              title={user.status === 'active' ? 'Block User Account' : 'Unblock User Account'}
              variant={user.status === 'active' ? 'dangerOutline' : 'outline'}
              icon={user.status === 'active' ? 'ban' : 'checkmark-circle-outline'}
              onPress={() => setBlockModalVisible(true)}
              size="sm"
              fullWidth
            />
          </View>
        </View>

        {/* Custom Cashback Bonus Configuration Card */}
        <View style={styles.bonusConfigCard}>
          <View style={styles.bonusHeaderRow}>
            <View style={styles.bonusTitleRow}>
              <View style={styles.bonusIconCircle}>
                <Ionicons name="sparkles" size={18} color="#D97706" />
              </View>
              <View>
                <Text style={styles.bonusCardTitle}>Assigned Cashback Bonus</Text>
                <Text style={styles.bonusCardSub}>
                  Custom rate snapshot applied on approved deposits
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.bonusEditBadge}
              onPress={() => setBonusModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="pencil" size={12} color={colors.primary} />
              <Text style={styles.bonusEditText}>Adjust</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bonusDetailsGrid}>
            <View style={styles.bonusMetricCol}>
              <Text style={styles.bonusMetricLabel}>Bonus Percentage</Text>
              <Text style={styles.bonusMetricVal}>
                {user.bonusPercentage ?? 10.0}%
              </Text>
            </View>

            <View style={styles.bonusMetricDivider} />

            <View style={styles.bonusMetricCol}>
              <Text style={styles.bonusMetricLabel}>Threshold Limit</Text>
              <Text style={styles.bonusMetricVal}>
                {formatPaiseToINR(user.bonusThresholdLimitPaise ?? 1000000)}
              </Text>
            </View>
          </View>
        </View>

        {/* Financial Metrics Card */}
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Wallet Financial Summary</Text>

          <View style={styles.balanceHighlight}>
            <Text style={styles.balanceHighlightLabel}>Available Balance</Text>
            <Text style={styles.balanceHighlightValue}>
              {formatPaiseToINR(walletSummary.availableBalancePaise)}
            </Text>
          </View>

          <View style={styles.metricGrid}>
            <View style={styles.metricItem}>
              <Text style={styles.metricItemLabel}>Total Deposits</Text>
              <Text style={styles.metricItemVal}>
                {formatPaiseToINR(walletSummary.totalDepositPaise)}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricItemLabel}>Total Bonuses</Text>
              <Text style={[styles.metricItemVal, styles.bonusVal]}>
                {formatPaiseToINR(walletSummary.totalBonusPaise)}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricItemLabel}>Total Withdrawals</Text>
              <Text style={styles.metricItemVal}>
                {formatPaiseToINR(walletSummary.totalWithdrawalPaise)}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricItemLabel}>Pending Requests</Text>
              <Text style={styles.metricItemVal}>
                {walletSummary.pendingDepositCount} dep /{' '}
                {walletSummary.pendingWithdrawalCount} wdr
              </Text>
            </View>
          </View>
        </View>

        {/* Banking and UPI Channels */}
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Banking & UPI Details</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>UPI ID / VPA</Text>
            <Text style={styles.infoValue}>{user.upiId || 'Not set'}</Text>
          </View>

          {user.bankAccount ? (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Bank Name</Text>
                <Text style={styles.infoValue}>{user.bankAccount.bankName}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Account Holder</Text>
                <Text style={styles.infoValue}>
                  {user.bankAccount.accountHolderName}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Account Number</Text>
                <Text style={styles.infoValue}>
                  {user.bankAccount.accountNumber}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>IFSC Code</Text>
                <Text style={styles.infoValue}>{user.bankAccount.ifsc}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.noBankText}>No bank account linked yet.</Text>
          )}
        </View>

        {/* User Transaction Activity */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            User Activity Ledger ({userTransactions.length})
          </Text>
        </View>

        <View style={styles.transactionsContainer}>
          {userTransactions.length > 0 ? (
            userTransactions.map((item) => (
              <TransactionRow
                key={item.id}
                transaction={item}
                onPress={() =>
                  navigation.navigate('TransactionDetails', {
                    transactionId: item.id,
                  })
                }
              />
            ))
          ) : (
            <Text style={styles.noTxnText}>No activity recorded for this user.</Text>
          )}
        </View>
      </View>

      {/* Block Confirmation Modal */}
      <ConfirmationModal
        visible={blockModalVisible}
        title={user.status === 'active' ? 'Block User Account?' : 'Unblock User Account?'}
        message={
          user.status === 'active'
            ? `Blocking ${user.name} will prevent them from signing in or placing deposit and withdrawal requests.`
            : `Unblocking ${user.name} will restore normal wallet access.`
        }
        confirmLabel={user.status === 'active' ? 'Yes, Block User' : 'Yes, Unblock'}
        variant={user.status === 'active' ? 'danger' : 'success'}
        icon={user.status === 'active' ? 'ban' : 'checkmark-circle'}
        onConfirm={handleToggleBlock}
        onCancel={() => setBlockModalVisible(false)}
      />

      {/* Adjust Bonus Modal */}
      <Modal visible={bonusModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Adjust Cashback Bonus</Text>
              <TouchableOpacity
                onPress={() => setBonusModalVisible(false)}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Set custom bonus rate and maximum threshold for {user.name}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Bonus Percentage (%)</Text>
              <CustomInput
                value={editBonusRate}
                onChangeText={setEditBonusRate}
                keyboardType="numeric"
                placeholder="e.g. 10.0"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Bonus Threshold Limit (₹)</Text>
              <CustomInput
                value={editThresholdLimit}
                onChangeText={setEditThresholdLimit}
                keyboardType="numeric"
                placeholder="e.g. 10000"
              />
            </View>

            <View style={styles.modalBtnRow}>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  title="Cancel"
                  onPress={() => setBonusModalVisible(false)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Save Bonus"
                  loading={isSubmittingBonus}
                  onPress={handleSaveBonusConfig}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit User Modal */}
      <Modal visible={editModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Edit User Details</Text>
              <TouchableOpacity
                onPress={() => setEditModalVisible(false)}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <CustomInput
              label="Full Name"
              value={editName}
              onChangeText={setEditName}
            />
            <CustomInput
              label="Phone Number"
              value={editPhone}
              onChangeText={setEditPhone}
              keyboardType="phone-pad"
            />
            <CustomInput
              label="UPI ID"
              value={editUpi}
              onChangeText={setEditUpi}
              autoCapitalize="none"
            />

            <View style={styles.modalBtnRow}>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  title="Cancel"
                  onPress={() => setEditModalVisible(false)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Save Changes" onPress={handleSaveEdit} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  loadingContainer: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
  },
  editBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 14,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.primary,
  },
  userInfoCol: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  emailText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  phoneText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  dateText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  actionRow: {
    marginTop: 14,
  },
  cardHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  bonusConfigCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
  },
  bonusHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  bonusTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  bonusIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#92400E',
  },
  bonusCardSub: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 1,
  },
  bonusEditBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  bonusEditText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  bonusDetailsGrid: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  bonusMetricCol: {
    alignItems: 'center',
    flex: 1,
  },
  bonusMetricLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 4,
  },
  bonusMetricVal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#B45309',
  },
  bonusMetricDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.divider,
  },
  balanceHighlight: {
    backgroundColor: colors.lightBlue,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  balanceHighlightLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  balanceHighlightValue: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.primary,
    marginTop: 4,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  metricItem: {
    width: '47%',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    padding: 10,
  },
  metricItemLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  metricItemVal: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  bonusVal: {
    color: colors.warningDark,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  infoLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  noBankText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  sectionTitleRow: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  transactionsContainer: {
    marginTop: 4,
  },
  noTxnText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
  },
  notFound: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 20,
  },
  notFoundTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginTop: 12,
  },
  notFoundSub: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  retryBtnText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 30, 66, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 380,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  modalSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
});

export default UserDetailsScreen;
