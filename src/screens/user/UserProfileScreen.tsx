import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { Header } from '../../components/common/Header';
import { StatusBadge } from '../../components/common/StatusBadge';
import { ConfirmationModal } from '../../components/modals/ConfirmationModal';
import { EditProfileModal } from '../../components/modals/EditProfileModal';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';
import { formatPaiseToINR } from '../../utils/currency';
import { User, BankAccount } from '../../types';

export const UserProfileScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { user, logout, updateProfile, refreshSession } = useAuth();
  const { userWallet, refreshBalance } = useWallet();

  const currentUser = user && user.role === 'user' ? (user as User) : null;
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editModalTab, setEditModalTab] = useState<'personal' | 'payment'>('personal');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleConfirmLogout = async () => {
    setLogoutModalVisible(false);
    await logout();
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshSession(), refreshBalance()]);
    } catch (e) {
      console.warn('Error refreshing profile:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveProfile = async (data: {
    name?: string;
    email?: string;
    phone?: string;
    upiId?: string;
    bankAccount?: BankAccount | null;
  }) => {
    const res = await updateProfile(data);
    if (res.success) {
      await refreshBalance();
    }
    return res;
  };

  const handleCopyText = (label: string, text?: string) => {
    if (!text) return;
    Alert.alert(
      `${label} Copied`,
      `${text}\n\nCopied to clipboard for your convenience.`
    );
  };

  return (
    <ScreenContainer
      scrollable
      backgroundColor={colors.background}
      onRefresh={handleRefresh}
      refreshing={isRefreshing}
    >
      <Header
        title="My Profile"
        showBack
        onBackPress={() => navigation.goBack()}
        rightAction={
          <TouchableOpacity onPress={handleRefresh} style={{ padding: 4 }}>
            <Ionicons name="refresh-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        }
      />

      <View style={styles.content}>
        {/* User Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarRow}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {user?.name?.slice(0, 2).toUpperCase() || 'VF'}
                </Text>
              </View>
            )}

            <View style={styles.nameContainer}>
              <View style={styles.nameRow}>
                <Text style={styles.nameText}>{user?.name || 'User'}</Text>
                <StatusBadge status="verified" size="sm" />
              </View>
              <Text style={styles.emailText}>
                {user?.email || 'No email registered'}
              </Text>
              <Text style={styles.phoneText}>+91 {user?.phone}</Text>
            </View>

            {/* Edit Button */}
            <TouchableOpacity
              style={styles.editProfileBtn}
              onPress={() => {
                setEditModalTab('personal');
                setEditModalVisible(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="pencil" size={14} color={colors.primary} />
              <Text style={styles.editProfileBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.cardFooterRow}>
            <TouchableOpacity
              style={styles.idBadge}
              onPress={() => handleCopyText('User ID', user?.id)}
              activeOpacity={0.7}
            >
              <Ionicons name="finger-print-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.idBadgeText}>
                ID: {user?.id?.slice(0, 8)}...
              </Text>
              <Ionicons name="copy-outline" size={12} color={colors.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCustomizeChip}
              onPress={() => {
                setEditModalTab('personal');
                setEditModalVisible(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="options-outline" size={13} color={colors.primary} />
              <Text style={styles.quickCustomizeText}>Customize Info</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Linked Payment Channels */}
        <View style={styles.menuCard}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardHeaderTitleGroup}>
              <Ionicons name="wallet-outline" size={18} color={colors.primary} />
              <Text style={styles.menuCardTitle}>Linked Payment Channels</Text>
            </View>
            <TouchableOpacity
              style={styles.configureBtn}
              onPress={() => {
                setEditModalTab('payment');
                setEditModalVisible(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={14} color={colors.primary} />
              <Text style={styles.configureBtnText}>Manage</Text>
            </TouchableOpacity>
          </View>

          {/* UPI Channel */}
          <TouchableOpacity
            style={styles.paymentChannelRow}
            onPress={() => {
              setEditModalTab('payment');
              setEditModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.channelIconCircle, { backgroundColor: colors.lightBlue }]}>
              <Ionicons name="flash" size={18} color={colors.primary} />
            </View>
            <View style={styles.channelInfo}>
              <View style={styles.channelHeader}>
                <Text style={styles.channelName}>Default UPI ID</Text>
                {currentUser?.upiId ? (
                  <View style={styles.activePill}>
                    <Text style={styles.activePillText}>Active</Text>
                  </View>
                ) : (
                  <View style={styles.missingPill}>
                    <Text style={styles.missingPillText}>Not Set</Text>
                  </View>
                )}
              </View>
              <Text style={styles.channelValue}>
                {currentUser?.upiId || 'No UPI ID linked. Tap to configure.'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
          </TouchableOpacity>

          {/* Bank Account Channel */}
          <TouchableOpacity
            style={[styles.paymentChannelRow, styles.paymentChannelRowBorder]}
            onPress={() => {
              setEditModalTab('payment');
              setEditModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.channelIconCircle, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="business" size={18} color={colors.success} />
            </View>
            <View style={styles.channelInfo}>
              <View style={styles.channelHeader}>
                <Text style={styles.channelName}>
                  {currentUser?.bankAccount?.bankName || 'Bank Account'}
                </Text>
                {currentUser?.bankAccount ? (
                  <View style={styles.activePill}>
                    <Text style={styles.activePillText}>Linked</Text>
                  </View>
                ) : (
                  <View style={styles.missingPill}>
                    <Text style={styles.missingPillText}>Optional</Text>
                  </View>
                )}
              </View>
              <Text style={styles.channelValue}>
                {currentUser?.bankAccount
                  ? `A/C: ${currentUser.bankAccount.accountNumber} (${currentUser.bankAccount.ifsc})`
                  : 'No bank account configured. Tap to link.'}
              </Text>
              {currentUser?.bankAccount?.accountHolderName && (
                <Text style={styles.accountHolderText}>
                  A/C Holder: {currentUser.bankAccount.accountHolderName}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
          </TouchableOpacity>
        </View>

        {/* Wallet Overview Summary */}
        <View style={styles.menuCard}>
          <Text style={styles.menuCardTitle}>Wallet Overview</Text>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Available Balance</Text>
            <Text style={[styles.metricVal, styles.primaryVal]}>
              {formatPaiseToINR(userWallet?.availableBalancePaise || 0)}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Total Lifetime Deposits</Text>
            <Text style={styles.metricVal}>
              {formatPaiseToINR(userWallet?.totalDepositPaise || 0)}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Total Lifetime Bonuses</Text>
            <Text style={[styles.metricVal, styles.bonusVal]}>
              {formatPaiseToINR(userWallet?.totalBonusPaise || 0)}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Total Lifetime Withdrawals</Text>
            <Text style={styles.metricVal}>
              {formatPaiseToINR(userWallet?.totalWithdrawalPaise || 0)}
            </Text>
          </View>
        </View>

        {/* Actions & Settings */}
        <View style={styles.menuCard}>
          <Text style={styles.menuCardTitle}>Account & Settings</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setEditModalTab('personal');
              setEditModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconCircle, { backgroundColor: colors.lightBlue }]}>
                <Ionicons name="person-circle-outline" size={18} color={colors.primary} />
              </View>
              <Text style={styles.menuItemText}>Edit Personal Details</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setEditModalTab('payment');
              setEditModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconCircle, { backgroundColor: '#F0FDF4' }]}>
                <Ionicons name="card-outline" size={18} color={colors.success} />
              </View>
              <Text style={styles.menuItemText}>Manage UPI & Bank Accounts</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('Support')}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconCircle, { backgroundColor: '#F3E8FF' }]}>
                <Ionicons name="headset-outline" size={18} color="#9333EA" />
              </View>
              <Text style={styles.menuItemText}>Help & Support Center</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('Notifications')}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconCircle, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="notifications-outline" size={18} color="#D97706" />
              </View>
              <Text style={styles.menuItemText}>Notifications & Updates</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setLogoutModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconCircle, { backgroundColor: colors.dangerLight }]}>
                <Ionicons name="log-out-outline" size={18} color={colors.danger} />
              </View>
              <Text style={[styles.menuItemText, { color: colors.danger }]}>
                Sign Out of VF Wallet
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
          </TouchableOpacity>
        </View>

        <Text style={styles.versionText}>VF Wallet Version 1.0.0</Text>
      </View>

      {/* Profile Edit / Customization Modal */}
      <EditProfileModal
        visible={editModalVisible}
        user={user}
        initialTab={editModalTab}
        onClose={() => setEditModalVisible(false)}
        onSave={handleSaveProfile}
      />

      {/* Logout Confirmation */}
      <ConfirmationModal
        visible={logoutModalVisible}
        title="Sign Out?"
        message="Are you sure you want to sign out of your account?"
        confirmLabel="Sign Out"
        variant="danger"
        icon="log-out-outline"
        onConfirm={handleConfirmLogout}
        onCancel={() => setLogoutModalVisible(false)}
      />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  profileCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
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
  avatarRow: {
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
  nameContainer: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameText: {
    fontSize: 18,
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
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lightBlue,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  editProfileBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  idBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    gap: 6,
  },
  idBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  quickCustomizeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    gap: 4,
  },
  quickCustomizeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  menuCard: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardHeaderTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  configureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: colors.lightBlue,
  },
  configureBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
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
  metricVal: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  primaryVal: {
    color: colors.primary,
  },
  bonusVal: {
    color: colors.warningDark,
  },
  paymentChannelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  paymentChannelRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginTop: 4,
    paddingTop: 10,
  },
  channelIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  channelInfo: {
    flex: 1,
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  channelName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  activePill: {
    backgroundColor: '#DCFCE7',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
  },
  missingPill: {
    backgroundColor: '#F3F4F6',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  missingPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
  channelValue: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  accountHolderText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  versionText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
});

export default UserProfileScreen;
