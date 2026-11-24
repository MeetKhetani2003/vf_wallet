import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../../theme/colors';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { Header } from '../../components/common/Header';
import { PrimaryButton } from '../../components/buttons/PrimaryButton';
import { SecondaryButton } from '../../components/buttons/SecondaryButton';
import { adminApi } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';

export const BonusSettingsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { isSuperAdmin, permissions } = useAuth();
  const { updateBonusConfig } = useWallet();

  const canEditBonus = isSuperAdmin || permissions.canSetBonus;

  // Bonus State
  const [isBonusActive, setIsBonusActive] = useState(true);
  const [percentageStr, setPercentageStr] = useState('10');

  // Metadata
  const [todayDate, setTodayDate] = useState('');
  const [isSetForToday, setIsSetForToday] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Simulator State
  const [simMode, setSimMode] = useState<'CYCLE' | 'DEPOSIT'>('CYCLE');
  const [simDepositAmount, setSimDepositAmount] = useState('20000');
  const [withdrawalSimPoints, setWithdrawalSimPoints] = useState('42000');
  const [isSecondWithdrawal, setIsSecondWithdrawal] = useState(false);

  // Fetch running daily rates from backend
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await adminApi.getDailyBonus();
        if (isMounted && res.success) {
          if (res.percentage !== undefined) {
            setPercentageStr(String(res.percentage));
          }
          if (res.isActive !== undefined) {
            setIsBonusActive(Boolean(res.isActive));
          }
          if (res.date) {
            setTodayDate(res.date);
          }
          setIsSetForToday(Boolean(res.isSetForToday));
        }
      } catch (err) {
        console.warn('Could not load daily bonus config:', err);
      } finally {
        if (isMounted) setInitialLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const percentage = parseFloat(percentageStr) || 0;

  // Simulator Calculations
  const simDepositRupees = parseFloat(simDepositAmount || '0');
  const simBonusPoints = isBonusActive && percentage > 0
    ? Math.round((simDepositRupees * percentage) / 100)
    : 0;
  // Scenario: Deposit 1 (simDepositRupees) + Deposit 2 (simDepositRupees)
  // Deposit 1 = simDepositRupees + simBonusPoints
  // Deposit 2 replaces previous bonus, adding simDepositRupees + simBonusPoints - simBonusPoints = simDepositRupees
  // Total sample balance = simDepositRupees * 2 + simBonusPoints
  const sampleConsecutiveBalance = simDepositRupees * 2 + simBonusPoints;

  const simWithdrawalPointsVal = parseFloat(withdrawalSimPoints || '0');
  // If withdrawal is equal to or greater than balance, bonus is deducted from last deposit
  const isQualifyingCashout =
    !isSecondWithdrawal &&
    simBonusPoints > 0 &&
    simWithdrawalPointsVal >= sampleConsecutiveBalance;

  const simBonusDeducted = isQualifyingCashout ? simBonusPoints : 0;
  const simNetCashPayout = Math.max(0, simWithdrawalPointsVal - simBonusDeducted);

  const handleSave = async () => {
    if (!canEditBonus) {
      Alert.alert('Permission Denied', 'You do not have permission to modify daily bonus rates.');
      return;
    }

    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
      Alert.alert('Invalid Percentage', 'Bonus percentage must be a number between 0% and 100%.');
      return;
    }

    setLoading(true);
    try {
      const res = await adminApi.setDailyBonus({
        percentage,
        isActive: isBonusActive,
      });
      if (res.success) {
        setIsSetForToday(true);
        await updateBonusConfig(percentage, isBonusActive);
        Alert.alert(
          'Daily Bonus Rate Updated! ✅',
          `Running bonus for ${todayDate || 'Today'}:\n• Bonus Rate: ${
            isBonusActive ? `${percentage}% Active` : 'Disabled (0%)'
          }\nThis rate automatically applies to client deposits processed today.`
        );
      } else {
        Alert.alert('Error', res.error || 'Failed to update daily bonus.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error while updating bonus.');
    } finally {
      setLoading(false);
    }
  };

  const quickPercentages = [0, 5, 10, 15, 20];

  return (
    <ScreenContainer scrollable backgroundColor={colors.background}>
      <Header
        title="Daily Bonus Rate"
        subtitle={`Day-based promotional rates ${todayDate ? `(${todayDate})` : ''}`}
      />

      <View style={styles.content}>
        {/* Permission Badge */}
        <View style={styles.permBadgeCard}>
          <View style={styles.permBadgeRow}>
            <Ionicons
              name={isSuperAdmin ? 'shield-checkmark' : 'lock-closed'}
              size={18}
              color={isSuperAdmin ? colors.primary : '#D97706'}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.permBadgeTitle}>
                {isSuperAdmin
                  ? 'Super Admin Rule Control'
                  : 'Assigned Staff Bonus Access'}
              </Text>
              <Text style={styles.permBadgeDesc}>
                {isSuperAdmin
                  ? 'You have complete authority to set running daily bonus rates and grant permissions to staff.'
                  : `Your active permissions: ${canEditBonus ? 'Daily Bonus Rates' : 'View Only'}`}
              </Text>
            </View>
          </View>
        </View>

        {/* 1. Daily Running Bonus Card */}
        <View style={[styles.card, !canEditBonus && styles.lockedCard]}>
          <View style={styles.switchRow}>
            <View style={styles.switchTextCol}>
              <View style={styles.titleWithIcon}>
                <Ionicons name="gift" size={18} color="#D97706" />
                <Text style={styles.cardHeading}>Daily Running Bonus (%)</Text>
              </View>
              <Text style={styles.switchSubtitle}>
                Automatically applied to all client deposits made today. If disabled, 0% is given.
              </Text>
            </View>
            <Switch
              value={isBonusActive}
              onValueChange={setIsBonusActive}
              disabled={!canEditBonus}
              trackColor={{ false: '#DFE1E6', true: colors.primaryLight }}
              thumbColor={isBonusActive ? colors.primary : '#FFFFFF'}
            />
          </View>

          {!canEditBonus && (
            <View style={styles.lockedPill}>
              <Ionicons name="lock-closed" size={13} color="#92400E" />
              <Text style={styles.lockedPillText}>
                Requires Super Admin or "Daily Bonus Rates" permission
              </Text>
            </View>
          )}

          <View style={[styles.rateInputRow, (!isBonusActive || !canEditBonus) && styles.disabledInputRow]}>
            <TextInput
              style={styles.rateInput}
              keyboardType="numeric"
              value={percentageStr}
              editable={isBonusActive && canEditBonus}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9.]/g, '');
                setPercentageStr(cleaned);
              }}
            />
            <Text style={styles.percentSymbol}>%</Text>
          </View>

          {/* Quick Percentage Chips */}
          <View style={styles.chipsRow}>
            {quickPercentages.map((p) => {
              const isSelected = percentage === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.chip,
                    isSelected && styles.chipSelected,
                    (!isBonusActive || !canEditBonus) && styles.disabledChip,
                  ]}
                  disabled={!isBonusActive || !canEditBonus}
                  onPress={() => setPercentageStr(p.toString())}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                    ]}
                  >
                    {p}%
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 2. Interactive Points & Bonus Cycle Simulator */}
        <View style={styles.card}>
          <View style={styles.simTabRow}>
            <TouchableOpacity
              style={[styles.simTab, simMode === 'CYCLE' && styles.simTabActive]}
              onPress={() => setSimMode('CYCLE')}
            >
              <Ionicons
                name="repeat-outline"
                size={16}
                color={simMode === 'CYCLE' ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.simTabText,
                  simMode === 'CYCLE' && styles.simTabTextActive,
                ]}
              >
                Points & Cycle Simulation
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.simTab, simMode === 'DEPOSIT' && styles.simTabActive]}
              onPress={() => setSimMode('DEPOSIT')}
            >
              <Ionicons
                name="arrow-down-circle-outline"
                size={16}
                color={simMode === 'DEPOSIT' ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.simTabText,
                  simMode === 'DEPOSIT' && styles.simTabTextActive,
                ]}
              >
                Deposit Bonus
              </Text>
            </TouchableOpacity>
          </View>

          {simMode === 'CYCLE' ? (
            <View style={{ marginTop: 14 }}>
              <Text style={styles.cycleTitle}>Cycle Simulation (Consecutive Deposits + Payout)</Text>
              <Text style={styles.cycleSub}>
                1. Cash deposit gives Points + {percentage}% Bonus.
                {'\n'}2. Consecutive deposit replaces the previous unwithdrawn bonus.
                {'\n'}3. On full cashout, active bonus is cut once. Subsequent withdrawals in cycle get 100% full cash.
              </Text>

              {/* Sample Deposit Input */}
              <Text style={styles.simLabel}>Per-Deposit Amount (₹):</Text>
              <View style={styles.simInputBox}>
                <Text style={styles.simCurrency}>₹</Text>
                <TextInput
                  style={styles.simInput}
                  keyboardType="numeric"
                  value={simDepositAmount}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setSimDepositAmount(cleaned);
                  }}
                />
              </View>

              <View style={styles.simContextBox}>
                <View style={styles.simContextRow}>
                  <Text style={styles.simContextLabel}>1st Deposit (₹{simDepositRupees.toLocaleString('en-IN')}):</Text>
                  <Text style={styles.simContextVal}>
                    {(simDepositRupees + simBonusPoints).toLocaleString('en-IN')} Points (Bonus: +{simBonusPoints.toLocaleString('en-IN')})
                  </Text>
                </View>
                <View style={styles.simContextRow}>
                  <Text style={styles.simContextLabel}>2nd Deposit (₹{simDepositRupees.toLocaleString('en-IN')}):</Text>
                  <Text style={styles.simContextVal}>
                    +{(simDepositRupees).toLocaleString('en-IN')} Points (Prev Bonus Replaced)
                  </Text>
                </View>
                <View style={[styles.previewDivider, { marginVertical: 4 }]} />
                <View style={styles.simContextRow}>
                  <Text style={[styles.simContextLabel, { fontWeight: '700', color: colors.text }]}>
                    Total Wallet Balance:
                  </Text>
                  <Text style={[styles.simContextVal, { fontWeight: '800', color: colors.primary }]}>
                    {sampleConsecutiveBalance.toLocaleString('en-IN')} Points
                  </Text>
                </View>
                <View style={styles.simContextRow}>
                  <Text style={styles.simContextLabel}>Active Cycle Bonus:</Text>
                  <Text style={[styles.simContextVal, { color: '#D97706', fontWeight: '800' }]}>
                    {simBonusPoints.toLocaleString('en-IN')} Points
                  </Text>
                </View>
              </View>

              {/* Test Withdrawal Points Input */}
              <Text style={[styles.simLabel, { marginTop: 6 }]}>Test Points to Withdraw:</Text>
              <View style={styles.simInputBox}>
                <Ionicons name="wallet-outline" size={16} color={colors.primary} style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.simInput}
                  keyboardType="numeric"
                  value={withdrawalSimPoints}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setWithdrawalSimPoints(cleaned);
                  }}
                />
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textSecondary }}>Points</Text>
              </View>

              {/* Toggle 2nd withdrawal in cycle */}
              <TouchableOpacity
                style={styles.cycleToggleRow}
                onPress={() => setIsSecondWithdrawal(!isSecondWithdrawal)}
              >
                <Ionicons
                  name={isSecondWithdrawal ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={isSecondWithdrawal ? colors.primary : colors.textMuted}
                />
                <Text style={styles.cycleToggleText}>
                  Simulate subsequent withdrawal in same cycle (bonus already cut)
                </Text>
              </TouchableOpacity>

              {/* Payout Breakdown Box */}
              <View
                style={[
                  styles.previewBox,
                  isQualifyingCashout
                    ? { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }
                    : { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
                ]}
              >
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Debited Points</Text>
                  <Text style={styles.previewVal}>
                    {simWithdrawalPointsVal.toLocaleString('en-IN')} Points
                  </Text>
                </View>

                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Bonus Deduction</Text>
                  <Text
                    style={[
                      styles.previewVal,
                      isQualifyingCashout ? { color: '#DC2626', fontWeight: '700' } : { color: '#166534' },
                    ]}
                  >
                    {isQualifyingCashout
                      ? `-${simBonusDeducted.toLocaleString('en-IN')} Points (${percentage}% Cycle Bonus Cut)`
                      : '0 Points (100% Full Cashout)'}
                  </Text>
                </View>

                <View style={styles.previewDivider} />

                <View style={styles.previewRow}>
                  <Text style={styles.previewTotalLabel}>Cash Payout to Client</Text>
                  <Text style={[styles.previewTotalVal, { color: '#15803D' }]}>
                    ₹{simNetCashPayout.toLocaleString('en-IN')}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={{ marginTop: 14 }}>
              <Text style={styles.simLabel}>Sample Deposit Amount (₹):</Text>
              <View style={styles.simInputBox}>
                <Text style={styles.simCurrency}>₹</Text>
                <TextInput
                  style={styles.simInput}
                  keyboardType="numeric"
                  value={simDepositAmount}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setSimDepositAmount(cleaned);
                  }}
                />
              </View>

              <View style={styles.previewBox}>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Principal Cash Deposit</Text>
                  <Text style={styles.previewVal}>
                    ₹{simDepositRupees.toLocaleString('en-IN')}
                  </Text>
                </View>

                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>
                    Bonus Credited ({isBonusActive ? `${percentage}%` : 'Disabled'})
                  </Text>
                  <Text style={[styles.previewVal, styles.bonusVal]}>
                    +{simBonusPoints.toLocaleString('en-IN')} Points
                  </Text>
                </View>

                <View style={styles.previewDivider} />

                <View style={styles.previewRow}>
                  <Text style={styles.previewTotalLabel}>Total Points Credited</Text>
                  <Text style={styles.previewTotalVal}>
                    {(simDepositRupees + simBonusPoints).toLocaleString('en-IN')} Points
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* 3. Super Admin Staff Delegation */}
        {isSuperAdmin && (
          <View style={styles.card}>
            <View style={styles.titleWithIcon}>
              <Ionicons name="people-circle-outline" size={20} color={colors.primary} />
              <Text style={styles.cardHeading}>Staff Permission Delegation</Text>
            </View>
            <Text style={styles.switchSubtitle}>
              You can grant employees permission to set daily running bonus rates:
              {'\n'}• <Text style={{ fontWeight: '700' }}>Daily Bonus Rates:</Text> Lets employee adjust running promotional percentage.
            </Text>
            <SecondaryButton
              title="Manage Employee Permissions 🛡️"
              onPress={() => navigation.navigate('Users', { initialTab: 'EMPLOYEE' })}
              style={{ marginTop: 12 }}
            />
          </View>
        )}

        {/* Save Button */}
        {canEditBonus && (
          <PrimaryButton
            title={loading ? 'Saving Daily Rate...' : 'Save Daily Bonus Rate'}
            onPress={handleSave}
            loading={loading}
            fullWidth
            size="lg"
            style={styles.saveBtn}
          />
        )}
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  permBadgeCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  permBadgeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  permBadgeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  permBadgeDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 15,
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
  lockedCard: {
    backgroundColor: '#FAFAFA',
    borderColor: '#E2E8F0',
  },
  titleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  cardHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  switchSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  lockedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 10,
    gap: 6,
  },
  lockedPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#92400E',
    flex: 1,
  },
  rateInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    paddingHorizontal: 16,
    height: 54,
    marginTop: 12,
  },
  disabledInputRow: {
    opacity: 0.5,
    backgroundColor: '#F1F5F9',
  },
  rateInput: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    flex: 1,
    padding: 0,
  },
  percentSymbol: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.primary,
    marginLeft: 6,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipSelected: {
    backgroundColor: colors.lightBlue,
    borderColor: colors.primary,
  },
  disabledChip: {
    opacity: 0.5,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  simTabRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: 4,
    gap: 6,
  },
  simTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  simTabActive: {
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  simTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  simTabTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  cycleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  cycleSub: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
    marginBottom: 10,
  },
  simContextBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  simContextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  simContextLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  simContextVal: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '700',
  },
  simLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  simInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  simCurrency: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    marginRight: 6,
  },
  simInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    padding: 0,
  },
  cycleToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 8,
  },
  cycleToggleText: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  previewBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 3,
  },
  previewLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  previewVal: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  bonusVal: {
    color: colors.warningDark,
    fontWeight: '700',
  },
  previewDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 6,
  },
  previewTotalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  previewTotalVal: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.primary,
  },
  saveBtn: {
    marginTop: 4,
    marginBottom: 20,
  },
});

export default BonusSettingsScreen;
