import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { Header } from '../../components/common/Header';
import { StatCard } from '../../components/cards/StatCard';
import { TransactionRow } from '../../components/cards/TransactionRow';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';
import { formatPaiseToINR } from '../../utils/currency';

export const AdminDashboard = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { user, isSuperAdmin, permissions } = useAuth();
  const { adminStats, transactions, refreshData } = useWallet();

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  };

  const canDepositAny =
    isSuperAdmin || permissions.canOcrUpload || permissions.canDeposit;
  const canWithdraw = isSuperAdmin || permissions.canWithdraw;
  const canViewClients =
    isSuperAdmin ||
    permissions.canManageClients ||
    permissions.canSetBonus ||
    permissions.canSetThreshold;
  const canManageDailyRules =
    isSuperAdmin || permissions.canSetBonus || permissions.canSetThreshold;

  const recentTransactions = transactions
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 6);

  const activePermissionTags = [
    permissions.canOcrUpload && 'OCR Upload',
    permissions.canDeposit && 'Deposit',
    permissions.canWithdraw && 'Withdraw',
    permissions.canSetBonus && 'Bonus %',
    permissions.canSetThreshold && 'Threshold',
    permissions.canManageClients && 'Client Data',
  ].filter(Boolean) as string[];

  return (
    <ScreenContainer
      scrollable
      refreshing={refreshing}
      onRefresh={onRefresh}
      backgroundColor={colors.background}
    >
      <Header
        greeting={isSuperAdmin ? 'Super Admin Console' : 'Employee Portal'}
        userName={user?.name || 'Staff Member'}
        showProfile
        onProfilePress={() => navigation.navigate('AdminProfile')}
        rightAction={
          <View
            style={[
              styles.rolePill,
              !isSuperAdmin && { backgroundColor: '#EDE9FE' },
            ]}
          >
            <Ionicons
              name={isSuperAdmin ? 'shield-checkmark' : 'person-circle'}
              size={14}
              color={isSuperAdmin ? colors.primary : '#7C3AED'}
            />
            <Text
              style={[
                styles.rolePillText,
                !isSuperAdmin && { color: '#6D28D9' },
              ]}
            >
              {isSuperAdmin ? 'Super Admin' : 'Employee'}
            </Text>
          </View>
        }
      />

      <View style={styles.content}>
        {/* Auto-Accept Operational Mode Strip */}
        <View style={styles.autoAcceptStrip}>
          <View style={styles.greenDot} />
          <Text style={styles.autoAcceptStripText}>
            Auto-Accept Mode Active • Instant Verified Processing
          </Text>
        </View>

        {/* Employee Assigned Permissions Card (for Employees) */}
        {!isSuperAdmin && (
          <View style={styles.empPermsBanner}>
            <Text style={styles.empPermsTitle}>Your Assigned Permissions</Text>
            <View style={styles.empPermsRow}>
              {activePermissionTags.length > 0 ? (
                activePermissionTags.map((tag) => (
                  <View key={tag} style={styles.empPermPill}>
                    <Ionicons name="checkmark-circle" size={12} color="#6D28D9" />
                    <Text style={styles.empPermPillText}>{tag}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.noPermHint}>
                  No operational permissions assigned yet. Contact Super Admin.
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Section Title */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Operational Overview</Text>
        </View>

        {/* Clean Operational Metrics Grid (NO Liability Wallet, NO Pending Approval Queues) */}
        <View style={styles.statsGrid}>
          <StatCard
            title="Total Clients"
            value={(adminStats?.totalClients ?? adminStats?.totalUsers ?? 0).toString()}
            subtitle="Managed client accounts"
            icon="people"
            variant="primary"
            onPress={canViewClients ? () => navigation.navigate('Users') : undefined}
          />

          {isSuperAdmin ? (
            <StatCard
              title="Staff Employees"
              value={(adminStats?.totalEmployees ?? 0).toString()}
              subtitle="Active login staff"
              icon="shield-checkmark"
              variant="info"
              onPress={() =>
                navigation.navigate('Users', { initialTab: 'EMPLOYEE' })
              }
            />
          ) : (
            <StatCard
              title="Total Transactions"
              value={(adminStats?.totalTransactionsCount ?? transactions.length).toString()}
              subtitle="Auto-accepted ledger"
              icon="receipt"
              variant="info"
              onPress={() => navigation.navigate('AdminTransactions')}
            />
          )}

          <StatCard
            title="Total Deposits"
            value={
              adminStats
                ? formatPaiseToINR(adminStats.totalApprovedDepositsPaise)
                : '₹0'
            }
            subtitle="Auto-credited principal"
            icon="arrow-down-circle"
            variant="success"
            onPress={
              canDepositAny
                ? () => navigation.navigate('ClientOcrDeposit')
                : undefined
            }
          />

          <StatCard
            title="Total Withdrawals"
            value={
              adminStats
                ? formatPaiseToINR(adminStats.totalApprovedWithdrawalsPaise)
                : '₹0'
            }
            subtitle="Instant payouts processed"
            icon="arrow-up-circle"
            variant="danger"
            onPress={
              canWithdraw
                ? () => navigation.navigate('ClientWithdraw')
                : undefined
            }
          />

          <StatCard
            title="Bonus Credited"
            value={
              adminStats
                ? formatPaiseToINR(adminStats.totalBonusGivenPaise)
                : '₹0'
            }
            subtitle="Promotional bonus points"
            icon="gift"
            variant="warning"
          />

          <StatCard
            title="Processed Ledger"
            value={(adminStats?.totalTransactionsCount ?? transactions.length).toString()}
            subtitle="All auto-approved entries"
            icon="document-text"
            variant="info"
            onPress={() => navigation.navigate('AdminTransactions')}
          />
        </View>

        {/* Permission-Gated Quick Actions */}
        <View style={styles.managementCard}>
          <Text style={styles.managementTitle}>Quick Operations</Text>
          <View style={styles.actionsGrid}>
            {canDepositAny && (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => navigation.navigate('ClientOcrDeposit')}
              >
                <View style={[styles.actionIconBox, { backgroundColor: '#EDE9FE' }]}>
                  <Ionicons name="scan" size={20} color="#7C3AED" />
                </View>
                <Text style={styles.actionItemText}>OCR Deposit</Text>
              </TouchableOpacity>
            )}

            {canWithdraw && (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => navigation.navigate('ClientWithdraw')}
              >
                <View
                  style={[styles.actionIconBox, { backgroundColor: colors.dangerLight }]}
                >
                  <Ionicons name="arrow-up" size={20} color={colors.danger} />
                </View>
                <Text style={styles.actionItemText}>Withdraw</Text>
              </TouchableOpacity>
            )}

            {canViewClients && (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() =>
                  navigation.navigate('Users', { initialTab: 'CLIENT' })
                }
              >
                <View
                  style={[styles.actionIconBox, { backgroundColor: colors.lightBlue }]}
                >
                  <Ionicons name="people" size={20} color={colors.primary} />
                </View>
                <Text style={styles.actionItemText}>Clients</Text>
              </TouchableOpacity>
            )}

            {canManageDailyRules && (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => navigation.navigate('BonusSettings')}
              >
                <View
                  style={[styles.actionIconBox, { backgroundColor: '#FEF3C7' }]}
                >
                  <Ionicons name="options-outline" size={20} color={colors.warningDark} />
                </View>
                <Text style={styles.actionItemText}>Daily Rules</Text>
              </TouchableOpacity>
            )}

            {isSuperAdmin ? (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() =>
                  navigation.navigate('Users', { initialTab: 'EMPLOYEE' })
                }
              >
                <View style={[styles.actionIconBox, { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="key" size={20} color={colors.warningDark} />
                </View>
                <Text style={styles.actionItemText}>Employees</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => navigation.navigate('AdminTransactions')}
              >
                <View style={[styles.actionIconBox, { backgroundColor: '#DCFCE7' }]}>
                  <Ionicons name="list" size={20} color="#15803D" />
                </View>
                <Text style={styles.actionItemText}>Ledger</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Recent Auto-Approved Transactions */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          {transactions.length > 0 && (
            <TouchableOpacity
              onPress={() => navigation.navigate('AdminTransactions')}
            >
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.transactionsContainer}>
          {recentTransactions.length > 0 ? (
            recentTransactions.map((item) => (
              <TransactionRow
                key={item.id}
                transaction={item}
                showUserName
                onPress={() =>
                  navigation.navigate('TransactionDetails', {
                    transactionId: item.id,
                  })
                }
              />
            ))
          ) : (
            <View style={styles.zeroStateBox}>
              <Ionicons
                name="wallet-outline"
                size={36}
                color={colors.textLight}
              />
              <Text style={styles.zeroStateTitle}>No Activity Yet</Text>
              <Text style={styles.zeroStateSub}>
                Create a client account and scan a verified receipt screenshot to
                auto-credit their wallet.
              </Text>
            </View>
          )}
        </View>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lightBlue,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
    marginRight: 6,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryDark,
    marginLeft: 4,
  },
  autoAcceptStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    gap: 8,
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A',
  },
  autoAcceptStripText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  empPermsBanner: {
    backgroundColor: '#F5F3FF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  empPermsTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5B21B6',
    marginBottom: 8,
  },
  empPermsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  empPermPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  empPermPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6D28D9',
  },
  noPermHint: {
    fontSize: 12,
    color: '#6D28D9',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  managementCard: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  managementTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionItem: {
    alignItems: 'center',
    width: '22%',
    minWidth: 72,
  },
  actionIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  actionItemText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  zeroStateBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 20,
  },
  zeroStateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: 8,
  },
  zeroStateSub: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  transactionsContainer: {
    marginTop: 4,
  },
});

export default AdminDashboard;
