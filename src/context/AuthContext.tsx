import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthUser, User, AdminUser, UserRole } from '../types';
import { storageService } from '../services/storageService';
import { authApi, tokenStorage } from '../services/api';
import { mockAuthService } from '../services/mockAuthService';

interface AuthContextType {
  user: AuthUser | null;
  role: UserRole | null;
  isLoading: boolean;
  loginUser: (
    identifier: string,
    password?: string
  ) => Promise<{ success: boolean; error?: string }>;
  loginAdmin: (
    identifier: string,
    password?: string
  ) => Promise<{ success: boolean; error?: string }>;
  signup: (data: {
    name: string;
    email: string;
    phone: string;
    password?: string;
    upiId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchUser: (targetUser: AuthUser) => Promise<void>;
  refreshSession: () => Promise<void>;
  updateProfile: (data: {
    name?: string;
    email?: string;
    phone?: string;
    upiId?: string;
    bankAccount?: import('../types').BankAccount | null;
    avatarUrl?: string;
  }) => Promise<{ success: boolean; user?: AuthUser; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to normalize backend User/Admin into frontend AuthUser
const mapBackendUserToAuthUser = (backendUser: any): AuthUser => {
  const isSuperOrAdmin =
    backendUser.role === 'ADMIN' || backendUser.role === 'SUPER_ADMIN';

  if (isSuperOrAdmin) {
    const admin: AdminUser = {
      id: backendUser.id,
      name: backendUser.name,
      email: backendUser.email || `${backendUser.phone}@vfwallet.local`,
      phone: backendUser.phone,
      role: 'admin',
      adminRoleTitle:
        backendUser.role === 'SUPER_ADMIN' ? 'Super Administrator' : 'Administrator',
      avatarUrl:
        backendUser.avatarUrl ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    };
    return admin;
  }

  const user: User = {
    id: backendUser.id,
    name: backendUser.name,
    email: backendUser.email || `${backendUser.phone}@vfwallet.local`,
    phone: backendUser.phone,
    role: 'user',
    status: backendUser.isBlocked ? 'blocked' : 'active',
    createdAt: backendUser.createdAt || new Date().toISOString(),
    bonusPercentage: backendUser.bonusPercentage,
    bonusThresholdLimitPaise: backendUser.bonusThresholdLimitPaise,
    totalBalancePaise: backendUser.totalBalancePaise || 0,
    upiId: backendUser.upiId || undefined,
    bankAccount: backendUser.bankAccount || (backendUser.bankAccountNumber ? {
      accountNumber: backendUser.bankAccountNumber,
      ifsc: backendUser.bankIfsc || '',
      bankName: backendUser.bankName || '',
      accountHolderName: backendUser.bankAccountHolderName || backendUser.name,
    } : undefined),
    avatarUrl: backendUser.avatarUrl,
    kycStatus: backendUser.kycStatus || 'verified',
  };
  return user;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /**
   * Initializes session on app launch:
   * 1. Checks if a JWT token exists in AsyncStorage.
   * 2. Calls GET /api/auth/me to fetch latest profile from backend.
   * 3. Falls back to cached local user if offline.
   */
  const initAuth = async () => {
    try {
      await storageService.initializeDefaults();
      const token = await tokenStorage.getToken();

      if (token) {
        // Fetch current authenticated user from backend API
        const res = await authApi.getMe();
        if (res.success && res.user) {
          const authUser = mapBackendUserToAuthUser(res.user);
          setUser(authUser);
          await storageService.setAuthUser(authUser);
          return;
        } else if (!res.isNetworkError && (res.status === 401 || res.status === 403)) {
          // Only clear token if backend explicitly rejected it
          await tokenStorage.clearToken();
        }
      }

      // Fallback: check cached user from storage
      const storedUser = await storageService.getAuthUser();
      setUser(storedUser);
    } catch (e) {
      console.error('Failed to init auth context:', e);
      const storedUser = await storageService.getAuthUser();
      setUser(storedUser);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initAuth();
  }, []);

  /**
   * POST /api/auth/login for User accounts
   */
  const loginUser = async (identifier: string, password?: string) => {
    setIsLoading(true);

    try {
      // 1. Try Live Backend API
      const res = await authApi.login(identifier, password);

      if (res.success && res.token && res.user) {
        // Save JWT token
        await tokenStorage.setToken(res.token);

        const authUser = mapBackendUserToAuthUser(res.user);
        await storageService.setAuthUser(authUser);
        setUser(authUser);
        return { success: true };
      }

      // 2. Demo User Fallback (e.g. if offline or demo credentials)
      const fallback = await mockAuthService.loginUser(identifier, password);
      if (fallback.success && fallback.user) {
        setUser(fallback.user);
        return { success: true };
      }

      return {
        success: false,
        error: res.error || fallback.error || 'Invalid phone/email or password.',
      };
    } catch (err: any) {
      const fallback = await mockAuthService.loginUser(identifier, password);
      if (fallback.success && fallback.user) {
        setUser(fallback.user);
        return { success: true };
      }
      return { success: false, error: err.message || 'Login failed.' };
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * POST /api/auth/login for Admin accounts
   */
  const loginAdmin = async (identifier: string, password?: string) => {
    setIsLoading(true);

    try {
      // 1. Try Live Backend API
      const res = await authApi.login(identifier, password);

      if (res.success && res.token && res.user) {
        const isSuperOrAdmin =
          res.user.role === 'ADMIN' || res.user.role === 'SUPER_ADMIN';

        if (!isSuperOrAdmin) {
          return {
            success: false,
            error: 'Access denied: This account does not have administrator privileges.',
          };
        }

        // Save JWT token
        await tokenStorage.setToken(res.token);

        const authAdmin = mapBackendUserToAuthUser(res.user);
        await storageService.setAuthUser(authAdmin);
        setUser(authAdmin);
        return { success: true };
      }

      // 2. Demo Admin Fallback (supports all demo admin chips even if backend is offline)
      const fallback = await mockAuthService.loginAdmin(identifier, password);
      if (fallback.success && fallback.admin) {
        setUser(fallback.admin);
        return { success: true };
      }

      return {
        success: false,
        error: res.error || fallback.error || 'Admin verification failed.',
      };
    } catch (err: any) {
      const fallback = await mockAuthService.loginAdmin(identifier, password);
      if (fallback.success && fallback.admin) {
        setUser(fallback.admin);
        return { success: true };
      }
      return { success: false, error: err.message || 'Admin login failed.' };
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Signup for users
   */
  const signup = async (data: {
    name: string;
    email: string;
    phone: string;
    password?: string;
    upiId?: string;
  }) => {
    setIsLoading(true);
    try {
      const res = await mockAuthService.signupUser(data);
      if (res.success && res.user) {
        setUser(res.user);
        return { success: true };
      }
      return { success: false, error: res.error };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await tokenStorage.clearToken();
    await storageService.setAuthUser(null);
    setUser(null);
  };

  const switchUser = async (targetUser: AuthUser) => {
    await storageService.setAuthUser(targetUser);
    setUser(targetUser);
  };

  const refreshSession = async () => {
    try {
      const res = await authApi.getMe();
      if (res.success && res.user) {
        const authUser = mapBackendUserToAuthUser(res.user);
        await storageService.setAuthUser(authUser);
        setUser(authUser);
        return;
      }
    } catch (e) {
      console.warn('Could not refresh session from API:', e);
    }

    const updated = await storageService.getAuthUser();
    setUser(updated);
  };

  /**
   * Updates user profile (name, email, phone, upiId, bankAccount, avatarUrl)
   * both on the live backend and in local session storage.
   */
  const updateProfile = async (data: {
    name?: string;
    email?: string;
    phone?: string;
    upiId?: string;
    bankAccount?: import('../types').BankAccount | null;
    avatarUrl?: string;
  }) => {
    try {
      // 1. Try Live Backend API
      const res = await authApi.updateProfile(data);
      if (res.success && res.user) {
        const updatedAuthUser = mapBackendUserToAuthUser(res.user);
        await storageService.setAuthUser(updatedAuthUser);
        setUser(updatedAuthUser);
        return { success: true, user: updatedAuthUser };
      }

      if (res.error && !res.isNetworkError) {
        return { success: false, error: res.error };
      }

      // 2. Offline fallback
      if (user) {
        const updatedLocalUser = {
          ...user,
          ...data,
          bankAccount:
            data.bankAccount !== undefined
              ? data.bankAccount || undefined
              : (user as User).bankAccount,
        } as AuthUser;
        await storageService.setAuthUser(updatedLocalUser);
        setUser(updatedLocalUser);
        return { success: true, user: updatedLocalUser };
      }

      return {
        success: false,
        error: res.error || 'Failed to update profile.',
      };
    } catch (e: any) {
      console.error('Update profile error:', e);
      return {
        success: false,
        error: e?.message || 'Failed to update profile.',
      };
    }
  };

  const role = user ? user.role : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isLoading,
        loginUser,
        loginAdmin,
        signup,
        logout,
        switchUser,
        refreshSession,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
