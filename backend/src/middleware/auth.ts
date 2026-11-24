import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  EmployeePermissions,
  PermissionKey,
  resolveUserPermissions,
  isSuperAdminRole,
  isStaffRole,
} from '../utils/permissions';

export interface JwtPayload {
  userId: string;
  email?: string | null;
  phone: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload & {
    name: string;
    isBlocked: boolean;
    isSuperAdmin: boolean;
    permissions: EmployeePermissions;
    totalBalancePaise: number;
    bonusPercentage: number;
    activeBonusPaise?: number;
  };
}

const JWT_SECRET = process.env.JWT_SECRET || 'vf_wallet_super_secret_jwt_key_2026';

/**
 * Middleware to authenticate requests using JWT Bearer tokens.
 * Verifies Authorization: Bearer <token>, ensures user is active, and resolves permissions.
 */
export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers['authorization'];
  const token =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required. Please provide Authorization: Bearer <token>',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        permissions: true,
        isBlocked: true,
        totalBalancePaise: true,
        bonusPercentage: true,
        activeBonusPaise: true,
      },
    });

    if (!dbUser) {
      return res.status(401).json({
        success: false,
        error: 'User account not found or has been removed.',
      });
    }

    if (dbUser.isBlocked) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been suspended by an administrator. Please contact support.',
      });
    }

    req.user = {
      userId: dbUser.id,
      email: dbUser.email,
      phone: dbUser.phone,
      name: dbUser.name,
      role: dbUser.role,
      isBlocked: dbUser.isBlocked,
      isSuperAdmin: isSuperAdminRole(dbUser.role),
      permissions: resolveUserPermissions(dbUser.role, dbUser.permissions),
      totalBalancePaise: dbUser.totalBalancePaise,
      bonusPercentage: dbUser.bonusPercentage || 0,
      activeBonusPaise: dbUser.activeBonusPaise,
    };

    return next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token has expired. Please sign in again.',
      });
    }

    return res.status(403).json({
      success: false,
      error: 'Invalid or forged access token.',
    });
  }
};

/**
 * Middleware to allow Super Admin, Admin, or Employee accounts.
 */
export const requireStaff = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.',
    });
  }

  if (!isStaffRole(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Access denied: Employee or Super Admin privileges required.',
    });
  }

  return next();
};

/**
 * Middleware to enforce Super Admin (or legacy Admin) privileges strictly.
 */
export const requireSuperAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.',
    });
  }

  if (!req.user.isSuperAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Access denied: Super Admin privileges required.',
    });
  }

  return next();
};

/**
 * Backward-compatible alias for staff access.
 */
export const requireAdmin = requireStaff;

/**
 * Granular Permission Middleware:
 * Allows Super Admin automatically, or Employee if they have AT LEAST ONE of the specified permissions.
 */
export const requireAnyPermission = (...allowedPermissions: PermissionKey[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    if (req.user.isSuperAdmin) {
      return next();
    }

    if (!isStaffRole(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Staff privileges required.',
      });
    }

    const hasPerm = allowedPermissions.some(
      (key) => req.user?.permissions?.[key] === true
    );

    if (!hasPerm) {
      return res.status(403).json({
        success: false,
        error: `Access denied: Missing required permission (${allowedPermissions.join(' or ')}).`,
      });
    }

    return next();
  };
};
