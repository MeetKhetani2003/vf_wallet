import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { Header } from '../../components/common/Header';
import { AmountInput } from '../../components/inputs/AmountInput';
import { CustomInput } from '../../components/inputs/CustomInput';
import { PrimaryButton } from '../../components/buttons/PrimaryButton';
import { ConfirmationModal } from '../../components/modals/ConfirmationModal';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';
import {
  rupeesToPaise,
  paiseToRupees,
  formatPaiseToINR,
} from '../../utils/currency';
import { validateWithdrawal } from '../../utils/calculations';
import { User } from '../../types';

export const WithdrawScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { user } = useAuth();
  const { userWallet, createWithdrawal, refreshData } = useWallet();

  const currentUser = user && user.role === 'user' ? (user as User) : null;

  useFocusEffect(
    useCallback(() => {
      refreshData();
    }, [refreshData])
  );

  const [payoutMethod, setPayoutMethod] = useState<'upi' | 'bank'>('upi');
  const [amountStr, setAmountStr] = useState('2000');
  const [upiId, setUpiId] = useState(currentUser?.upiId || '');
  const [accountNumber, setAccountNumber] = useState(
    currentUser?.bankAccount?.accountNumber || ''
  );
  const [ifsc, setIfsc] = useState(currentUser?.bankAccount?.ifsc || '');
  const [bankName, setBankName] = useState(currentUser?.bankAccount?.bankName || '');
  const [accountHolderName, setAccountHolderName] = useState(
    currentUser?.bankAccount?.accountHolderName || user?.name || ''
  );

  React.useEffect(() => {
    if (currentUser?.upiId && !upiId) {
      setUpiId(currentUser.upiId);
    }
    if ((currentUser?.name || user?.name) && !accountHolderName) {
      setAccountHolderName(currentUser?.name || user?.name || '');
    }
  }, [currentUser, user]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [createdTxnId, setCreatedTxnId] = useState('');

  // Balance and Rule-Based Threshold Calculations
  const totalBalancePaise = userWallet ? userWallet.availableBalancePaise : 0;
  const totalDepositPaise = userWallet ? userWallet.totalDepositPaise : 0;
  const totalBonusPaise = userWallet ? userWallet.totalBonusPaise : 0;
  const alreadyWithdrawnPaise = userWallet
    ? userWallet.totalWithdrawalPaise
    : 0;

  const thresholdLimitPaise =
    userWallet?.bonusThresholdLimitPaise ??
    currentUser?.bonusThresholdLimitPaise ??
    1000000; // default ₹10,000

  const isThresholdReached =
    userWallet?.isThresholdReached ??
    totalBalancePaise >= thresholdLimitPaise;

  // Real Money withdrawable under platform rules:
  // If points >= threshold, withdrawable = min(totalBalance, depositedPrincipal).
  // Otherwise, full balance is eligible.
  const eligibleWithdrawablePaise =
    userWallet?.withdrawablePaise !== undefined
      ? userWallet.withdrawablePaise
      : isThresholdReached
      ? Math.min(totalBalancePaise, totalDepositPaise)
      : totalBalancePaise;

  const maxWithdrawableRupees = paiseToRupees(eligibleWithdrawablePaise);

  const quickPercentages = [
    { label: '25%', percentage: 25 },
    { label: '50%', percentage: 50 },
    { label: '75%', percentage: 75 },
    { label: '100% (Max)', percentage: 100 },
  ];

  const handleSubmit = async () => {
    setError('');
    const requestedPaise = rupeesToPaise(amountStr || '0');

    if (requestedPaise <= 0) {
      setError('Please enter a valid withdrawal amount.');
      return;
    }

    if (requestedPaise > totalBalancePaise) {
      setError(
        `Insufficient points. Your current wallet balance is ${formatPaiseToINR(
          totalBalancePaise
        )}.`
      );
      return;
    }

    if (requestedPaise > eligibleWithdrawablePaise) {
      if (isThresholdReached) {
        setError(
          `Requested payout of ${formatPaiseToINR(
            requestedPaise
          )} exceeds eligible withdrawable real cash (${formatPaiseToINR(
            eligibleWithdrawablePaise
          )}). As your points have reached or exceeded your threshold limit of ${formatPaiseToINR(
            thresholdLimitPaise
          )}, bonus points cannot be withdrawn.`
        );
      } else {
        setError(
          `Requested amount exceeds eligible withdrawable cash of ${formatPaiseToINR(
            eligibleWithdrawablePaise
          )}.`
        );
      }
      return;
    }

    // Central validation
    const validation = validateWithdrawal(eligibleWithdrawablePaise, requestedPaise);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid withdrawal amount.');
      return;
    }

    if (payoutMethod === 'upi') {
      if (!upiId.trim()) {
        setError('Please enter a valid UPI ID for withdrawal.');
        return;
      }
    } else {
      if (!accountNumber.trim()) {
        setError('Please enter your Bank Account Number.');
        return;
      }
      if (!ifsc.trim()) {
        setError('Please enter your Bank IFSC Code.');
        return;
      }
      if (!accountHolderName.trim()) {
        setError('Please enter the Account Holder Name.');
        return;
      }
    }

    setLoading(true);
    const res = await createWithdrawal({
      amountPaise: requestedPaise,
      paymentMethod:
        payoutMethod === 'upi' ? `UPI (${upiId})` : `Bank (${bankName || 'IMPS'})`,
      upiId: payoutMethod === 'upi' ? upiId.trim() : undefined,
      bankDetails:
        payoutMethod === 'bank'
          ? {
              accountNumber: accountNumber.trim(),
              ifsc: ifsc.trim().toUpperCase(),
              bankName: bankName.trim() || 'Bank Transfer',
              accountHolderName: accountHolderName.trim(),
            }
          : undefined,
      notes: `Requested payout via ${payoutMethod.toUpperCase()}`,
    });
    setLoading(false);

    if (res.success && res.transaction) {
      setCreatedTxnId(res.transaction.id);
      setSuccessModalVisible(true);
    } else {
      setError(res.error || 'Failed to submit withdrawal request.');
    }
  };

  const handleSuccessDone = () => {
    setSuccessModalVisible(false);
    navigation.navigate('UserTabs');
  };

  return (
    <ScreenContainer scrollable backgroundColor={colors.background}>
      <Header
        title="Withdraw Funds"
        subtitle="Transfer funds to your verified account"
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <View style={styles.content}>
        {/* Real-Time Balance & Withdrawable Breakdown Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeaderRow}>
            <View style={styles.breakdownBox}>
              <Text style={styles.availableLabel}>Total Wallet Points</Text>
              <Text style={styles.availableValue}>
                {formatPaiseToINR(totalBalancePaise)}
              </Text>
            </View>
            <View style={styles.verticalDivider} />
            <View style={styles.breakdownBox}>
              <Text style={[styles.availableLabel, styles.withdrawableLabel]}>
                Eligible Real Money
              </Text>
              <Text style={[styles.availableValue, styles.withdrawableValue]}>
                {formatPaiseToINR(eligibleWithdrawablePaise)}
              </Text>
            </View>
          </View>

          <View style={styles.summaryDivider} />

          <View style={styles.summaryGrid}>
            <View style={styles.gridCol}>
              <Text style={styles.gridLabel}>Deposited Principal</Text>
              <Text style={styles.gridValue}>
                {formatPaiseToINR(totalDepositPaise)}
              </Text>
            </View>
            <View style={styles.gridCol}>
              <Text style={styles.gridLabel}>Total Bonus</Text>
              <Text style={[styles.gridValue, styles.bonusColor]}>
                {formatPaiseToINR(totalBonusPaise)}
              </Text>
            </View>
            <View style={styles.gridCol}>
              <Text style={styles.gridLabel}>Threshold Limit</Text>
              <Text style={styles.gridValue}>
                {formatPaiseToINR(thresholdLimitPaise)}
              </Text>
            </View>
          </View>
        </View>

        {/* Threshold Warning Notice if total points reach or exceed the assigned user limit */}
        {isThresholdReached ? (
          <View style={styles.thresholdWarningCard}>
            <View style={styles.thresholdWarningHeader}>
              <Ionicons name="warning" size={20} color="#D97706" />
              <Text style={styles.thresholdWarningTitle}>
                Threshold Rule Active ({formatPaiseToINR(thresholdLimitPaise)})
              </Text>
            </View>
            <Text style={styles.thresholdWarningDesc}>
              Your total wallet balance points ({formatPaiseToINR(totalBalancePaise)}) have reached or exceeded your assigned limit of {formatPaiseToINR(thresholdLimitPaise)}. In accordance with platform policy, bonus points beyond this limit cannot be cashed out as real money. You can withdraw up to your deposited principal of {formatPaiseToINR(eligibleWithdrawablePaise)}.
            </Text>
          </View>
        ) : (
          <View style={styles.thresholdNoticeCard}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
            <Text style={styles.thresholdNoticeText}>
              Threshold Limit: {formatPaiseToINR(thresholdLimitPaise)}. Full available points are eligible for payout.
            </Text>
          </View>
        )}

        {/* Withdrawal Amount Input */}
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Withdrawal Amount</Text>
          <AmountInput
            value={amountStr}
            onChangeValue={(val) => {
              setAmountStr(val);
              if (error) setError('');
            }}
            quickPercentages={quickPercentages}
            maxAvailableRupees={maxWithdrawableRupees}
            placeholder="0"
            error={error}
          />
        </View>

        {/* Payout Destination */}
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Payout Method</Text>

          {/* Toggle Tab */}
          <View style={styles.tabToggleRow}>
            <TouchableOpacity
              style={[styles.tabBtn, payoutMethod === 'upi' && styles.tabBtnActive]}
              onPress={() => setPayoutMethod('upi')}
            >
              <Ionicons
                name="phone-portrait-outline"
                size={16}
                color={payoutMethod === 'upi' ? colors.white : colors.textSecondary}
              />
              <Text
                style={[
                  styles.tabBtnText,
                  payoutMethod === 'upi' && styles.tabBtnTextActive,
                ]}
              >
                Instant UPI
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabBtn,
                payoutMethod === 'bank' && styles.tabBtnActive,
              ]}
              onPress={() => setPayoutMethod('bank')}
            >
              <Ionicons
                name="business-outline"
                size={16}
                color={
                  payoutMethod === 'bank' ? colors.white : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.tabBtnText,
                  payoutMethod === 'bank' && styles.tabBtnTextActive,
                ]}
              >
                Bank Transfer (IMPS)
              </Text>
            </TouchableOpacity>
          </View>

          {payoutMethod === 'upi' ? (
            <View style={styles.payoutInputsContainer}>
              <CustomInput
                label="UPI ID / VPA"
                placeholder="e.g. aditya@okaxis"
                value={upiId}
                onChangeText={(text) => setUpiId(text)}
                leftIcon="card-outline"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />
              <CustomInput
                label="Beneficiary Full Name"
                placeholder="Name as registered with UPI"
                value={accountHolderName}
                onChangeText={(text) => setAccountHolderName(text)}
                leftIcon="person-outline"
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>
          ) : (
            <View style={styles.payoutInputsContainer}>
              <CustomInput
                label="Account Holder Name"
                placeholder="e.g. Aditya Sharma"
                value={accountHolderName}
                onChangeText={(text) => setAccountHolderName(text)}
                leftIcon="person-outline"
              />
              <CustomInput
                label="Bank Account Number"
                placeholder="e.g. 50100482910234"
                value={accountNumber}
                onChangeText={(text) => setAccountNumber(text)}
                leftIcon="wallet-outline"
                keyboardType="numeric"
              />
              <CustomInput
                label="IFSC Code"
                placeholder="e.g. HDFC0000060"
                value={ifsc}
                onChangeText={(text) => setIfsc(text.toUpperCase())}
                leftIcon="barcode-outline"
                autoCapitalize="characters"
              />
              <CustomInput
                label="Bank Name (Optional)"
                placeholder="e.g. HDFC Bank"
                value={bankName}
                onChangeText={(text) => setBankName(text)}
                leftIcon="business-outline"
              />
            </View>
          )}

          <View style={styles.securityNote}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.success} />
            <Text style={styles.securityNoteText}>
              Funds are transferred strictly after Admin approval. No balance is
              deducted until approval is confirmed.
            </Text>
          </View>
        </View>

        {/* Submit Button */}
        <PrimaryButton
          title="Submit Withdrawal Request"
          onPress={handleSubmit}
          loading={loading}
          fullWidth
          size="lg"
          style={styles.submitBtn}
        />
      </View>

      {/* Confirmation Modal */}
      <ConfirmationModal
        visible={successModalVisible}
        title="Withdrawal Request Placed!"
        message={`Your request to withdraw ${formatPaiseToINR(
          rupeesToPaise(amountStr)
        )} has been submitted.\n\nTransaction ID: ${createdTxnId}\nStatus: PENDING ADMIN APPROVAL\n\nYour balance will be deducted once verified and processed by finance.`}
        confirmLabel="Go to Dashboard"
        variant="success"
        icon="checkmark-circle"
        onConfirm={handleSuccessDone}
        onCancel={handleSuccessDone}
      />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  summaryCard: {
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
  summaryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 4,
  },
  breakdownBox: {
    flex: 1,
    alignItems: 'center',
  },
  verticalDivider: {
    width: 1,
    height: 38,
    backgroundColor: colors.divider,
  },
  withdrawableLabel: {
    color: '#059669',
  },
  withdrawableValue: {
    color: '#059669',
  },
  thresholdWarningCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  thresholdWarningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  thresholdWarningTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
  },
  thresholdWarningDesc: {
    fontSize: 12,
    color: '#92400E',
    lineHeight: 18,
  },
  thresholdNoticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceAlt,
    padding: 10,
    borderRadius: 10,
    marginBottom: 16,
  },
  thresholdNoticeText: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  availableBox: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  availableLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  availableValue: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.primary,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 14,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gridCol: {
    flex: 1,
    alignItems: 'center',
  },
  gridLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 3,
  },
  gridValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  bonusColor: {
    color: colors.warningDark,
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
  cardHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  tabToggleRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabBtnTextActive: {
    color: colors.white,
    fontWeight: '700',
  },
  payoutInputsContainer: {
    marginTop: 4,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.successLight,
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  securityNoteText: {
    fontSize: 11,
    color: colors.successDark,
    marginLeft: 6,
    flex: 1,
    lineHeight: 16,
  },
  submitBtn: {
    marginTop: 8,
    marginBottom: 20,
  },
});

export default WithdrawScreen;
