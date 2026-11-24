import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { AuthenticatedRequest, JwtPayload } from '../middleware/auth';
import {
  resolveUserPermissions,
  isSuperAdminRole,
  isStaffRole,
} from '../utils/permissions';

const JWT_SECRET = process.env.JWT_SECRET || 'vf_wallet_super_secret_jwt_key_2026';

/**
 * Generates a signed JWT token.
 */
export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '365d' });
};

/**
 * Formats a Prisma User into a client-safe response object with resolved permissions.
 */
const formatUserResponse = (user: any) => {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    isSuperAdmin: isSuperAdminRole(user.role),
    permissions: resolveUserPermissions(user.role, user.permissions),
    isBlocked: user.isBlocked,
    bonusPercentage: user.bonusPercentage,
    totalBalancePaise: user.totalBalancePaise,
    activeBonusPaise: user.activeBonusPaise || 0,
    lastDepositAmountPaise: user.lastDepositAmountPaise || 0,
    cycleWithdrawnPaise: user.cycleWithdrawnPaise || 0,
    isBonusDeductedInCycle: Boolean(user.isBonusDeductedInCycle),
    lastLatitude: user.lastLatitude ?? null,
    lastLongitude: user.lastLongitude ?? null,
    lastLocationUpdatedAt: user.lastLocationUpdatedAt ?? null,
    upiId: user.upiId || null,
    bankAccount: user.bankAccountNumber
      ? {
          accountNumber: user.bankAccountNumber,
          ifsc: user.bankIfsc || '',
          bankName: user.bankName || '',
          accountHolderName: user.bankAccountHolderName || user.name,
        }
      : null,
    avatarUrl: user.avatarUrl || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

/**
 * POST /api/auth/login
 * Authenticates ONLY Staff accounts (SUPER_ADMIN, ADMIN, EMPLOYEE).
 * CLIENT accounts do not have login access.
 */
export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, phone, email, password } = req.body;
    const loginIdentifier = (identifier || phone || email || '').trim();

    if (!loginIdentifier) {
      return res.status(400).json({
        success: false,
        error: 'Phone number or email is required.',
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required.',
      });
    }

    // Search user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: loginIdentifier, mode: 'insensitive' } },
          { phone: loginIdentifier },
        ],
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid phone/email or password.',
      });
    }

    // Clients do not have login access — only Employees & Super Admin
    if (!isStaffRole(user.role)) {
      return res.status(403).json({
        success: false,
        error:
          'Client accounts do not have login access. Please sign in with an Employee or Super Admin account.',
      });
    }

    if (!user.passwordHash) {
      return res.status(401).json({
        success: false,
        error: 'Login credentials are not configured for this account.',
      });
    }

    // Verify password hash
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid phone/email or password.',
      });
    }

    // Check account status
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        error:
          'Your account has been suspended by an administrator. Please contact support.',
      });
    }

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
    });

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      token,
      user: formatUserResponse(user),
    });
  } catch (error: any) {
    console.error('Error in login:', error);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while processing login.',
    });
  }
};

/**
 * GET /api/auth/me
 * Returns current authenticated staff profile and resolved permissions.
 */
export const getMe = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        _count: {
          select: {
            transactions: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found.',
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        ...formatUserResponse(user),
        totalTransactions: user._count.transactions,
      },
    });
  } catch (error: any) {
    console.error('Error in getMe:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve user profile.',
    });
  }
};

/**
 * PATCH /api/auth/profile
 * Updates the authenticated user's own profile details.
 */
export const updateProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    const userId = req.user.userId;
    const { name, email, phone, upiId, bankAccount, avatarUrl } = req.body;

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found.',
      });
    }

    const updateData: any = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'Name cannot be empty.' });
      }
      updateData.name = name.trim();
    }

    if (phone !== undefined) {
      const cleanPhone = String(phone).trim();
      if (!cleanPhone) {
        return res.status(400).json({ success: false, error: 'Phone number cannot be empty.' });
      }
      if (cleanPhone !== currentUser.phone) {
        const existingPhone = await prisma.user.findUnique({
          where: { phone: cleanPhone },
        });
        if (existingPhone) {
          return res.status(409).json({ success: false, error: 'Phone number is already in use.' });
        }
      }
      updateData.phone = cleanPhone;
    }

    if (email !== undefined) {
      const cleanEmail =
        email && typeof email === 'string' && email.trim()
          ? email.trim().toLowerCase()
          : null;
      if (cleanEmail && cleanEmail !== currentUser.email) {
        const existingEmail = await prisma.user.findFirst({
          where: { email: cleanEmail },
        });
        if (existingEmail) {
          return res.status(409).json({ success: false, error: 'Email address is already in use.' });
        }
      }
      updateData.email = cleanEmail;
    }

    if (upiId !== undefined) {
      updateData.upiId =
        upiId && typeof upiId === 'string' && upiId.trim() ? upiId.trim() : null;
    }

    if (bankAccount !== undefined) {
      if (bankAccount === null) {
        updateData.bankAccountNumber = null;
        updateData.bankIfsc = null;
        updateData.bankName = null;
        updateData.bankAccountHolderName = null;
      } else if (typeof bankAccount === 'object') {
        updateData.bankAccountNumber = bankAccount.accountNumber
          ? String(bankAccount.accountNumber).trim()
          : null;
        updateData.bankIfsc = bankAccount.ifsc
          ? String(bankAccount.ifsc).trim().toUpperCase()
          : null;
        updateData.bankName = bankAccount.bankName
          ? String(bankAccount.bankName).trim()
          : null;
        updateData.bankAccountHolderName = bankAccount.accountHolderName
          ? String(bankAccount.accountHolderName).trim()
          : null;
      }
    }

    if (avatarUrl !== undefined) {
      updateData.avatarUrl = avatarUrl;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: formatUserResponse(updatedUser),
    });
  } catch (error: any) {
    console.error('Error in updateProfile:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update user profile.',
    });
  }
};
