import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';

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
    totalBalancePaise: number;
    bonusPercentage: number;
    bonusThresholdLimitPaise: number;
  };
}

const JWT_SECRET = process.env.JWT_SECRET || 'vf_wallet_super_secret_jwt_key_2026';

/**
 * Middleware to authenticate requests using JWT Bearer tokens.
 * Verifies Authorization: Bearer <token> and ensures user is not blocked.
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
        isBlocked: true,
        totalBalancePaise: true,
        bonusPercentage: true,
        bonusThresholdLimitPaise: true,
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
      totalBalancePaise: dbUser.totalBalancePaise,
      bonusPercentage: dbUser.bonusPercentage,
      bonusThresholdLimitPaise: dbUser.bonusThresholdLimitPaise,
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
 * Middleware to enforce ADMIN or SUPER_ADMIN role authorization.
 */
export const requireAdmin = (
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

  if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Access denied: Administrator privileges required.',
    });
  }

  return next();
};
