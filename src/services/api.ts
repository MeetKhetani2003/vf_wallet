import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { STORAGE_KEYS } from '../utils/constants';

// Determine default API host dynamically
const getDevHost = (): string => {
  // 1. Expo Go on physical device or emulator with hostUri (LAN IP: e.g. 192.168.1.10)
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return `${ip}:5000`;
    }
  }

  // 2. Android emulator standalone alias
  if (Platform.OS === 'android') {
    return '10.0.2.2:5000';
  }

  return 'localhost:5000';
};

export const PRODUCTION_API_URL = 'https://vf-wallet-backend.onrender.com/api';

// Default to production deployed backend on Render (especially critical for APK release/debug builds)
export const DEFAULT_API_BASE_URL = PRODUCTION_API_URL;

let activeBaseUrl = DEFAULT_API_BASE_URL;

export const setApiBaseUrl = (url: string) => {
  activeBaseUrl = url.replace(/\/+$/, '');
};

export const getApiBaseUrl = () => activeBaseUrl;

/**
 * Strict JWT token storage helpers (no silent auto-login)
 */
export const tokenStorage = {
  async getToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    } catch {
      return null;
    }
  },
  async setToken(token: string): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    } catch (e) {
      console.error('Failed to store auth token:', e);
    }
  },
  async clearToken(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    } catch (e) {
      console.error('Failed to clear auth token:', e);
    }
  },
};

export interface ApiResponse<T = any> {
  success: boolean;
  status?: number;
  message?: string;
  error?: string;
  token?: string;
  user?: T;
  users?: T[];
  total?: number;
  isNetworkError?: boolean;
  [key: string]: any;
}

/**
 * Core Request function with automatic JWT Bearer interceptor.
 */
async function request<T = any>(
  endpoint: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<ApiResponse<T>> {
  const url = endpoint.startsWith('http') ? endpoint : `${activeBaseUrl}${endpoint}`;
  const { timeoutMs = 15000, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };

  // Interceptor: Attach JWT token from AsyncStorage / auto-recovery
  const token = await tokenStorage.getToken();
  if (token && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        await tokenStorage.clearToken();
      }

      return {
        success: false,
        status: response.status,
        error: data.error || data.message || `Request failed with status ${response.status}`,
        ...data,
      };
    }

    return {
      success: true,
      status: response.status,
      ...data,
    };
  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    return {
      success: false,
      isNetworkError: true,
      error: isTimeout
        ? 'Network request timed out. Please check your backend connection.'
        : error.message || 'Unable to connect to server.',
    };
  }
}

/**
 * REST HTTP Methods
 */
export const apiClient = {
  get: <T = any>(endpoint: string, headers?: HeadersInit) =>
    request<T>(endpoint, { method: 'GET', headers }),

  post: <T = any>(endpoint: string, body?: any, headers?: HeadersInit) =>
    request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers,
    }),

  patch: <T = any>(endpoint: string, body?: any, headers?: HeadersInit) =>
    request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
      headers,
    }),

  delete: <T = any>(endpoint: string, headers?: HeadersInit) =>
    request<T>(endpoint, { method: 'DELETE', headers }),
};

/**
 * Authentication API Service
 */
export const authApi = {
  async login(identifier: string, password?: string) {
    return apiClient.post('/auth/login', {
      identifier: identifier.trim(),
      password,
    });
  },

  async getMe() {
    return apiClient.get('/auth/me');
  },

  async updateProfile(data: {
    name?: string;
    email?: string;
    phone?: string;
    upiId?: string;
    bankAccount?: {
      accountNumber: string;
      ifsc: string;
      bankName: string;
      accountHolderName: string;
    } | null;
    avatarUrl?: string;
  }) {
    return apiClient.patch('/auth/profile', data);
  },
};

/**
 * Admin User Management API Service
 */
