import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { formatPaiseToINR } from '../../utils/currency';
import { UserWalletSummary } from '../../types';

interface BalanceCardProps {
  wallet: UserWalletSummary | null;
  isBalanceHidden: boolean;
  onToggleHideBalance: () => void;
  onDepositPress: () => void;
  onWithdrawPress: () => void;
  bonusRate?: number;
}

export const BalanceCard: React.FC<BalanceCardProps> = ({
  wallet,
  isBalanceHidden,
  onToggleHideBalance,
  onDepositPress,
  onWithdrawPress,
  bonusRate = 5,
}) => {
  const availableBalance = wallet ? wallet.availableBalancePaise : 0;
  const totalDeposit = wallet ? wallet.totalDepositPaise : 0;
  const totalWithdrawal = wallet ? wallet.totalWithdrawalPaise : 0;
  const totalBonus = wallet ? wallet.totalBonusPaise : 0;

  const displayBalance = isBalanceHidden
    ? '••••••••'
    : `${(availableBalance / 100).toLocaleString('en-IN')} Points`;

  const cashDeposited =
    wallet?.totalCashDepositedPaise ?? wallet?.totalDepositPaise ?? 0;
  const pointsDeposited =
    wallet?.totalPointsDepositedPaise ??
    (wallet?.totalDepositPaise || 0) + (wallet?.totalBonusPaise || 0);
  const pointsWithdrawn =
    wallet?.totalPointsWithdrawnPaise ?? wallet?.totalWithdrawalPaise ?? 0;
  const cashWithdrawn =
    wallet?.totalCashWithdrawnPaise ?? wallet?.totalWithdrawalPaise ?? 0;

  return (
    <View style={styles.shadowWrapper}>
      <LinearGradient
        colors={colors.gradientCard}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* Top Header */}
        <View style={styles.topRow}>
          <View>
            <View style={styles.balanceLabelRow}>
              <Text style={styles.balanceLabel}>Available Points Balance</Text>
              <TouchableOpacity
                onPress={onToggleHideBalance}
                style={styles.eyeBtn}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isBalanceHidden ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color="rgba(255,255,255,0.8)"
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.balanceAmount}>{displayBalance}</Text>
            {wallet?.withdrawablePaise !== undefined && (
              <Text style={styles.cashoutHint}>
                Real Cash Value:{' '}
                {isBalanceHidden
                  ? '••••'
                  : formatPaiseToINR(
                      wallet.isBonusDeductedInCycle
                        ? wallet.availableBalancePaise
                        : Math.max(
                            0,
                            wallet.availableBalancePaise -
                              (wallet.activeBonusPaise || 0)
                          )
                    )}
              </Text>
            )}
          </View>

          {wallet?.isBonusDeductedInCycle ? (
            <View style={[styles.bonusBadge, { backgroundColor: 'rgba(22, 101, 52, 0.4)' }]}>
              <MaterialCommunityIcons
                name="check-decagram"
                size={12}
                color="#86EFAC"
              />
              <Text style={styles.bonusBadgeText}>100% Cashout Mode</Text>
            </View>
          ) : (wallet?.activeBonusPaise || 0) > 0 ? (
            <View style={styles.bonusBadge}>
              <MaterialCommunityIcons
                name="star-four-points"
                size={12}
                color="#F59E0B"
              />
              <Text style={styles.bonusBadgeText}>
                Active Bonus: {((wallet?.activeBonusPaise || 0) / 100).toLocaleString('en-IN')} Pts
              </Text>
            </View>
          ) : bonusRate > 0 ? (
            <View style={styles.bonusBadge}>
              <MaterialCommunityIcons
                name="star-four-points"
                size={12}
                color="#F59E0B"
              />
              <Text style={styles.bonusBadgeText}>{bonusRate}% Bonus Active</Text>
            </View>
          ) : null}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* The 4 Core Financial Values Grid */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Cash Deposited</Text>
            <Text style={styles.metricValue}>
              {isBalanceHidden ? '••••' : formatPaiseToINR(cashDeposited)}
            </Text>
          </View>

          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Points Deposited</Text>
            <Text style={[styles.metricValue, styles.bonusText]}>
              {isBalanceHidden
                ? '••••'
                : `${(pointsDeposited / 100).toLocaleString('en-IN')} Pts`}
            </Text>
          </View>

          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Points Withdrawn</Text>
            <Text style={styles.metricValue}>
              {isBalanceHidden
                ? '••••'
                : `${(pointsWithdrawn / 100).toLocaleString('en-IN')} Pts`}
            </Text>
          </View>

          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Cash Withdrawn</Text>
            <Text style={styles.metricValue}>
              {isBalanceHidden ? '••••' : formatPaiseToINR(cashWithdrawn)}
            </Text>
          </View>
        </View>

        {/* Quick Actions (Deposit & Withdraw) */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.depositBtn]}
            onPress={onDepositPress}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-down-circle" size={18} color={colors.primaryDark} />
            <Text style={styles.depositBtnText}>Deposit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.withdrawBtn]}
            onPress={onWithdrawPress}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-up-circle" size={18} color={colors.white} />
            <Text style={styles.withdrawBtnText}>Withdraw</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  shadowWrapper: {
    marginHorizontal: 16,
    marginVertical: 12,
    borderRadius: 22,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 8,
  },
  card: {
    borderRadius: 22,
    padding: 20,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  balanceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  balanceLabel: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  eyeBtn: {
    marginLeft: 8,
    padding: 2,
  },
  balanceAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.5,
  },
  cashoutHint: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '600',
    marginTop: 2,
  },
  bonusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  bonusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.white,
    marginLeft: 4,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginVertical: 16,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  metricItem: {
    width: '48%',
  },
  verticalDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: 8,
  },
  metricLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.75)',
    fontWeight: '500',
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
  bonusText: {
    color: '#FCD34D',
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 12,
  },
  depositBtn: {
    backgroundColor: colors.white,
  },
  depositBtnText: {
    color: colors.primaryDark,
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 6,
  },
  withdrawBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  withdrawBtnText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 6,
  },
});

export default BalanceCard;

