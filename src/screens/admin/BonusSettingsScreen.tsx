import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { Header } from '../../components/common/Header';
import { PrimaryButton } from '../../components/buttons/PrimaryButton';
import { SecondaryButton } from '../../components/buttons/SecondaryButton';
import { adminApi } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';
import { formatPaiseToINR, rupeesToPaise } from '../../utils/currency';
import { calculateDepositPreview } from '../../utils/calculations';

export const BonusSettingsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { isSuperAdmin, permissions } = useAuth();
  const { updateBonusConfig } = useWallet();

  const canEditBonus = isSuperAdmin || permissions.canSetBonus;
  const canEditThreshold = isSuperAdmin || permissions.canSetThreshold;

  // Bonus State
  const [isBonusActive, setIsBonusActive] = useState(true);
  const [percentageStr, setPercentageStr] = useState('10');

  // Threshold State
  const [isThresholdActive, setIsThresholdActive] = useState(true);
  const [thresholdLimitStr, setThresholdLimitStr] = useState('15000');

  // Metadata
  const [todayDate, setTodayDate] = useState('');
  const [isSetForToday, setIsSetForToday] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Simulator State
  const [simMode, setSimMode] = useState<'WITHDRAWAL' | 'DEPOSIT'>('WITHDRAWAL');
  const [depositSimAmount, setDepositSimAmount] = useState('20000');
  const [withdrawalSimAmount, setWithdrawalSimAmount] = useState('15000');

  // Fetch running daily rates and threshold from backend
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
          if (res.thresholdLimitRupees !== undefined) {
            setThresholdLimitStr(String(res.thresholdLimitRupees));
          } else if (res.thresholdLimitPaise !== undefined) {
            setThresholdLimitStr(String(Math.round(res.thresholdLimitPaise / 100)));
          }
          if (res.isThresholdActive !== undefined) {
            setIsThresholdActive(Boolean(res.isThresholdActive));
          }
          if (res.date) {
            setTodayDate(res.date);
          }
          setIsSetForToday(Boolean(res.isSetForToday));
        }
      } catch (err) {
        console.warn('Could not load daily bonus and threshold config:', err);
      } finally {
        if (isMounted) setInitialLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const percentage = parseFloat(percentageStr) || 0;
  const effectivePercentage = isBonusActive ? percentage : 0;
  const thresholdLimit = parseFloat(thresholdLimitStr) || 0;

  // Deposit Preview Calculations
  const depositSimPaise = rupeesToPaise(depositSimAmount || '0');
  const depositPreview = calculateDepositPreview(depositSimPaise, effectivePercentage);

  // Withdrawal Simulation Calculations (Sample Client: ₹22,000 balance with ₹2,000 bonus)
  const sampleBalanceRupees = 22000;
  const sampleBonusRupees = 2000;
  const simWithdrawalRupees = parseFloat(withdrawalSimAmount || '0');
  const isSimThresholdApplied =
    isThresholdActive &&
    thresholdLimit > 0 &&
    simWithdrawalRupees >= thresholdLimit;
  const simBonusExcluded = isSimThresholdApplied
    ? Math.min(sampleBonusRupees, simWithdrawalRupees)
    : 0;
  const simNetCashPayout = Math.max(0, simWithdrawalRupees - simBonusExcluded);

  const handleSave = async () => {
    if (!canEditBonus && !canEditThreshold) {
      Alert.alert('Permission Denied', 'You do not have permission to modify daily rates or threshold rules.');
      return;
    }

    if (canEditBonus && (isNaN(percentage) || percentage < 0 || percentage > 100)) {
      Alert.alert('Invalid Percentage', 'Bonus percentage must be a number between 0% and 100%.');
      return;
    }

    if (canEditThreshold && (isNaN(thresholdLimit) || thresholdLimit < 0)) {
      Alert.alert('Invalid Threshold', 'Threshold limit must be a positive number in rupees.');
      return;
    }

    setLoading(true);
    try {
      const payload: any = {};
      if (canEditBonus) {
        payload.percentage = percentage;
        payload.isActive = isBonusActive;
      }
      if (canEditThreshold) {
        payload.thresholdLimit = thresholdLimit;
        payload.isThresholdActive = isThresholdActive;
      }

      const res = await adminApi.setDailyBonus(payload);
      if (res.success) {
        setIsSetForToday(true);
        if (canEditBonus) {
          await updateBonusConfig(percentage, isBonusActive);
        }
        Alert.alert(
          'Daily Rules Updated! ✅',
          `Running rules for ${todayDate || 'Today'}:\n• Bonus Rate: ${
            isBonusActive ? `${percentage}% Active` : 'Disabled (0%)'
          }\n• Threshold Limit: ${
            isThresholdActive ? `₹${thresholdLimit.toLocaleString('en-IN')}` : 'Disabled'
          }\nThese rules automatically apply to all deposits and withdrawals processed today.`
        );
      } else {
        Alert.alert('Error', res.error || 'Failed to update daily rules.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error while updating rules.');
    } finally {
      setLoading(false);
    }
  };

  const quickPercentages = [0, 5, 10, 15, 20];
  const quickThresholds = [10000, 15000, 20000, 25000, 50000];

  return (
    <ScreenContainer scrollable backgroundColor={colors.background}>
      <Header
        title="Daily Rates & Threshold"
        subtitle={`Day-based rules & permissions ${todayDate ? `(${todayDate})` : ''}`}
      />

      <View style={styles.content}>
        {/* Permission Badge */}
        <View style={styles.permBadgeCard}>
          <View style={styles.permBadgeRow}>
            <Ionicons
              name={isSuperAdmin ? 'shield-checkmark' : 'lock-closed'}
              size={18}
              color={isSuperAdmin ? colors.primary : '#7C3AED'}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.permBadgeTitle}>
                {isSuperAdmin
                  ? 'Super Admin Full Rule Control'
                  : 'Assigned Staff Rule Access'}
              </Text>
              <Text style={styles.permBadgeDesc}>
                {isSuperAdmin
                  ? 'You have complete authority to set running rates and grant threshold/bonus permissions to staff.'
                  : `Your active permissions: ${
                      [canEditBonus && 'Bonus Rate', canEditThreshold && 'Threshold Limit']
                        .filter(Boolean)
                        .join(' & ') || 'View Only'
                    }`}
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

        {/* 2. Daily Running Threshold Start Limit Card */}
        <View style={[styles.card, !canEditThreshold && styles.lockedCard]}>
          <View style={styles.switchRow}>
            <View style={styles.switchTextCol}>
              <View style={styles.titleWithIcon}>
                <Ionicons name="shield-half" size={18} color="#7C3AED" />
                <Text style={styles.cardHeading}>Daily Threshold Start Limit (₹)</Text>
              </View>
              <Text style={styles.switchSubtitle}>
                Withdrawals at or above this threshold limit retain promotional bonus in the client's wallet.
              </Text>
            </View>
            <Switch
              value={isThresholdActive}
              onValueChange={setIsThresholdActive}
              disabled={!canEditThreshold}
              trackColor={{ false: '#DFE1E6', true: '#C4B5FD' }}
              thumbColor={isThresholdActive ? '#7C3AED' : '#FFFFFF'}
            />
          </View>

          {!canEditThreshold && (
            <View style={styles.lockedPill}>
              <Ionicons name="lock-closed" size={13} color="#92400E" />
              <Text style={styles.lockedPillText}>
                Requires Super Admin or "Daily Threshold & Rules" permission
              </Text>
            </View>
          )}

          <View style={[styles.rateInputRow, (!isThresholdActive || !canEditThreshold) && styles.disabledInputRow]}>
            <Text style={[styles.percentSymbol, { color: '#7C3AED' }]}>₹</Text>
            <TextInput
              style={styles.rateInput}
              keyboardType="numeric"
              value={thresholdLimitStr}
              editable={isThresholdActive && canEditThreshold}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, '');
                setThresholdLimitStr(cleaned);
              }}
            />
          </View>

          {/* Quick Threshold Chips */}
          <View style={styles.chipsRow}>
            {quickThresholds.map((t) => {
              const isSelected = thresholdLimit === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.chip,
                    isSelected && { backgroundColor: '#EDE9FE', borderColor: '#7C3AED' },
                    (!isThresholdActive || !canEditThreshold) && styles.disabledChip,
                  ]}
                  disabled={!isThresholdActive || !canEditThreshold}
                  onPress={() => setThresholdLimitStr(t.toString())}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && { color: '#6D28D9', fontWeight: '700' },
                    ]}
                  >
                    ₹{(t / 1000).toFixed(0)}k
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 3. Real-Time Interactive Simulator */}
        <View style={styles.card}>
          <View style={styles.simTabRow}>
            <TouchableOpacity
              style={[styles.simTab, simMode === 'WITHDRAWAL' && styles.simTabActive]}
              onPress={() => setSimMode('WITHDRAWAL')}
            >
              <Ionicons
                name="arrow-up-circle-outline"
                size={16}
                color={simMode === 'WITHDRAWAL' ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.simTabText,
                  simMode === 'WITHDRAWAL' && styles.simTabTextActive,
                ]}
              >
                Withdrawal Rule Simulator
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

          {simMode === 'WITHDRAWAL' ? (
            <View style={{ marginTop: 14 }}>
              <View style={styles.simContextBox}>
                <Text style={styles.simContextTitle}>
                  Sample Client Balance: ₹{sampleBalanceRupees.toLocaleString('en-IN')} (Principal: ₹20,000 + Bonus: ₹2,000)
                </Text>
                <Text style={styles.simContextSub}>
                  Running Daily Threshold Limit: ₹{thresholdLimit.toLocaleString('en-IN')}
                </Text>
              </View>

              <Text style={styles.simLabel}>Test Withdrawal Amount (₹):</Text>
              <View style={styles.simInputBox}>
                <Text style={styles.simCurrency}>₹</Text>
                <TextInput
                  style={styles.simInput}
                  keyboardType="numeric"
                  value={withdrawalSimAmount}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setWithdrawalSimAmount(cleaned);
                  }}
                />
              </View>

              {/* Quick Withdrawal Test Chips */}
              <View style={[styles.chipsRow, { marginBottom: 12 }]}>
                {[10000, 15000, 20000, 22000].map((amt) => (
                  <TouchableOpacity
                    key={amt}
                    style={[
                      styles.chip,
                      simWithdrawalRupees === amt && styles.chipSelected,
                    ]}
                    onPress={() => setWithdrawalSimAmount(String(amt))}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        simWithdrawalRupees === amt && styles.chipTextSelected,
                      ]}
                    >
                      ₹{(amt / 1000).toFixed(0)}k
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Simulation Result */}
              <View
                style={[
                  styles.previewBox,
                  isSimThresholdApplied
                    ? { backgroundColor: '#FDF4FF', borderColor: '#F0ABFC' }
                    : { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
                ]}
              >
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Threshold Status</Text>
                  <View
                    style={[
                      styles.statusPill,
                      isSimThresholdApplied
                        ? { backgroundColor: '#FAE8FF' }
                        : { backgroundColor: '#DCFCE7' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        isSimThresholdApplied
                          ? { color: '#86198F' }
                          : { color: '#166534' },
                      ]}
                    >
                      {isSimThresholdApplied
                        ? `Threshold Applied (≥ ₹${thresholdLimit.toLocaleString('en-IN')})`
                        : `Below Threshold (< ₹${thresholdLimit.toLocaleString('en-IN')})`}
                    </Text>
                  </View>
                </View>

                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Requested Withdrawal</Text>
                  <Text style={styles.previewVal}>
                    ₹{simWithdrawalRupees.toLocaleString('en-IN')}
                  </Text>
                </View>

                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>
                    Promotional Bonus Retained in Wallet
                  </Text>
                  <Text
                    style={[
                      styles.previewVal,
                      isSimThresholdApplied
                        ? { color: '#86198F', fontWeight: '800' }
                        : { color: '#166534' },
                    ]}
                  >
                    {isSimThresholdApplied
                      ? `-₹${simBonusExcluded.toLocaleString('en-IN')} (Bonus Excluded)`
                      : '₹0 (Full Amount Withdrawable)'}
                  </Text>
                </View>

                <View style={styles.previewDivider} />

                <View style={styles.previewRow}>
                  <Text style={styles.previewTotalLabel}>Instant Cash Payout</Text>
                  <Text
                    style={[
                      styles.previewTotalVal,
                      { color: isSimThresholdApplied ? '#7C3AED' : '#15803D' },
                    ]}
                  >
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
                  value={depositSimAmount}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setDepositSimAmount(cleaned);
                  }}
                />
              </View>

              <View style={styles.previewBox}>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Principal Deposit</Text>
                  <Text style={styles.previewVal}>
                    {formatPaiseToINR(depositPreview.depositPaise)}
                  </Text>
                </View>

                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>
                    Bonus Credited ({isBonusActive ? `${depositPreview.bonusPercentage}%` : 'Disabled'})
                  </Text>
                  <Text style={[styles.previewVal, styles.bonusVal]}>
                    +{formatPaiseToINR(depositPreview.bonusPaise)}
                  </Text>
                </View>

                <View style={styles.previewDivider} />

                <View style={styles.previewRow}>
                  <Text style={styles.previewTotalLabel}>Total Wallet Credit</Text>
                  <Text style={styles.previewTotalVal}>
                    {formatPaiseToINR(depositPreview.totalCreditPaise)}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* 4. Super Admin Permission Delegation Card */}
        {isSuperAdmin && (
          <View style={styles.card}>
            <View style={styles.titleWithIcon}>
              <Ionicons name="people-circle-outline" size={20} color={colors.primary} />
              <Text style={styles.cardHeading}>Staff Permission Delegation</Text>
            </View>
            <Text style={styles.switchSubtitle}>
              You can grant either or both permissions to employees:
              {'\n'}• <Text style={{ fontWeight: '700' }}>Daily Threshold & Rules:</Text> Lets employee adjust running withdrawal thresholds.
              {'\n'}• <Text style={{ fontWeight: '700' }}>Daily Bonus Rates:</Text> Lets employee configure running daily bonus percentages.
            </Text>
            <SecondaryButton
              title="Manage Employee Permissions 🛡️"
              onPress={() => navigation.navigate('Users', { initialTab: 'EMPLOYEE' })}
              style={{ marginTop: 12 }}
            />
          </View>
        )}

        {/* Save Button */}
        {(canEditBonus || canEditThreshold) && (
          <PrimaryButton
            title={loading ? 'Saving Daily Rules...' : 'Save Daily Rates & Threshold'}
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
  simContextBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  simContextTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  simContextSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
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
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 11,
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