export const adminApi = {
  async createUser(data: {
    name: string;
    phone: string;
    email?: string;
    password?: string;
    userType?: 'CLIENT' | 'EMPLOYEE';
    role?: 'CLIENT' | 'EMPLOYEE';
    permissions?: {
      canOcrUpload: boolean;
      canDeposit: boolean;
      canWithdraw: boolean;
      canSetBonus: boolean;
      canSetThreshold: boolean;
      canManageClients: boolean;
    };
    upiId?: string;
    bankAccount?: {
      accountNumber: string;
      ifsc: string;
      bankName: string;
      accountHolderName: string;
    } | null;
    bonusPercentage?: number;
    bonusThresholdLimit?: number;
  }) {
    return apiClient.post('/admin/users/create', data);
  },

  async updateUser(
    userId: string,
    data: {
      name?: string;
      phone?: string;
      email?: string;
      upiId?: string;
      bankAccount?: {
        accountNumber: string;
        ifsc: string;
        bankName: string;
        accountHolderName: string;
      } | null;
      password?: string;
    }
  ) {
    return apiClient.patch(`/admin/users/${userId}`, data);
  },

  async updateEmployeePermissions(
    userId: string,
    permissions: {
      canOcrUpload: boolean;
      canDeposit: boolean;
      canWithdraw: boolean;
      canSetBonus: boolean;
      canSetThreshold: boolean;
      canManageClients: boolean;
    },
    password?: string
  ) {
    return apiClient.patch(`/admin/users/${userId}/permissions`, {
      permissions,
      ...(password ? { password } : {}),
    });
  },

  async scanReceiptOcr(base64: string, mimeType?: string) {
    return request('/admin/ocr/scan', {
      method: 'POST',
      body: JSON.stringify({ base64, mimeType }),
      timeoutMs: 30000,
    });
  },

  async createClientDeposit(
    clientId: string,
    data: {
      amountPaise: number;
      clientName?: string;
      clientPhone?: string;
      utr?: string;
      imageHash?: string;
      imageUrl?: string;
      screenshotUri?: string;
      paymentApp?: string;
      rawOcrData?: any;
      submissionSource?: 'ocr' | 'manual' | 'gallery' | 'whatsapp_share';
      notes?: string;
    }
  ) {
    return apiClient.post(`/admin/clients/${clientId}/deposit`, data);
  },

  async createClientWithdrawal(
    clientId: string,
    data: {
      amountPaise: number;
      paymentApp?: string;
      paymentMethod?: string;
      upiId?: string;
      bankDetails?: any;
      notes?: string;
    }
  ) {
    return apiClient.post(`/admin/clients/${clientId}/withdraw`, data);
  },

  async getUsers(params?: {
    search?: string;
    isBlocked?: boolean;
    role?: string;
    page?: number;
    limit?: number;
  }) {
    let query = '';
    if (params) {
      const searchParams = new URLSearchParams();
      if (params.search) searchParams.append('search', params.search);
      if (params.isBlocked !== undefined)
        searchParams.append('isBlocked', String(params.isBlocked));
      if (params.role) searchParams.append('role', params.role);
      if (params.page) searchParams.append('page', String(params.page));
      if (params.limit) searchParams.append('limit', String(params.limit));
      const str = searchParams.toString();
      if (str) query = `?${str}`;
    }
    return apiClient.get(`/admin/users${query}`);
  },

  async getUserById(userId: string) {
    return apiClient.get(`/admin/users/${userId}`);
  },

  async updateUserBonusConfig(
    userId: string,
    data: { bonusPercentage?: number; bonusThresholdLimit?: number }
  ) {
    return apiClient.patch(`/admin/users/${userId}/bonus-config`, data);
  },

  async toggleBlockUser(userId: string, isBlocked?: boolean) {
    return apiClient.patch(`/admin/users/${userId}/toggle-block`, { isBlocked });
  },

  async getPendingDeposits() {
    return apiClient.get('/admin/pending-deposits');
  },

  async getPendingWithdrawals() {
    return apiClient.get('/admin/pending-withdrawals');
  },

  async getAllTransactions(params?: {
    status?: string;
    type?: string;
    userId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    let query = '';
    if (params) {
      const searchParams = new URLSearchParams();
      if (params.status) searchParams.append('status', params.status);
      if (params.type) searchParams.append('type', params.type);
      if (params.userId) searchParams.append('userId', params.userId);
      if (params.search) searchParams.append('search', params.search);
      if (params.page) searchParams.append('page', String(params.page));
      if (params.limit) searchParams.append('limit', String(params.limit));
      const str = searchParams.toString();
      if (str) query = `?${str}`;
    }
    return apiClient.get(`/admin/transactions${query}`);
  },

  async approveDeposit(transactionId: string) {
    return apiClient.post(`/admin/transactions/${transactionId}/approve`);
  },

  async rejectDeposit(transactionId: string, rejectionReason: string) {
    return apiClient.post(`/admin/transactions/${transactionId}/reject`, {
      rejectionReason,
    });
  },

  async approveWithdrawal(transactionId: string) {
    return apiClient.post(
      `/admin/transactions/${transactionId}/approve-withdrawal`
    );
  },

  async rejectWithdrawal(transactionId: string, rejectionReason: string) {
    return apiClient.post(
      `/admin/transactions/${transactionId}/reject-withdrawal`,
      { rejectionReason }
    );
  },

  async getAdminStats() {
    return apiClient.get('/admin/stats');
  },

  async getDailyBonus() {
    return apiClient.get('/admin/daily-bonus');
  },

  async setDailyBonus(percentage: number, isActive: boolean = true) {
    return apiClient.post('/admin/daily-bonus', { percentage, isActive });
  },
};

/**
 * User Wallet API Service
 */
export const walletApi = {
  async createDeposit(data: {
    amountPaise: number;
    amount?: number;
    utr?: string;
    imageHash?: string;
    imageUrl?: string;
    screenshotUri?: string;
    paymentApp?: string;
    rawOcrData?: any;
  }) {
    return apiClient.post('/wallet/deposit', data);
  },

  async createWithdrawal(data: {
    amountPaise: number;
    paymentApp?: string;
    paymentMethod?: string;
    upiId?: string;
    bankDetails?: any;
    notes?: string;
  }) {
    return apiClient.post('/wallet/withdraw', data);
  },

  async getTransactions() {
    return apiClient.get('/wallet/history');
  },

  async getSummary() {
    return apiClient.get('/wallet/summary');
  },
};
