import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { User, UserWalletSummary } from '../../types';
import { colors } from '../../theme/colors';
import { formatPaiseToINR } from '../../utils/currency';
import { StatusBadge } from '../common/StatusBadge';

interface UserCardProps {
  user: User;
  walletSummary: UserWalletSummary;
  onPress: () => void;
}

export const UserCard: React.FC<UserCardProps> = ({
  user,
  walletSummary,
  onPress,
}) => {
  const regDate = new Date(user.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Top Header: Avatar, Name, UserID, Status */}
      <View style={styles.topRow}>
        <View style={styles.userMainInfo}>
          {user.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>
                {user.name.slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.nameContainer}>
            <View style={styles.nameRow}>
              <Text style={styles.nameText}>{user.name}</Text>
              {user.kycStatus === 'verified' && (
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color={colors.primary}
                  style={styles.verifiedIcon}
                />
              )}
            </View>
            <Text style={styles.idText}>
              +91 {user.phone}
            </Text>
            {user.accountType !== 'EMPLOYEE' && (
              <Text style={styles.addedByText}>
                Added by:{' '}
                <Text style={styles.addedByName}>
                  {user.createdByName || 'Admin'}
                </Text>
              </Text>
            )}
            <Text style={styles.dateText}>Added: {regDate}</Text>
          </View>
        </View>

        <StatusBadge status={user.status} size="sm" />
      </View>

      {/* Bonus, Points Balance & Cycle Configuration Row */}
      <View style={styles.bonusBadgeRow}>
        <View style={[styles.bonusChip, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
          <Ionicons name="wallet-outline" size={12} color="#15803D" />
          <Text style={[styles.bonusChipText, { color: '#166534' }]}>
            Balance:{' '}
            <Text style={[styles.bonusChipBold, { color: '#15803D' }]}>
              {(
                (user.totalBalancePaise ?? walletSummary.availableBalancePaise ?? 0) /
                100
              ).toLocaleString('en-IN')}{' '}
              Pts
            </Text>
          </Text>
        </View>

        <View style={user.bonusPercentage ? styles.customBonusChip : styles.limitChip}>
          <Ionicons
            name={user.bonusPercentage ? 'gift-outline' : 'repeat-outline'}
            size={12}
            color={user.bonusPercentage ? '#166534' : colors.primary}
          />
          <Text style={styles.limitChipText}>
            {user.bonusPercentage ? (
              <>
                Custom Bonus:{' '}
                <Text style={[styles.limitChipBold, { color: '#166534' }]}>
                  {user.bonusPercentage}%
                </Text>
              </>
            ) : (
              <>
                Active Bonus:{' '}
                <Text style={styles.limitChipBold}>
                  {((user.activeBonusPaise ?? 0) / 100).toLocaleString('en-IN')} Pts
                </Text>
              </>
            )}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* 4 Core Financial Metrics */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>Cash Deposited</Text>
          <Text style={[styles.metricValue, { color: colors.success }]}>
            {formatPaiseToINR(
              user.totalCashDepositedPaise ??
                walletSummary.totalCashDepositedPaise ??
                walletSummary.totalDepositPaise ??
                0
            )}
          </Text>
        </View>

        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>Points Deposited</Text>
          <Text style={[styles.metricValue, { color: colors.primary }]}>
            {(
              (user.totalPointsDepositedPaise ??
                walletSummary.totalPointsDepositedPaise ??
                (walletSummary.totalDepositPaise || 0) +
                  (walletSummary.totalBonusPaise || 0)) /
              100
            ).toLocaleString('en-IN')}{' '}
            Pts
          </Text>
        </View>

        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>Points Withdrawn</Text>
          <Text style={[styles.metricValue, { color: colors.danger }]}>
            {(
              (user.totalPointsWithdrawnPaise ??
                walletSummary.totalPointsWithdrawnPaise ??
                walletSummary.totalWithdrawalPaise ??
                0) / 100
            ).toLocaleString('en-IN')}{' '}
            Pts
          </Text>
        </View>

        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>Cash Withdrawn</Text>
          <Text style={[styles.metricValue, { color: '#B45309' }]}>
            {formatPaiseToINR(
              user.totalCashWithdrawnPaise ??
                walletSummary.totalCashWithdrawnPaise ??
                walletSummary.totalWithdrawalPaise ??
                0
            )}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  userMainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 12,
  },
  avatarPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  nameContainer: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  verifiedIcon: {
    marginLeft: 4,
  },
  idText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  addedByText: {
    fontSize: 11,
    color: colors.primary,
    marginTop: 1,
  },
  addedByName: {
    fontWeight: '700',
    color: colors.primaryDark || colors.primary,
  },
  dateText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 12,
  },
  bonusBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  bonusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 4,
  },
  bonusChipText: {
    fontSize: 11,
    color: '#92400E',
  },
  bonusChipBold: {
    fontWeight: '700',
    color: '#78350F',
  },
  customBonusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  limitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 4,
  },
  limitChipText: {
    fontSize: 11,
    color: colors.primary,
  },
  limitChipBold: {
    fontWeight: '700',
    color: colors.secondary,
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricCol: {
    alignItems: 'flex-start',
  },
  metricLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  balanceValue: {
    color: colors.primary,
  },
  bonusValue: {
    color: colors.warningDark,
  },
});

export default UserCard;

