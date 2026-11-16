import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { Header } from '../../components/common/Header';
import { UserCard } from '../../components/cards/UserCard';
import { EmptyState } from '../../components/common/EmptyState';
import { PrimaryButton } from '../../components/buttons/PrimaryButton';
import { SecondaryButton } from '../../components/buttons/SecondaryButton';
import { adminApi } from '../../services/api';
import { storageService } from '../../services/storageService';
import { useWallet } from '../../hooks/useWallet';
import { calculateUserWallet } from '../../utils/calculations';
import { User, UserWalletSummary } from '../../types';

export const UserManagementScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { transactions } = useWallet();

  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');

  // Create User Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [bonusPercentage, setBonusPercentage] = useState('10.0');
  const [bonusThresholdLimit, setBonusThresholdLimit] = useState('10000');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  /**
   * Fetches live user list from GET /api/admin/users
   */
  const loadUsers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setIsLoading(true);

    try {
      const res = await adminApi.getUsers({
        role: 'USER',
      });

      if (res.success && res.users) {
        const mappedUsers: User[] = res.users.map((u: any) => ({
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
        }));
        setUsers(mappedUsers);
      } else {
        console.warn('Failed to fetch live users:', res.error);
        const local = await storageService.getUsers();
        if (local && local.length > 0) {
          setUsers(local);
        }
      }
    } catch (error) {
      console.error('Error loading users:', error);
      const local = await storageService.getUsers();
      if (local && local.length > 0) {
        setUsers(local);
      }
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const onRefresh = () => {
    loadUsers(true);
  };

  /**
   * Handles POST /api/admin/users/create
   */
  const handleCreateUser = async () => {
    setFormError('');

    if (!name.trim()) {
      setFormError('Please enter user full name.');
      return;
    }

    if (!phone.trim()) {
      setFormError('Please enter user phone number.');
      return;
    }

    if (!password || password.length < 4) {
      setFormError('Password must be at least 4 characters long.');
      return;
    }

    const parsedBonus = parseFloat(bonusPercentage);
    if (isNaN(parsedBonus) || parsedBonus < 0 || parsedBonus > 100) {
      setFormError('Bonus % must be a number between 0 and 100.');
      return;
    }

    const parsedLimit = parseFloat(bonusThresholdLimit);
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      setFormError('Bonus threshold limit must be a positive number.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await adminApi.createUser({
        name: name.trim(),
        phone: phone.trim(),
        password: password.trim(),
        bonusPercentage: parsedBonus,
        bonusThresholdLimit: parsedLimit,
      });

      if (res.success) {
        Alert.alert(
          'User Created Successfully! 🎉',
          `Account for ${name.trim()} (${phone.trim()}) is active with ${parsedBonus}% cashback bonus.`
        );

        // Reset form and close modal
        setName('');
        setPhone('');
        setPassword('');
        setBonusPercentage('10.0');
        setBonusThresholdLimit('10000');
        setModalVisible(false);

        // Refresh user list from live backend
        await loadUsers(true);
      } else {
        setFormError(res.error || 'Failed to create user. Please check credentials.');
      }
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while creating user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Client-side search and filtering
  const filteredUsers = users.filter((u) => {
    if (statusFilter !== 'all' && u.status !== statusFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = u.name.toLowerCase().includes(q);
      const matchId = u.id.toLowerCase().includes(q);
      const matchPhone = u.phone.includes(q);
      return matchName || matchId || matchPhone;
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
        title="User Management"
        subtitle={`${users.length} live registered users`}
      />

      <View style={styles.content}>
        {/* Top Action Bar: Add User Button */}
        <TouchableOpacity
          style={styles.addUserButton}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.8}
        >
          <View style={styles.addUserIconCircle}>
            <Ionicons name="person-add" size={18} color={colors.white} />
          </View>
          <View style={styles.addUserTextCol}>
            <Text style={styles.addUserTitle}>Create New User</Text>
            <Text style={styles.addUserSubtitle}>
              Configure custom Cashback % & Threshold Limit
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </TouchableOpacity>

        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by Name, ID or Phone..."
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

        {/* Status Filters */}
        <View style={styles.filterRow}>
          {(['all', 'active', 'blocked'] as const).map((filter) => {
            const isSelected = statusFilter === filter;
            const labels = {
              all: `All Users (${users.length})`,
              active: `Active (${users.filter((u) => u.status === 'active').length})`,
              blocked: `Blocked (${users.filter((u) => u.status === 'blocked').length})`,
            };
            return (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.filterChip,
                  isSelected && styles.filterChipSelected,
                ]}
                onPress={() => setStatusFilter(filter)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isSelected && styles.filterChipTextSelected,
                  ]}
                >
                  {labels[filter]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Users List */}
        {isLoading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Fetching live users from Neon DB...</Text>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {filteredUsers.length > 0 ? (
              filteredUsers.map((user) => {
                const walletSummary: UserWalletSummary = calculateUserWallet(
                  user.id,
                  transactions
                );
                // Override available balance with live balance from backend if present
                if (user.totalBalancePaise !== undefined) {
                  walletSummary.availableBalancePaise = user.totalBalancePaise;
                }

                return (
                  <UserCard
                    key={user.id}
                    user={user}
                    walletSummary={walletSummary}
                    onPress={() =>
                      navigation.navigate('UserDetails', {
                        userId: user.id,
                        userInitial: user,
                      })
                    }
                  />
                );
              })
            ) : (
              <EmptyState
                icon="account-search-outline"
                title="No users found"
                description={
                  searchQuery
                    ? 'No registered users match your search query.'
                    : 'No users created yet. Tap "Create New User" to register a user.'
                }
                actionLabel={searchQuery ? 'Reset Search' : 'Create User'}
                onAction={() => {
                  if (searchQuery) {
                    setSearchQuery('');
                    setStatusFilter('all');
                  } else {
                    setModalVisible(true);
                  }
                }}
              />
            )}
          </View>
        )}
      </View>

      {/* CREATE USER MODAL */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Create New User</Text>
                <Text style={styles.modalSubtitle}>
                  Set credentials and custom bonus configuration
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.formContainer}
            >
              {formError ? (
                <View style={styles.errorAlert}>
                  <Ionicons name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              ) : null}

              {/* Full Name */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Aditya Sharma"
                    placeholderTextColor={colors.textLight}
                    value={name}
                    onChangeText={setName}
                  />
                </View>
              </View>

              {/* Phone Number */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Mobile Phone Number</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="call-outline" size={18} color={colors.textMuted} />
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 9820123456"
                    placeholderTextColor={colors.textLight}
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={setPhone}
                  />
                </View>
              </View>

              {/* Password */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={18}
                    color={colors.textMuted}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Minimum 4 characters"
                    placeholderTextColor={colors.textLight}
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                  />
                </View>
              </View>

              {/* Bonus Percentage */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>Assigned Bonus Rate (%)</Text>
                  <Text style={styles.labelHint}>Default: 10%</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <Ionicons name="sparkles" size={18} color="#D97706" />
                  <TextInput
                    style={styles.input}
                    placeholder="10.0"
                    placeholderTextColor={colors.textLight}
                    keyboardType="numeric"
                    value={bonusPercentage}
                    onChangeText={setBonusPercentage}
                  />
                </View>
              </View>

              {/* Bonus Threshold Limit in Rupees */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>Bonus Threshold Limit (₹)</Text>
                  <Text style={styles.labelHint}>Default: ₹10,000</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <Text style={styles.currencyPrefix}>₹</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="10000"
                    placeholderTextColor={colors.textLight}
                    keyboardType="numeric"
                    value={bonusThresholdLimit}
                    onChangeText={setBonusThresholdLimit}
                  />
                </View>
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                <SecondaryButton
                  title="Cancel"
                  onPress={() => setModalVisible(false)}
                  style={styles.cancelBtn}
                />
                <PrimaryButton
                  title="Create User"
                  onPress={handleCreateUser}
                  loading={isSubmitting}
                  style={styles.submitBtn}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  addUserButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    marginBottom: 14,
  },
  addUserIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addUserTextCol: {
    flex: 1,
    marginLeft: 12,
  },
  addUserTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  addUserSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: colors.text,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
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
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: colors.textSecondary,
  },
  listContainer: {
    marginTop: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  formContainer: {
    paddingVertical: 14,
  },
  errorAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    gap: 8,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    flex: 1,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 12,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  labelHint: {
    fontSize: 11,
    color: colors.textMuted,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  currencyPrefix: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginRight: 6,
  },
  input: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
  },
  submitBtn: {
    flex: 1.5,
  },
});

export default UserManagementScreen;
