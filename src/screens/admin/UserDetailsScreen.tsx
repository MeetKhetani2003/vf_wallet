import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
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
import { EditProfileModal } from '../../components/modals/EditProfileModal';
import { adminApi } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';
import { formatPaiseToINR } from '../../utils/currency';
import { User, Transaction, EmployeePermissions, BankAccount } from '../../types';

const PERMISSION_ITEMS: Array<{
  key: keyof EmployeePermissions;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  {
    key: 'canOcrUpload',
    title: 'OCR Upload (Selected Client)',
    desc: 'Scan receipt screenshots & auto-credit deposits',
    icon: 'scan-outline',
  },
  {
    key: 'canDeposit',
    title: 'Direct Deposit',
    desc: 'Credit manual deposits directly to clients',
    icon: 'arrow-down-circle-outline',
  },
  {
    key: 'canWithdraw',
    title: 'Client Withdrawal',
    desc: 'Process rule-based instant payouts for clients',
    icon: 'arrow-up-circle-outline',
  },
  {
    key: 'canSetBonus',
    title: 'Set Client Bonus %',
    desc: 'Configure custom cashback bonus rate per client',
    icon: 'gift-outline',
  },
  {
    key: 'canSetThreshold',
    title: 'Set Threshold Limit',
    desc: 'Configure withdrawal threshold limit per client',
    icon: 'shield-outline',
  },
  {
    key: 'canManageClients',
    title: 'Manage Client Data',
    desc: 'Create, edit, update UPI/bank & block clients',
    icon: 'people-outline',
  },
];

type ParamList = {
  UserDetails: { userId: string };
};

