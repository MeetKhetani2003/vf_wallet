import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { Role } from '@prisma/client';

/**
 * POST /api/admin/users/create
 * Creates a new user with custom bonus configuration.
 * Accepts: name, phone, password, bonusPercentage (e.g. 10.0), bonusThresholdLimit (in Rupees, e.g. 10000)
 */
export const createUser = async (req: Request, res: Response) => {
  try {
    const {
      name,
      phone,
      email,
      password,
      bonusPercentage = 10.0,
      bonusThresholdLimit,
      bonusThresholdLimitPaise,
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'User name is required.',
      });
    }

    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required.',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 4 characters long.',
      });
    }

    const cleanPhone = phone.trim();
    const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;

    // Check if phone already registered
    const existingPhone = await prisma.user.findUnique({
      where: { phone: cleanPhone },
    });

    if (existingPhone) {
      return res.status(409).json({
        success: false,
        error: `User with phone number ${cleanPhone} already exists.`,
      });
    }

    // Check if email already registered (if provided)
    if (cleanEmail) {
      const existingEmail = await prisma.user.findUnique({
        where: { email: cleanEmail },
      });

      if (existingEmail) {
        return res.status(409).json({
          success: false,
          error: `User with email ${cleanEmail} already exists.`,
        });
      }
    }

    // Calculate bonus threshold limit in integer paise (1 Rupee = 100 Paise)
    let thresholdPaise = 1000000; // Default: ₹10,000 = 1,000,000 paise
    if (bonusThresholdLimitPaise !== undefined && Number.isInteger(Number(bonusThresholdLimitPaise))) {
      thresholdPaise = Number(bonusThresholdLimitPaise);
    } else if (bonusThresholdLimit !== undefined) {
      const parsedLimit = Number(bonusThresholdLimit);
      if (!isNaN(parsedLimit) && parsedLimit >= 0) {
        thresholdPaise = Math.round(parsedLimit * 100);
      }
    }

    const parsedBonusPercentage = Number(bonusPercentage);
    const finalBonusPercentage = !isNaN(parsedBonusPercentage) && parsedBonusPercentage >= 0
      ? parsedBonusPercentage
      : 10.0;

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user in database
    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        phone: cleanPhone,
        email: cleanEmail,
        passwordHash,
        role: Role.USER,
        isBlocked: false,
        bonusPercentage: finalBonusPercentage,
        bonusThresholdLimitPaise: thresholdPaise,
        totalBalancePaise: 0,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        isBlocked: true,
        bonusPercentage: true,
        bonusThresholdLimitPaise: true,
        totalBalancePaise: true,
        upiId: true,
        bankAccountNumber: true,
        bankIfsc: true,
        bankName: true,
        bankAccountHolderName: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'User created successfully.',
      user: newUser,
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    return res.status(500).json({
      success: false,
      error: 'An internal error occurred while creating user.',
    });
  }
};

/**
 * GET /api/admin/users
 * Returns list of all registered users with their custom bonus config, balance, and block status.
 */
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { search, isBlocked, role, page, limit } = req.query;

    const whereClause: any = {};

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      whereClause.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (isBlocked !== undefined) {
      whereClause.isBlocked = isBlocked === 'true';
    }

    if (role && (role === 'USER' || role === 'ADMIN' || role === 'SUPER_ADMIN')) {
      whereClause.role = role as Role;
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [totalUsers, users] = await Promise.all([
      prisma.user.count({ where: whereClause }),
      prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          role: true,
          isBlocked: true,
          bonusPercentage: true,
          bonusThresholdLimitPaise: true,
          totalBalancePaise: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              transactions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    return res.status(200).json({
      success: true,
      total: totalUsers,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalUsers / limitNum),
      users: users.map((u) => ({
        ...u,
        totalTransactions: u._count.transactions,
      })),
    });
  } catch (error: any) {
    console.error('Error in getAllUsers:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve users list.',
    });
  }
};

/**
 * PATCH /api/admin/users/:userId/bonus-config
 * Updates an existing user's bonusPercentage and bonusThresholdLimitPaise.
 */
export const updateUserBonusConfig = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { bonusPercentage, bonusThresholdLimit, bonusThresholdLimitPaise } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User with ID ${userId} not found.`,
      });
    }

    const updates: any = {};

    if (bonusPercentage !== undefined) {
      const percentage = Number(bonusPercentage);
      if (isNaN(percentage) || percentage < 0 || percentage > 100) {
        return res.status(400).json({
          success: false,
          error: 'bonusPercentage must be a valid number between 0 and 100.',
        });
      }
      updates.bonusPercentage = percentage;
    }

    if (bonusThresholdLimitPaise !== undefined) {
      const paise = Number(bonusThresholdLimitPaise);
      if (isNaN(paise) || paise < 0) {
        return res.status(400).json({
          success: false,
          error: 'bonusThresholdLimitPaise must be a positive integer.',
        });
      }
      updates.bonusThresholdLimitPaise = Math.round(paise);
    } else if (bonusThresholdLimit !== undefined) {
      const limitRupees = Number(bonusThresholdLimit);
      if (isNaN(limitRupees) || limitRupees < 0) {
        return res.status(400).json({
          success: false,
          error: 'bonusThresholdLimit must be a positive number.',
        });
      }
      updates.bonusThresholdLimitPaise = Math.round(limitRupees * 100);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide bonusPercentage or bonusThresholdLimit to update.',
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updates,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        isBlocked: true,
        bonusPercentage: true,
        bonusThresholdLimitPaise: true,
        totalBalancePaise: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "User's bonus configuration updated successfully.",
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Error updating bonus config:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to update user's bonus configuration.",
    });
  }
};

/**
 * PATCH /api/admin/users/:userId/toggle-block
 * Toggles an existing user's isBlocked state.
 */
export const toggleBlockUser = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { isBlocked } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User with ID ${userId} not found.`,
      });
    }

    // Determine target block state
    const targetBlocked = typeof isBlocked === 'boolean' ? isBlocked : !user.isBlocked;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { isBlocked: targetBlocked },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        isBlocked: true,
        bonusPercentage: true,
        bonusThresholdLimitPaise: true,
        totalBalancePaise: true,
        updatedAt: true,
      },
    });

    const statusText = targetBlocked ? 'blocked' : 'unblocked';
    return res.status(200).json({
      success: true,
      message: `User has been successfully ${statusText}.`,
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Error in toggleBlockUser:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to toggle user block status.',
    });
  }
};

/**
 * GET /api/admin/users/:userId
 * Returns full user details including custom bonus config, balance, and recent transactions.
 */
export const getUserById = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        isBlocked: true,
        bonusPercentage: true,
        bonusThresholdLimitPaise: true,
        totalBalancePaise: true,
        upiId: true,
        bankAccountNumber: true,
        bankIfsc: true,
        bankName: true,
        bankAccountHolderName: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User with ID ${userId} not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error: any) {
    console.error('Error in getUserById:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve user details.',
    });
  }
};

