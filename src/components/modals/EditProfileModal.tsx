import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { CustomInput } from '../inputs/CustomInput';
import { PrimaryButton } from '../buttons/PrimaryButton';
import { SecondaryButton } from '../buttons/SecondaryButton';
import { AuthUser, User, BankAccount } from '../../types';

interface EditProfileModalProps {
  visible: boolean;
  user: AuthUser | null;
  initialTab?: 'personal' | 'payment';
  onClose: () => void;
  onSave: (data: {
    name?: string;
    email?: string;
    phone?: string;
    upiId?: string;
    bankAccount?: BankAccount | null;
  }) => Promise<{ success: boolean; error?: string }>;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  visible,
  user,
  initialTab = 'personal',
  onClose,
  onSave,
}) => {
  const isUserRole = user?.role === 'user';
  const currentUser = isUserRole ? (user as User) : null;

  const [activeTab, setActiveTab] = useState<'personal' | 'payment'>(initialTab);

  // Personal Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Payment Fields
  const [upiId, setUpiId] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Reset fields whenever modal opens or user changes
  useEffect(() => {
    if (visible && user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      setActiveTab(initialTab);
      setErrorMessage('');

      if (currentUser) {
        setUpiId(currentUser.upiId || '');
        setBankName(currentUser.bankAccount?.bankName || '');
        setAccountNumber(currentUser.bankAccount?.accountNumber || '');
        setIfsc(currentUser.bankAccount?.ifsc || '');
        setAccountHolderName(
          currentUser.bankAccount?.accountHolderName || user.name || ''
        );
      }
    }
  }, [visible, user, initialTab]);

  const handleSave = async () => {
    setErrorMessage('');

    // Validations
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage('Full name is required.');
      setActiveTab('personal');
      return;
    }

    const trimmedPhone = phone.trim();
    if (!trimmedPhone || trimmedPhone.length < 10) {
      setErrorMessage('Please enter a valid 10-digit mobile number.');
      setActiveTab('personal');
      return;
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail && !trimmedEmail.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      setActiveTab('personal');
      return;
    }

    const trimmedUpi = upiId.trim();
    if (trimmedUpi && !trimmedUpi.includes('@')) {
      setErrorMessage('UPI ID must include an "@" handle (e.g. user@okaxis).');
      setActiveTab('payment');
      return;
    }

    // Construct Bank Account payload
    let bankPayload: BankAccount | null = null;
    if (
      bankName.trim() ||
      accountNumber.trim() ||
      ifsc.trim() ||
      accountHolderName.trim()
    ) {
      if (!accountNumber.trim() || !ifsc.trim()) {
        setErrorMessage(
          'Please provide both Account Number and IFSC code to link a bank account.'
        );
        setActiveTab('payment');
        return;
      }
      bankPayload = {
        bankName: bankName.trim() || 'Bank Account',
        accountNumber: accountNumber.trim(),
        ifsc: ifsc.trim().toUpperCase(),
        accountHolderName: accountHolderName.trim() || trimmedName,
      };
    }

    setIsLoading(true);
    try {
      const res = await onSave({
        name: trimmedName,
        phone: trimmedPhone,
        email: trimmedEmail || undefined,
        upiId: trimmedUpi || undefined,
        bankAccount: isUserRole ? bankPayload : undefined,
      });

      if (res.success) {
        Alert.alert(
          'Profile Saved',
          'Your profile details have been updated successfully.'
        );
        onClose();
      } else {
        setErrorMessage(res.error || 'Failed to update profile.');
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerIconCircle}>
                <Ionicons name="create-outline" size={20} color={colors.primary} />
              </View>
              <View>
                <Text style={styles.modalTitle}>Customize Profile</Text>
                <Text style={styles.modalSubtitle}>
                  Update your contact details & payout accounts
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Segmented Tabs (if regular user) */}
          {isUserRole && (
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tabItem, activeTab === 'personal' && styles.activeTabItem]}
                onPress={() => setActiveTab('personal')}
              >
                <Ionicons
                  name="person-outline"
                  size={16}
                  color={activeTab === 'personal' ? colors.primary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.tabText,
                    activeTab === 'personal' && styles.activeTabText,
                  ]}
                >
                  Personal Info
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabItem, activeTab === 'payment' && styles.activeTabItem]}
                onPress={() => setActiveTab('payment')}
              >
                <Ionicons
                  name="card-outline"
                  size={16}
                  color={activeTab === 'payment' ? colors.primary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.tabText,
                    activeTab === 'payment' && styles.activeTabText,
                  ]}
                >
                  Payment Channels
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Error Banner */}
          {!!errorMessage && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* Scrollable Form Body */}
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {activeTab === 'personal' || !isUserRole ? (
              <View style={styles.sectionContainer}>
                <CustomInput
                  label="Full Name"
                  placeholder="Enter your full name"
                  leftIcon="person-outline"
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    setErrorMessage('');
                  }}
                  autoCapitalize="words"
                />

                <CustomInput
                  label="Phone Number"
                  placeholder="10-digit mobile number"
                  leftIcon="call-outline"
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(t);
                    setErrorMessage('');
                  }}
                  helperText="Primary contact number used for account verification"
                />

                <CustomInput
                  label="Email Address"
                  placeholder="name@example.com"
                  leftIcon="mail-outline"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setErrorMessage('');
                  }}
                  helperText="Used for notifications and transaction receipts"
                />
              </View>
            ) : (
              <View style={styles.sectionContainer}>
                {/* UPI Configuration */}
                <View style={styles.groupCard}>
                  <View style={styles.groupHeaderRow}>
                    <Ionicons name="flash" size={18} color={colors.primary} />
                    <Text style={styles.groupTitle}>Default UPI ID</Text>
                  </View>
                  <Text style={styles.groupDescription}>
                    Pre-filled automatically during withdrawal requests for instant payout.
                  </Text>
                  <CustomInput
                    placeholder="e.g. yourname@okaxis, 9876543210@paytm"
                    leftIcon="qr-code-outline"
                    value={upiId}
                    onChangeText={(t) => {
                      setUpiId(t);
                      setErrorMessage('');
                    }}
                    autoCapitalize="none"
                  />
                </View>

                {/* Bank Account Configuration */}
                <View style={styles.groupCard}>
                  <View style={styles.groupHeaderRow}>
                    <Ionicons name="business" size={18} color={colors.secondary} />
                    <Text style={styles.groupTitle}>Bank Account Details (Optional)</Text>
                  </View>
                  <Text style={styles.groupDescription}>
                    Used when requesting direct IMPS/NEFT bank payouts.
                  </Text>

                  <CustomInput
                    label="Bank Name"
                    placeholder="e.g. HDFC Bank, SBI, ICICI"
                    leftIcon="business-outline"
                    value={bankName}
                    onChangeText={(t) => {
                      setBankName(t);
                      setErrorMessage('');
                    }}
                  />

                  <CustomInput
                    label="Account Number"
                    placeholder="Enter account number"
                    leftIcon="card-outline"
                    keyboardType="number-pad"
                    value={accountNumber}
                    onChangeText={(t) => {
                      setAccountNumber(t);
                      setErrorMessage('');
                    }}
                  />

                  <CustomInput
                    label="IFSC Code"
                    placeholder="e.g. HDFC0000060"
                    leftIcon="key-outline"
                    autoCapitalize="characters"
                    maxLength={11}
                    value={ifsc}
                    onChangeText={(t) => {
                      setIfsc(t);
                      setErrorMessage('');
                    }}
                  />

                  <CustomInput
                    label="Account Holder Name"
                    placeholder="Name as per bank records"
                    leftIcon="person-circle-outline"
                    value={accountHolderName}
                    onChangeText={(t) => {
                      setAccountHolderName(t);
                      setErrorMessage('');
                    }}
                  />
                </View>
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.modalActions}>
            <SecondaryButton
              title="Cancel"
              onPress={onClose}
              style={styles.actionBtn}
              disabled={isLoading}
            />
            <PrimaryButton
              title={isLoading ? 'Saving...' : 'Save Changes'}
              onPress={handleSave}
              style={styles.actionBtn}
              disabled={isLoading}
              icon={isLoading ? undefined : 'checkmark-circle-outline'}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    minHeight: '60%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 10,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 6,
  },
  activeTabItem: {
    backgroundColor: colors.lightBlue,
    borderColor: colors.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  activeTabText: {
    color: colors.primary,
    fontWeight: '700',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    gap: 8,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '600',
    flex: 1,
  },
  formScroll: {
    flex: 1,
  },
  formScrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sectionContainer: {
    gap: 14,
  },
  groupCard: {
    backgroundColor: colors.surfaceAlt,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 8,
  },
  groupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  groupDescription: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 12,
    lineHeight: 16,
  },
  modalActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 12,
  },
  actionBtn: {
    flex: 1,
  },
});
