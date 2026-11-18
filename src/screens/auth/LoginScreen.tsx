import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { Logo } from '../../components/common/Logo';
import { CustomInput } from '../../components/inputs/CustomInput';
import { PrimaryButton } from '../../components/buttons/PrimaryButton';
import { useAuth } from '../../hooks/useAuth';

export const LoginScreen = () => {
  const { loginStaff } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleLogin = async () => {
    setErrorMessage('');
    if (!identifier.trim()) {
      setErrorMessage('Please enter your registered mobile number or email.');
      return;
    }
    if (!password.trim()) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);
    const res = await loginStaff(identifier.trim(), password);
    setLoading(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Login failed. Please check your credentials.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo & Header */}
        <View style={styles.header}>
          <Logo size="lg" showTagline />
          <View style={styles.staffBadge}>
            <Ionicons name="shield-checkmark" size={14} color={colors.primary} />
            <Text style={styles.staffBadgeText}>STAFF & ADMIN PORTAL</Text>
          </View>
          <Text style={styles.welcomeTitle}>Staff Sign In</Text>
          <Text style={styles.welcomeSubtitle}>
            Sign in with your Super Admin or Employee credentials to manage client
            accounts, OCR deposits & payouts.
          </Text>
        </View>

        {/* Form Card */}
        <View style={styles.formCard}>
          <CustomInput
            label="Phone Number or Email"
            placeholder="e.g. 9999999999 or staff@vfwallet.com"
            value={identifier}
            onChangeText={(text) => {
              setIdentifier(text);
              if (errorMessage) setErrorMessage('');
            }}
            leftIcon="person-outline"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <CustomInput
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (errorMessage) setErrorMessage('');
            }}
            leftIcon="lock-closed-outline"
            isPassword
          />

          {errorMessage ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <PrimaryButton
            title="Sign In to Portal"
            onPress={handleLogin}
            loading={loading}
            fullWidth
            size="lg"
            icon="log-in-outline"
            style={styles.loginBtn}
          />
        </View>

        {/* Info Footer */}
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Text style={styles.infoNoteText}>
            Client accounts are managed internally and do not require app login.
            Contact Super Admin for Employee credentials & permissions.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 36,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  staffBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lightBlue,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 18,
    gap: 6,
    borderWidth: 1,
    borderColor: '#CCE0FF',
  },
  staffBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primaryDark,
    letterSpacing: 0.6,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    marginTop: 12,
    letterSpacing: -0.3,
  },
  welcomeSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 12,
    lineHeight: 19,
  },
  formCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerLight,
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FFD1D1',
    gap: 8,
  },
  errorText: {
    fontSize: 12,
    color: colors.dangerDark,
    fontWeight: '600',
    flex: 1,
  },
  loginBtn: {
    marginTop: 6,
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 22,
    paddingHorizontal: 12,
    gap: 8,
  },
  infoNoteText: {
    fontSize: 12,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 18,
  },
});

export default LoginScreen;
