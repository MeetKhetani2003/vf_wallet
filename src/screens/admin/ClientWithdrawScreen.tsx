import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  FlatList,
  TextInput,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { Header } from '../../components/common/Header';
import { CustomInput } from '../../components/inputs/CustomInput';
import { PrimaryButton } from '../../components/buttons/PrimaryButton';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';
import { adminApi } from '../../services/api';
import { formatPaiseToINR, rupeesToPaise } from '../../utils/currency';
import { User } from '../../types';

type RouteParams = {
  ClientWithdraw?: {
    clientId?: string;
  };
};

export const ClientWithdrawScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'ClientWithdraw'>>();
  const { isSuperAdmin, permissions } = useAuth();
  const { users, refreshData } = useWallet();

  const canWithdraw = isSuperAdmin || permissions.canWithdraw;

  const [clients, setClients] = useState<User[]>(users);
  const [selectedClient, setSelectedClient] = useState<User | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  const [amountText, setAmountText] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<'upi' | 'bank' | 'direct'>('upi');
  const [upiId, setUpiId] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadClients = useCallback(async () => {
    try {
      const res = await adminApi.getUsers({ role: 'CLIENT' });
      if (res.success && Array.isArray(res.users)) {
        const mapped: User[] = res.users.map((u: any) => ({
          id: u.id,
          name: u.name,
          phone: u.phone,
          email: u.email || '',
          role: 'user',
          accountType: 'CLIENT',
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
        setClients(mapped);

        const targetId = route.params?.clientId || selectedClient?.id;
        if (targetId) {
          const found = mapped.find((c) => c.id === targetId);
          if (found) {
            setSelectedClient(found);
          }
        }
      }
    } catch (e) {
      console.warn('Could not load clients for withdrawal:', e);
    }
  }, [route.params?.clientId, selectedClient?.id]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  // Pre-fill client's saved UPI / Bank when client changes
  const handleSelectClient = (client: User) => {
    setSelectedClient(client);
    setUpiId(client.upiId || '');
    setBankName(client.bankAccount?.bankName || '');
    setAccountNumber(client.bankAccount?.accountNumber || '');
    setIfsc(client.bankAccount?.ifsc || '');
    setAccountHolderName(client.bankAccount?.accountHolderName || client.name);
    setAmountText('');
    setPickerVisible(false);
    setClientSearch('');
  };

  useEffect(() => {
    if (selectedClient && !upiId && selectedClient.upiId) {
      setUpiId(selectedClient.upiId);
    }
    if (selectedClient && !accountNumber && selectedClient.bankAccount) {
      setBankName(selectedClient.bankAccount.bankName || '');
      setAccountNumber(selectedClient.bankAccount.accountNumber || '');
      setIfsc(selectedClient.bankAccount.ifsc || '');
      setAccountHolderName(
        selectedClient.bankAccount.accountHolderName || selectedClient.name
      );
    }
  }, [selectedClient]);

  const activeClients = clients.filter((c) => c.status === 'active');
  const filteredClients = activeClients.filter((c) => {
    if (!clientSearch.trim()) return true;
    const q = clientSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(q);
  });

  // Rule-Based Threshold Start Limit & Withdrawable Metrics
  const totalBalancePaise = selectedClient?.totalBalancePaise || 0;
  const principalPaise = selectedClient?.totalDepositPrincipalPaise || 0;
  const thresholdStartLimitPaise =
    selectedClient?.bonusThresholdLimitPaise ?? 1500000; // Default ₹15,000
  const clientBonusPct = selectedClient?.bonusPercentage ?? 10.0;

  // Active bonus attached to client's account
  const activeBonusPaise =
    selectedClient && principalPaise > 0
      ? Math.max(0, totalBalancePaise - principalPaise)
      : Math.round(
          (totalBalancePaise * clientBonusPct) / (100 + clientBonusPct)
        );

  const numericAmount = parseFloat(amountText.replace(/,/g, '')) || 0;
  const requestedPaise = numericAmount > 0 ? rupeesToPaise(numericAmount) : 0;

  // Threshold rule:
  // If requested withdrawal >= threshold start limit:
  //   bonus cannot be withdrawn, so net payout = requested - bonus
  // If requested withdrawal < threshold start limit:
  //   no threshold applies, so net payout = requested
  const isThresholdApplied =
    requestedPaise >= thresholdStartLimitPaise && activeBonusPaise > 0;
  const bonusExcludedPaise = isThresholdApplied
    ? Math.min(activeBonusPaise, requestedPaise)
    : 0;
  const netPayoutPaise = Math.max(0, requestedPaise - bonusExcludedPaise);

  const handleProcessWithdrawal = async () => {
    if (!selectedClient) {
      Alert.alert('Select Client', 'Please choose a client account first.');
      return;
    }

    if (requestedPaise <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid withdrawal amount.');
      return;
    }

    if (requestedPaise > totalBalancePaise) {
      Alert.alert(
        'Insufficient Balance',
        `Client balance is ${formatPaiseToINR(
          totalBalancePaise
        )}. Requested withdrawal exceeds total available balance.`
      );
      return;
    }

    if (payoutMethod === 'upi' && !upiId.trim()) {
      Alert.alert(
        'UPI ID Required',
        'Please enter the client UPI ID or switch to Direct Payout.'
      );
      return;
    }

    if (payoutMethod === 'bank' && (!accountNumber.trim() || !ifsc.trim())) {
      Alert.alert(
        'Bank Details Required',
        'Please provide both Account Number and IFSC code.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await adminApi.createClientWithdrawal(selectedClient.id, {
        amountPaise: requestedPaise,
        paymentMethod:
          payoutMethod === 'upi'
            ? `UPI: ${upiId.trim()}`
            : payoutMethod === 'bank'
            ? `Bank: ${bankName.trim() || 'IMPS'}`
            : 'Direct Cash / Settlement',
        upiId: payoutMethod === 'upi' ? upiId.trim() : undefined,
        bankDetails:
          payoutMethod === 'bank'
            ? {
                bankName: bankName.trim() || 'Bank Account',
                accountNumber: accountNumber.trim(),
                ifsc: ifsc.trim().toUpperCase(),
                accountHolderName:
                  accountHolderName.trim() || selectedClient.name,
              }
            : undefined,
        notes: notes.trim() || undefined,
      });

      if (res.success) {
        await Promise.all([refreshData(), loadClients()]);
        Alert.alert(
          'Payout Processed! ✅',
          res.message ||
            `Requested ${formatPaiseToINR(
              requestedPaise
            )}. Paid out ${formatPaiseToINR(netPayoutPaise)} to ${
              selectedClient.name
            }.\n\nRemaining Balance: ${formatPaiseToINR(
              res.clientNewBalancePaise ??
                Math.max(0, totalBalancePaise - requestedPaise)
            )}`
        );
        setAmountText('');
        setNotes('');
      } else {
        Alert.alert(
          'Withdrawal Blocked',
          res.error || 'Could not process withdrawal.'
        );
      }
    } catch (e: any) {
      Alert.alert(
        'Error',
        e?.message || 'Unexpected error processing withdrawal.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canWithdraw) {
    return (
      <ScreenContainer backgroundColor={colors.background}>
        <Header title="Client Withdrawal" showBack onBackPress={() => navigation.goBack()} />
        <View style={styles.noPermContainer}>
          <Ionicons name="lock-closed-outline" size={48} color={colors.textLight} />
          <Text style={styles.noPermTitle}>Permission Restricted</Text>
          <Text style={styles.noPermDesc}>
            You do not have Withdrawal permission. Please contact Super Admin.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scrollable backgroundColor={colors.background}>
      <Header
        title="Client Withdrawal"
        subtitle="Rule-based instant payout (Auto-Accept)"
      />

      <View style={styles.content}>
        {/* Step 1: Select Client */}
        <View style={styles.card}>
          <Text style={styles.stepTitle}>1. Select Client for Payout</Text>
          <TouchableOpacity
            style={styles.clientSelectorBtn}
            onPress={() => setPickerVisible(true)}
            activeOpacity={0.75}
          >
            {selectedClient ? (
              <View style={styles.selectedClientRow}>
                <View style={styles.clientAvatar}>
                  <Text style={styles.clientAvatarText}>
                    {selectedClient.name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectedClientName}>{selectedClient.name}</Text>
                  <Text style={styles.selectedClientMeta}>+91 {selectedClient.phone}</Text>
                  <Text style={styles.selectedClientBal}>
                    Balance: {formatPaiseToINR(totalBalancePaise)} • Threshold: {formatPaiseToINR(thresholdStartLimitPaise)}
                  </Text>
                </View>
                <View style={styles.changePill}>
                  <Text style={styles.changePillText}>Change</Text>
                </View>
              </View>
            ) : (
              <View style={styles.placeholderRow}>
                <Ionicons name="person-outline" size={20} color={colors.primary} />
                <Text style={styles.placeholderText}>Tap to choose a client...</Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Step 2: Real-Time Threshold Rule & Payout Calculation */}
        {selectedClient && (
          <View style={styles.card}>
            <Text style={styles.stepTitle}>2. Threshold Rule & Payout Calculation</Text>

            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Total Wallet Balance</Text>
              <Text style={styles.metricVal}>{formatPaiseToINR(totalBalancePaise)}</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Threshold Start Limit</Text>
              <Text style={styles.metricVal}>{formatPaiseToINR(thresholdStartLimitPaise)}</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Active Bonus in Wallet</Text>
              <Text style={[styles.metricVal, { color: '#B45309' }]}>
                {formatPaiseToINR(activeBonusPaise)}
              </Text>
            </View>

            {requestedPaise > 0 && (
              <View
                style={[
                  styles.ruleStatusBox,
                  isThresholdApplied ? styles.ruleBoxTriggered : styles.ruleBoxNormal,
                ]}
              >
                <View style={styles.ruleStatusHeader}>
                  <Ionicons
                    name={isThresholdApplied ? 'shield' : 'checkmark-circle'}
                    size={18}
                    color={isThresholdApplied ? '#B45309' : '#15803D'}
                  />
                  <Text
                    style={[
                      styles.ruleStatusTitle,
                      isThresholdApplied
                        ? styles.ruleTitleTriggered
                        : styles.ruleTitleNormal,
                    ]}
                  >
                    {isThresholdApplied
                      ? `Threshold Start Limit Applied (>= ${formatPaiseToINR(
                          thresholdStartLimitPaise
                        )})`
                      : `Below Threshold Limit (< ${formatPaiseToINR(
                          thresholdStartLimitPaise
                        )})`}
                  </Text>
                </View>

                <Text style={styles.ruleStatusDesc}>
                  {isThresholdApplied
                    ? `Because withdrawal reaches/exceeds ${formatPaiseToINR(
                        thresholdStartLimitPaise
                      )}, the ${formatPaiseToINR(
                        bonusExcludedPaise
                      )} bonus is excluded and cannot be cashed out.`
                    : `No threshold applied. Full amount of ${formatPaiseToINR(
                        requestedPaise
                      )} is eligible for cash withdrawal.`}
                </Text>

                <View style={styles.calcDivider} />

                <View style={styles.calcRow}>
                  <Text style={styles.calcLabel}>Requested Debit Amount:</Text>
                  <Text style={styles.calcVal}>{formatPaiseToINR(requestedPaise)}</Text>
                </View>
                {isThresholdApplied && (
                  <View style={styles.calcRow}>
                    <Text style={[styles.calcLabel, { color: '#B45309' }]}>
                      Bonus Excluded (Cannot Withdraw):
                    </Text>
                    <Text style={[styles.calcVal, { color: '#B45309' }]}>
                      -{formatPaiseToINR(bonusExcludedPaise)}
                    </Text>
                  </View>
                )}
                <View style={[styles.calcRow, styles.calcRowTotal]}>
                  <Text style={styles.calcTotalLabel}>Net Cash Payout to Client:</Text>
                  <Text style={styles.calcTotalVal}>
                    {formatPaiseToINR(netPayoutPaise)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Step 3: Payout Amount & Channel */}
        <View style={styles.card}>
          <View style={styles.amountHeaderRow}>
            <Text style={styles.stepTitle}>3. Enter Payout Details</Text>
            {selectedClient && totalBalancePaise > 0 && (
              <TouchableOpacity
                style={styles.maxChip}
                onPress={() => setAmountText((totalBalancePaise / 100).toString())}
              >
                <Text style={styles.maxChipText}>
                  Max: {formatPaiseToINR(totalBalancePaise)}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <CustomInput
            label="Withdrawal Amount (₹)"
            placeholder="e.g. 1000"
            keyboardType="decimal-pad"
            leftIcon="cash-outline"
            value={amountText}
            onChangeText={setAmountText}
          />

          {/* Payout Method Tabs */}
          <Text style={styles.subLabel}>Payout Method</Text>
          <View style={styles.methodRow}>
            {(
              [
                { key: 'upi', label: 'UPI', icon: 'flash-outline' },
                { key: 'bank', label: 'Bank', icon: 'business-outline' },
                { key: 'direct', label: 'Cash/Direct', icon: 'wallet-outline' },
              ] as const
            ).map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[styles.methodChip, payoutMethod === m.key && styles.methodChipActive]}
                onPress={() => setPayoutMethod(m.key)}
              >
                <Ionicons
                  name={m.icon}
                  size={15}
                  color={payoutMethod === m.key ? colors.white : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.methodChipText,
                    payoutMethod === m.key && styles.methodChipTextActive,
                  ]}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {payoutMethod === 'upi' && (
            <CustomInput
              label="Client UPI ID"
              placeholder="e.g. client@okaxis"
              leftIcon="qr-code-outline"
              autoCapitalize="none"
              value={upiId}
              onChangeText={setUpiId}
            />
          )}

          {payoutMethod === 'bank' && (
            <>
              <CustomInput
                label="Bank Name"
                placeholder="e.g. HDFC Bank"
                leftIcon="business-outline"
                value={bankName}
                onChangeText={setBankName}
              />
              <CustomInput
                label="Account Number"
                placeholder="Enter account number"
                keyboardType="number-pad"
                leftIcon="card-outline"
                value={accountNumber}
                onChangeText={setAccountNumber}
              />
              <CustomInput
                label="IFSC Code"
                placeholder="e.g. HDFC0000060"
                autoCapitalize="characters"
                leftIcon="key-outline"
                value={ifsc}
                onChangeText={setIfsc}
              />
              <CustomInput
                label="Account Holder Name"
                placeholder="Account holder name"
                leftIcon="person-outline"
                value={accountHolderName}
                onChangeText={setAccountHolderName}
              />
            </>
          )}

          <CustomInput
            label="Payout Remarks (Optional)"
            placeholder="Optional settlement reference / note"
            leftIcon="document-text-outline"
            value={notes}
            onChangeText={setNotes}
          />

          <PrimaryButton
            title={
              isSubmitting
                ? 'Processing Payout...'
                : requestedPaise > 0
                ? `Pay Out ${formatPaiseToINR(netPayoutPaise)} Net Cash`
                : 'Process Instant Payout'
            }
            onPress={handleProcessWithdrawal}
            loading={isSubmitting}
            disabled={isSubmitting || !selectedClient}
            fullWidth
            size="lg"
            icon="arrow-up-circle-outline"
            style={{ marginTop: 10 }}
          />
        </View>
      </View>

      {/* Client Picker Modal */}
      <Modal
        visible={pickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Client Account</Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalSearchBar}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search client by name or phone..."
                placeholderTextColor={colors.textLight}
                value={clientSearch}
                onChangeText={setClientSearch}
              />
            </View>

            <FlatList
              data={filteredClients}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingBottom: 24 }}
              ListEmptyComponent={
                <View style={styles.emptyListBox}>
                  <Text style={styles.emptyListText}>No active clients found.</Text>
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.clientOptionRow,
                    selectedClient?.id === item.id && styles.clientOptionSelected,
                  ]}
                  onPress={() => handleSelectClient(item)}
                >
                  <View style={styles.clientAvatarSmall}>
                    <Text style={styles.clientAvatarSmallText}>
                      {item.name.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionName}>{item.name}</Text>
                    <Text style={styles.optionSub}>+91 {item.phone}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.optionBalance}>
                      {formatPaiseToINR(item.totalBalancePaise || 0)}
                    </Text>
                    <Text style={styles.optionBalLabel}>
                      Cash: {formatPaiseToINR(item.withdrawablePaise ?? item.totalBalancePaise ?? 0)}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  clientSelectorBtn: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  selectedClientRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clientAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  clientAvatarText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.primary,
  },
  selectedClientName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  selectedClientMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  selectedClientBal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
    marginTop: 2,
  },
  changePill: {
    backgroundColor: colors.lightBlue,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  changePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  placeholderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  placeholderText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
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
  highlightMetricRow: {
    borderBottomWidth: 0,
    marginTop: 4,
    paddingVertical: 10,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  highlightLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  highlightVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#15803D',
  },
  thresholdWarningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 12,
    marginTop: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  thresholdWarningText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '600',
    flex: 1,
    lineHeight: 17,
  },
  amountHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  maxChip: {
    backgroundColor: colors.lightBlue,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  maxChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 4,
  },
  methodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  methodChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 5,
  },
  methodChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  methodChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  methodChipTextActive: {
    color: colors.white,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  modalSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 8,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  clientOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    borderRadius: 10,
  },
  clientOptionSelected: {
    backgroundColor: colors.lightBlue,
  },
  clientAvatarSmall: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  clientAvatarSmallText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  optionName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  optionSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  optionBalance: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  optionBalLabel: {
    fontSize: 10,
    color: '#15803D',
    fontWeight: '600',
  },
  emptyListBox: {
    padding: 28,
    alignItems: 'center',
  },
  emptyListText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  noPermContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  noPermTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginTop: 12,
  },
  noPermDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },
  ruleStatusBox: {
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1.5,
  },
  ruleBoxTriggered: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  ruleBoxNormal: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  ruleStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  ruleStatusTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  ruleTitleTriggered: {
    color: '#B45309',
  },
  ruleTitleNormal: {
    color: '#15803D',
  },
  ruleStatusDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  calcDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 10,
  },
  calcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  calcLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  calcVal: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  calcRowTotal: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  calcTotalLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  calcTotalVal: {
    fontSize: 15,
    fontWeight: '900',
    color: '#15803D',
  },
});

export default ClientWithdrawScreen;