export const UserDetailsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<ParamList, 'UserDetails'>>();
  const { userId } = route.params;

  const { isSuperAdmin, permissions } = useAuth();
  const { refreshData } = useWallet();

  const [account, setAccount] = useState<User | null>(null);
  const [accountTxns, setAccountTxns] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Client Bonus & Threshold Config State
  const [bonusInput, setBonusInput] = useState('10');
  const [thresholdInput, setThresholdInput] = useState('10000');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Employee Permissions State
  const [empPerms, setEmpPerms] = useState<EmployeePermissions>({
    canOcrUpload: false,
    canDeposit: false,
    canWithdraw: false,
    canSetBonus: false,
    canSetThreshold: false,
    canManageClients: false,
  });
  const [newEmpPassword, setNewEmpPassword] = useState('');
  const [isSavingPerms, setIsSavingPerms] = useState(false);

  // Modals
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);

  const loadDetails = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);

      try {
        const res = await adminApi.getUserById(userId);
        if (res.success && res.user) {
          const u = res.user;
          const mapped: User = {
            id: u.id,
            name: u.name,
            phone: u.phone,
            email: u.email || '',
            role: 'user',
            accountType: u.accountType || (u.role === 'EMPLOYEE' ? 'EMPLOYEE' : 'CLIENT'),
            permissions: u.permissions,
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
          };
          setAccount(mapped);
          setBonusInput(String(mapped.bonusPercentage ?? 10));
          setThresholdInput(String((mapped.bonusThresholdLimitPaise ?? 1000000) / 100));

          if (u.permissions) {
            setEmpPerms({
              canOcrUpload: Boolean(u.permissions.canOcrUpload),
              canDeposit: Boolean(u.permissions.canDeposit),
              canWithdraw: Boolean(u.permissions.canWithdraw),
              canSetBonus: Boolean(u.permissions.canSetBonus),
              canSetThreshold: Boolean(u.permissions.canSetThreshold),
              canManageClients: Boolean(u.permissions.canManageClients),
            });
          }

          if (Array.isArray(u.transactions)) {
            const mappedTxns: Transaction[] = u.transactions.map((t: any) => ({
              id: t.id,
              userId: u.id,
              userName: u.name,
              userPhone: u.phone,
              type: t.type.toLowerCase(),
              status: t.status.toLowerCase(),
              amountPaise: t.amountPaise,
              bonusPaise: t.bonusPaise || 0,
              totalCreditPaise:
                t.type === 'DEPOSIT' ? t.amountPaise + (t.bonusPaise || 0) : undefined,
              utrNumber: t.utr,
              paymentMethod: t.paymentApp,
              paymentAppName: t.paymentApp,
              screenshotUri: t.imageUrl,
              createdAt: t.createdAt,
              processedBy: t.processedByName || t.processedByAdminId,
            }));
            setAccountTxns(mappedTxns);
          }
        }
      } catch (e) {
        console.error('Error loading user details:', e);
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  if (isLoading && !account) {
    return (
      <ScreenContainer backgroundColor={colors.background}>
        <Header title="Account Details" showBack onBackPress={() => navigation.goBack()} />
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading account profile...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!account) {
    return (
      <ScreenContainer backgroundColor={colors.background}>
        <Header title="Account Not Found" showBack onBackPress={() => navigation.goBack()} />
        <View style={styles.loadingBox}>
          <Ionicons name="alert-circle-outline" size={44} color={colors.textLight} />
          <Text style={styles.loadingText}>This account could not be found.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const isEmployee = account.accountType === 'EMPLOYEE';
  const canEditData = isSuperAdmin || (!isEmployee && permissions.canManageClients);
  const canEditBonus = isSuperAdmin || (!isEmployee && permissions.canSetBonus);
  const canEditThreshold = isSuperAdmin || (!isEmployee && permissions.canSetThreshold);
  const canDepositForClient =
    !isEmployee && (isSuperAdmin || permissions.canOcrUpload || permissions.canDeposit);
  const canWithdrawForClient = !isEmployee && (isSuperAdmin || permissions.canWithdraw);

  const handleSaveClientConfig = async () => {
    const payload: { bonusPercentage?: number; bonusThresholdLimit?: number } = {};

    if (canEditBonus) {
      const b = parseFloat(bonusInput);
      if (isNaN(b) || b < 0 || b > 100) {
        Alert.alert('Invalid Bonus %', 'Bonus percentage must be between 0 and 100.');
        return;
      }
      payload.bonusPercentage = b;
    }

    if (canEditThreshold) {
      const t = parseFloat(thresholdInput);
      if (isNaN(t) || t < 0) {
        Alert.alert('Invalid Threshold', 'Threshold limit must be a positive number.');
        return;
      }
      payload.bonusThresholdLimit = t;
    }

    setIsSavingConfig(true);
    try {
      const res = await adminApi.updateUserBonusConfig(account.id, payload);
      if (res.success) {
        Alert.alert('Saved ✅', 'Client bonus & threshold configuration updated.');
        await Promise.all([loadDetails(true), refreshData()]);
      } else {
        Alert.alert('Error', res.error || 'Could not update configuration.');
      }
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleSaveEmployeePermissions = async () => {
    setIsSavingPerms(true);
    try {
      const res = await adminApi.updateEmployeePermissions(
        account.id,
        empPerms,
        newEmpPassword.trim() || undefined
      );
      if (res.success) {
        Alert.alert(
          'Permissions Updated 🛡️',
          `Permissions for ${account.name} have been saved${
            newEmpPassword.trim() ? ' and password has been reset' : ''
          }.`
        );
        setNewEmpPassword('');
        await loadDetails(true);
      } else {
        Alert.alert('Error', res.error || 'Could not update permissions.');
      }
    } finally {
      setIsSavingPerms(false);
    }
  };

  const handleSaveAccountDetails = async (data: {
    name?: string;
    email?: string;
    phone?: string;
    upiId?: string;
    bankAccount?: BankAccount | null;
  }) => {
    const res = await adminApi.updateUser(account.id, data);
    if (res.success) {
      await Promise.all([loadDetails(true), refreshData()]);
    }
    return res;
  };

  const handleConfirmToggleBlock = async () => {
    setBlockModalVisible(false);
    const res = await adminApi.toggleBlockUser(account.id, account.status !== 'blocked');
    if (res.success) {
      await Promise.all([loadDetails(true), refreshData()]);
      Alert.alert(
        'Status Updated',
        `${account.name} has been ${account.status === 'blocked' ? 'unblocked' : 'blocked'}.`
      );
    } else {
      Alert.alert('Error', res.error || 'Failed to update status.');
    }
  };

  return (
    <ScreenContainer
      scrollable
      refreshing={refreshing}
      onRefresh={() => loadDetails(true)}
      backgroundColor={colors.background}
    >
      <Header
        title={isEmployee ? 'Employee Details' : 'Client Profile'}
        subtitle={account.name}
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <View style={styles.content}>
        {/* Identity Card */}
        <View style={styles.card}>
          <View style={styles.identityRow}>
            <View
              style={[
                styles.avatarCircle,
                isEmployee && { backgroundColor: '#EDE9FE' },
              ]}
            >
              <Text
                style={[
                  styles.avatarText,
                  isEmployee && { color: '#7C3AED' },
                ]}
              >
                {account.name.slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.nameText}>{account.name}</Text>
                <StatusBadge status={account.status} size="sm" />
              </View>
              <Text style={styles.roleTag}>
                {isEmployee ? '🛡️ Staff Employee (Login Enabled)' : '👤 Client Account (No Login)'}
              </Text>
              <Text style={styles.metaText}>+91 {account.phone}</Text>
              {!!account.email && <Text style={styles.metaText}>{account.email}</Text>}
            </View>
            {canEditData && (
              <TouchableOpacity
                style={styles.editIconBtn}
                onPress={() => setEditModalVisible(true)}
              >
                <Ionicons name="pencil" size={14} color={colors.primary} />
                <Text style={styles.editIconText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {!isEmployee && (
            <View style={styles.paymentInfoStrip}>
              <Text style={styles.stripItem}>
                UPI: <Text style={styles.stripVal}>{account.upiId || 'Not set'}</Text>
              </Text>
              {account.bankAccount && (
                <Text style={styles.stripItem}>
                  Bank:{' '}
                  <Text style={styles.stripVal}>
                    {account.bankAccount.bankName} ({account.bankAccount.accountNumber})
                  </Text>
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Client Quick Actions (OCR Deposit / Withdraw) */}
        {!isEmployee && (canDepositForClient || canWithdrawForClient) && (
          <View style={styles.quickActionRow}>
            {canDepositForClient && (
              <PrimaryButton
                title="Deposit / OCR"
                icon="scan-outline"
                onPress={() =>
                  navigation.navigate('ClientOcrDeposit', { clientId: account.id })
                }
                style={{ flex: 1 }}
              />
            )}
            {canWithdrawForClient && (
              <SecondaryButton
                title="Withdraw Payout"
                onPress={() =>
                  navigation.navigate('ClientWithdraw', { clientId: account.id })
                }
                style={{ flex: 1 }}
              />
            )}
          </View>
        )}

        {/* Client Wallet Breakdown */}
        {!isEmployee && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Client Balance & Withdrawable Cash</Text>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Total Balance Points</Text>
              <Text style={[styles.metricValue, { color: colors.primary }]}>
                {formatPaiseToINR(account.totalBalancePaise || 0)}
              </Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Total Approved Principal</Text>
              <Text style={styles.metricValue}>
                {formatPaiseToINR(account.totalDepositPrincipalPaise || 0)}
              </Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Eligible Withdrawable Cash</Text>
              <Text style={[styles.metricValue, { color: '#15803D' }]}>
                {formatPaiseToINR(account.withdrawablePaise ?? account.totalBalancePaise ?? 0)}
              </Text>
            </View>
            <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.metricLabel}>Threshold Status</Text>
              <Text
                style={[
                  styles.metricValue,
                  { color: account.isThresholdReached ? '#B45309' : '#15803D' },
                ]}
              >
                {account.isThresholdReached
                  ? 'Limit Reached (Bonus Excluded)'
                  : 'Below Limit (Full Eligible)'}
              </Text>
            </View>
          </View>
        )}

        {/* Client Bonus % & Threshold Config (Permission-Gated) */}
        {!isEmployee && (canEditBonus || canEditThreshold) && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Bonus & Threshold Configuration</Text>
            <View style={styles.twoColRow}>
              {canEditBonus && (
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Custom Bonus (%)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={bonusInput}
                    onChangeText={setBonusInput}
                  />
                </View>
              )}
              {canEditThreshold && (
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Threshold Limit (₹)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={thresholdInput}
                    onChangeText={setThresholdInput}
                  />
                </View>
              )}
            </View>
            <PrimaryButton
              title={isSavingConfig ? 'Saving...' : 'Save Configuration'}
              onPress={handleSaveClientConfig}
              loading={isSavingConfig}
              fullWidth
              style={{ marginTop: 12 }}
            />
          </View>
        )}

        {/* Employee Permissions Editor (Super Admin ONLY) */}
        {isEmployee && isSuperAdmin && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Employee Permissions</Text>
            <Text style={styles.sectionSub}>
              Toggle exactly which operations {account.name} can perform after logging in.
            </Text>

            {PERMISSION_ITEMS.map((perm) => (
              <View key={perm.key} style={styles.permSwitchRow}>
                <View style={styles.permIconCircle}>
                  <Ionicons name={perm.icon} size={16} color="#6D28D9" />
                </View>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.permTitle}>{perm.title}</Text>
                  <Text style={styles.permDesc}>{perm.desc}</Text>
                </View>
                <Switch
                  value={empPerms[perm.key]}
                  onValueChange={() =>
                    setEmpPerms((prev) => ({ ...prev, [perm.key]: !prev[perm.key] }))
                  }
                  trackColor={{ false: '#E2E8F0', true: '#C4B5FD' }}
                  thumbColor={empPerms[perm.key] ? '#7C3AED' : '#94A3B8'}
                />
              </View>
            ))}

            <Text style={[styles.inputLabel, { marginTop: 14 }]}>
              Reset Login Password (Optional)
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Leave blank to keep current password"
              placeholderTextColor={colors.textLight}
              secureTextEntry
              value={newEmpPassword}
              onChangeText={setNewEmpPassword}
            />

            <PrimaryButton
              title={isSavingPerms ? 'Saving Permissions...' : 'Save Permissions'}
              onPress={handleSaveEmployeePermissions}
              loading={isSavingPerms}
              fullWidth
              icon="shield-checkmark-outline"
              style={{ marginTop: 14 }}
            />
          </View>
        )}

        {/* Account Status Toggle */}
        {canEditData && (
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.blockBtn}
              onPress={() => setBlockModalVisible(true)}
            >
              <Ionicons
                name={account.status === 'blocked' ? 'checkmark-circle-outline' : 'ban-outline'}
                size={18}
                color={account.status === 'blocked' ? colors.success : colors.danger}
              />
              <Text
                style={[
                  styles.blockBtnText,
                  { color: account.status === 'blocked' ? colors.success : colors.danger },
                ]}
              >
                {account.status === 'blocked'
                  ? `Unblock ${isEmployee ? 'Employee' : 'Client'} Account`
                  : `Suspend / Block ${isEmployee ? 'Employee' : 'Client'} Account`}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Client Transactions History */}
        {!isEmployee && (
          <View style={{ marginTop: 4 }}>
            <Text style={styles.historyTitle}>
              Transaction History ({accountTxns.length})
            </Text>
            {accountTxns.length > 0 ? (
              accountTxns.map((txn) => (
                <TransactionRow
                  key={txn.id}
                  transaction={txn}
                  onPress={() =>
                    navigation.navigate('TransactionDetails', { transactionId: txn.id })
                  }
                />
              ))
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyBoxText}>No transactions recorded for this client yet.</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Edit Client / Employee Profile Modal */}
      <EditProfileModal
        visible={editModalVisible}
        user={account}
        initialTab="personal"
        onClose={() => setEditModalVisible(false)}
        onSave={handleSaveAccountDetails}
      />

      {/* Block / Unblock Confirmation */}
      <ConfirmationModal
        visible={blockModalVisible}
        title={account.status === 'blocked' ? 'Unblock Account?' : 'Block Account?'}
        message={
          account.status === 'blocked'
            ? `Restore active status for ${account.name}?`
            : `Suspend ${account.name}? They will be prevented from transactions${
                isEmployee ? ' and login' : ''
              }.`
        }
        confirmLabel={account.status === 'blocked' ? 'Unblock' : 'Block Account'}
        variant={account.status === 'blocked' ? 'primary' : 'danger'}
        onConfirm={handleConfirmToggleBlock}
        onCancel={() => setBlockModalVisible(false)}
      />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameText: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  roleTag: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 2,
  },
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  editIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lightBlue,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 4,
  },
  editIconText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  paymentInfoStrip: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 4,
  },
  stripItem: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  stripVal: {
    fontWeight: '700',
    color: colors.text,
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
  },
  sectionSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  metricLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  twoColRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  permSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  permIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  permTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  permDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  blockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  blockBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
  },
  emptyBox: {
    backgroundColor: colors.white,
    padding: 20,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  emptyBoxText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});

export default UserDetailsScreen;
