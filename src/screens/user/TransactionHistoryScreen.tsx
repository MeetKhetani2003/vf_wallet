import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { Header } from '../../components/common/Header';
import { TransactionRow } from '../../components/cards/TransactionRow';
import { EmptyState } from '../../components/common/EmptyState';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';

type DateFilterType = 'all' | 'today' | 'yesterday' | 'week' | 'month';

export const TransactionHistoryScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { user } = useAuth();
  const { transactions, refreshData } = useWallet();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<
    'all' | 'deposit' | 'withdrawal'
  >('all');
  const [dateFilter, setDateFilter] = useState<DateFilterType>('all');
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshData();
    }, [refreshData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterdayStart = new Date(yesterdayDate.getFullYear(), yesterdayDate.getMonth(), yesterdayDate.getDate()).getTime();
  const yesterdayEnd = new Date(yesterdayDate.getFullYear(), yesterdayDate.getMonth(), yesterdayDate.getDate(), 23, 59, 59, 999).getTime();

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const sevenDaysStart = new Date(sevenDaysAgo.getFullYear(), sevenDaysAgo.getMonth(), sevenDaysAgo.getDate()).getTime();

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const userTransactions = transactions
    .filter((t) => t.userId === user?.id)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  const filteredTransactions = userTransactions.filter((txn) => {
    // Type filter
    if (selectedType !== 'all' && txn.type !== selectedType) {
      return false;
    }
    // Date filter
    const txnTime = new Date(txn.createdAt).getTime();
    if (dateFilter === 'today') {
      if (txnTime < todayStart || txnTime > todayEnd) return false;
    } else if (dateFilter === 'yesterday') {
      if (txnTime < yesterdayStart || txnTime > yesterdayEnd) return false;
    } else if (dateFilter === 'week') {
      if (txnTime < sevenDaysStart) return false;
    } else if (dateFilter === 'month') {
      if (txnTime < startOfMonth) return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = txn.id.toLowerCase().includes(q);
      const matchMethod = txn.paymentMethod?.toLowerCase().includes(q);
      const matchNotes = txn.notes?.toLowerCase().includes(q);
      return matchId || matchMethod || matchNotes;
    }
    return true;
  });

  return (
    <ScreenContainer
      scrollable
      refreshing={refreshing}
      onRefresh={onRefresh}
      backgroundColor={colors.background}
    >
      <Header
        title="Transaction History"
        subtitle="Complete record of your wallet activities"
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <View style={styles.container}>
        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by Transaction ID or payment mode..."
            placeholderTextColor={colors.textLight}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Type Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          {(['all', 'deposit', 'withdrawal'] as const).map((type) => {
            const isSelected = selectedType === type;
            const labels = {
              all: 'All Types',
              deposit: 'Deposits 📥',
              withdrawal: 'Withdrawals 📤',
            };
            return (
              <TouchableOpacity
                key={type}
                style={[
                  styles.filterChip,
                  isSelected && styles.filterChipSelected,
                ]}
                onPress={() => setSelectedType(type)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isSelected && styles.filterChipTextSelected,
                  ]}
                >
                  {labels[type]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Date Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          {(
            [
              { key: 'all', label: 'All Dates' },
              { key: 'today', label: 'Today' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: 'week', label: 'Last 7 Days' },
              { key: 'month', label: 'This Month' },
            ] as const
          ).map((item) => {
            const isSelected = dateFilter === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.statusChip,
                  isSelected && styles.statusChipSelected,
                ]}
                onPress={() => setDateFilter(item.key)}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    isSelected && styles.statusChipTextSelected,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* List of Transactions */}
        <View style={styles.listContainer}>
          {filteredTransactions.length > 0 ? (
            filteredTransactions.map((item) => (
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
          ) : userTransactions.length === 0 ? (
            <EmptyState
              icon="receipt-text-outline"
              title="No Transactions Yet"
              description="Your transactions will appear here once you share a payment screenshot or select one from the gallery."
              actionLabel="Submit Screenshot"
              onAction={() => navigation.navigate('Deposit')}
            />
          ) : (
            <EmptyState
              icon="filter-outline"
              title="No matching transactions"
              description="No transactions match your current filters or search query."
              actionLabel="Clear Filters"
              onAction={() => {
                setSelectedType('all');
                setDateFilter('all');
                setSearchQuery('');
              }}
            />
          )}
        </View>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: colors.text,
  },
  chipRow: {
    marginBottom: 8,
  },
  chipRowContent: {
    gap: 8,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  filterChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterChipTextSelected: {
    color: colors.white,
  },
  statusChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusChipSelected: {
    backgroundColor: colors.lightBlue,
    borderColor: colors.primary,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  statusChipTextSelected: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  listContainer: {
    marginTop: 6,
  },
});

export default TransactionHistoryScreen;

