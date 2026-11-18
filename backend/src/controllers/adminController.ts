import { Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { Role, TransactionStatus, TransactionType } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  resolveUserPermissions,
  isSuperAdminRole,
  isClientRole,
} from '../utils/permissions';

const formatManagedUser = (user: any, totalDepositPrincipalPaise?: number) => {
  const principal = totalDepositPrincipalPaise ?? 0;
  const isThresholdReached =
    user.totalBalancePaise >= user.bonusThresholdLimitPaise;
  const withdrawablePaise = isThresholdReached
    ? Math.min(user.totalBalancePaise, principal)
    : user.totalBalancePaise;

  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    accountType: isSuperAdminRole(user.role)
      ? 'SUPER_ADMIN'
      : user.role === Role.EMPLOYEE
      ? 'EMPLOYEE'
      : 'CLIENT',
    isSuperAdmin: isSuperAdminRole(user.role),
    permissions: resolveUserPermissions(user.role, user.permissions),
    isBlocked: user.isBlocked,
    bonusPercentage: user.bonusPercentage,
    bonusThresholdLimitPaise: user.bonusThresholdLimitPaise,
    totalBalancePaise: user.totalBalancePaise,
    totalDepositPrincipalPaise: principal,
    withdrawablePaise,
    isThresholdReached,
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
    ...(user._count ? { totalTransactions: user._count.transactions } : {}),
    ...(user.transactions ? { transactions: user.transactions } : {}),
  };
};

/**
 * POST /api/admin/users/create
 * Creates either a CLIENT (no login credentials required) or an EMPLOYEE (credentials + granular permissions).
 */
export const createUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const {
      name,
      phone,
      email,
      password,
      userType,
      role,
      permissions,
      upiId,
      bankAccount,
      bonusPercentage = 10.0,
      bonusThresholdLimit,
      bonusThresholdLimitPaise,
    } = req.body;

    // Determine target role: CLIENT or EMPLOYEE
    const requestedType = String(userType || role || 'CLIENT').toUpperCase();
    const targetRole: Role =
      requestedType === 'EMPLOYEE' ? Role.EMPLOYEE : Role.CLIENT;

    // Authorization check
    if (targetRole === Role.EMPLOYEE) {
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Only Super Admin can create Employee accounts.',
        });
      }
    } else {
      if (!req.user.isSuperAdmin && !req.user.permissions.canManageClients) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You do not have permission to create clients.',
        });
      }
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Full name is required.',
      });
    }

    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required.',
      });
    }

    // Employees MUST have a password; Clients do NOT need login credentials
    let passwordHash: string | null = null;
    if (targetRole === Role.EMPLOYEE) {
      if (!password || typeof password !== 'string' || password.length < 4) {
        return res.status(400).json({
          success: false,
          error: 'Employee password must be at least 4 characters long.',
        });
      }
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
    }

    const cleanPhone = phone.trim();
    const cleanEmail =
      email && typeof email === 'string' && email.trim()
        ? email.trim().toLowerCase()
        : null;

    // Check if phone already registered
    const existingPhone = await prisma.user.findUnique({
      where: { phone: cleanPhone },
    });

    if (existingPhone) {
      return res.status(409).json({
        success: false,
        error: `An account with phone number ${cleanPhone} already exists.`,
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
          error: `An account with email ${cleanEmail} already exists.`,
        });
      }
    }

    // Bonus & threshold config (for Clients)
    let thresholdPaise = 1000000; // Default: ₹10,000 = 1,000,000 paise
    const canConfigureThreshold =
      req.user.isSuperAdmin || req.user.permissions.canSetThreshold;
    if (canConfigureThreshold) {
      if (
        bonusThresholdLimitPaise !== undefined &&
        Number.isInteger(Number(bonusThresholdLimitPaise))
      ) {
        thresholdPaise = Number(bonusThresholdLimitPaise);
      } else if (bonusThresholdLimit !== undefined) {
        const parsedLimit = Number(bonusThresholdLimit);
        if (!isNaN(parsedLimit) && parsedLimit >= 0) {
          thresholdPaise = Math.round(parsedLimit * 100);
        }
      }
    }

    let finalBonusPercentage = 10.0;
    const canConfigureBonus =
      req.user.isSuperAdmin || req.user.permissions.canSetBonus;
    if (canConfigureBonus) {
      const parsedBonus = Number(bonusPercentage);
      if (!isNaN(parsedBonus) && parsedBonus >= 0 && parsedBonus <= 100) {
        finalBonusPercentage = parsedBonus;
      }
    }

    const resolvedPerms =
      targetRole === Role.EMPLOYEE
        ? resolveUserPermissions(Role.EMPLOYEE, permissions)
        : undefined;

    const cleanUpi =
      upiId && typeof upiId === 'string' && upiId.trim() ? upiId.trim() : null;

    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        phone: cleanPhone,
        email: cleanEmail,
        passwordHash,
        role: targetRole,
        permissions: resolvedPerms ? (resolvedPerms as any) : undefined,
        isBlocked: false,
        bonusPercentage: finalBonusPercentage,
        bonusThresholdLimitPaise: thresholdPaise,
        totalBalancePaise: 0,
        upiId: cleanUpi,
        bankAccountNumber: bankAccount?.accountNumber?.trim() || null,
        bankIfsc: bankAccount?.ifsc?.trim()?.toUpperCase() || null,
        bankName: bankAccount?.bankName?.trim() || null,
        bankAccountHolderName: bankAccount?.accountHolderName?.trim() || null,
      },
    });

    return res.status(201).json({
      success: true,
      message:
        targetRole === Role.EMPLOYEE
          ? 'Employee account created successfully with assigned permissions.'
          : 'Client account created successfully.',
      user: formatManagedUser(newUser, 0),
    });
  } catch (error: any) {
    console.error('Error in createUser:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create account.',
    });
  }
};

/**
 * GET /api/admin/users
 * Lists clients or employees with search, filter, and live withdrawable calculation.
 */
export const getAllUsers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

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

    const requestedRole = typeof role === 'string' ? role.toUpperCase() : '';

    if (requestedRole === 'EMPLOYEE') {
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Only Super Admin can view Employee accounts.',
        });
      }
      whereClause.role = Role.EMPLOYEE;
    } else if (requestedRole === 'CLIENT' || requestedRole === 'USER') {
      whereClause.role = { in: [Role.CLIENT, Role.USER] };
    } else if (requestedRole === 'SUPER_ADMIN' || requestedRole === 'ADMIN') {
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }
      whereClause.role = { in: [Role.SUPER_ADMIN, Role.ADMIN] };
    } else if (!req.user.isSuperAdmin) {
      // Employees only ever list Clients
      whereClause.role = { in: [Role.CLIENT, Role.USER] };
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [totalUsers, users] = await Promise.all([
      prisma.user.count({ where: whereClause }),
      prisma.user.findMany({
        where: whereClause,
        include: {
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

    // Aggregate approved deposit principal per user for accurate withdrawable display
    const userIds = users.map((u) => u.id);
    const depositSums =
      userIds.length > 0
        ? await prisma.transaction.groupBy({
            by: ['userId'],
            where: {
              userId: { in: userIds },
              type: TransactionType.DEPOSIT,
              status: TransactionStatus.APPROVED,
            },
            _sum: { amountPaise: true },
          })
        : [];

    const principalMap = new Map<string, number>();
    for (const d of depositSums) {
      principalMap.set(d.userId, d._sum.amountPaise || 0);
    }

    return res.status(200).json({
      success: true,
      total: totalUsers,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalUsers / limitNum),
      users: users.map((u) =>
        formatManagedUser(u, principalMap.get(u.id) || 0)
      ),
    });
  } catch (error: any) {
    console.error('Error in getAllUsers:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve accounts.',
    });
  }
};

/**
 * PATCH /api/admin/users/:userId
 * Updates a Client's (or Employee's) data: name, phone, email, upiId, bankAccount.
 */
export const updateUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const { userId } = req.params;
    const { name, phone, email, upiId, bankAccount, password } = req.body;

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
    }

    // Permission checks
    if (!isClientRole(target.role)) {
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Only Super Admin can modify Employee or Admin accounts.',
        });
      }
    } else {
      if (!req.user.isSuperAdmin && !req.user.permissions.canManageClients) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Client Data Management permission required.',
        });
      }
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
      if (cleanPhone !== target.phone) {
        const dup = await prisma.user.findUnique({ where: { phone: cleanPhone } });
        if (dup) {
          return res.status(409).json({
            success: false,
            error: `Phone number ${cleanPhone} is already in use.`,
          });
        }
      }
      updateData.phone = cleanPhone;
    }

    if (email !== undefined) {
      const cleanEmail =
        email && typeof email === 'string' && email.trim()
          ? email.trim().toLowerCase()
          : null;
      if (cleanEmail && cleanEmail !== target.email) {
        const dup = await prisma.user.findUnique({ where: { email: cleanEmail } });
        if (dup) {
          return res.status(409).json({
            success: false,
            error: `Email ${cleanEmail} is already in use.`,
          });
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
        updateData.bankAccountNumber = bankAccount.accountNumber?.trim() || null;
        updateData.bankIfsc = bankAccount.ifsc?.trim()?.toUpperCase() || null;
        updateData.bankName = bankAccount.bankName?.trim() || null;
        updateData.bankAccountHolderName =
          bankAccount.accountHolderName?.trim() || null;
      }
    }

    if (
      password &&
      typeof password === 'string' &&
      password.trim().length >= 4 &&
      target.role === Role.EMPLOYEE &&
      req.user.isSuperAdmin
    ) {
      const salt = await bcrypt.genSalt(10);
      updateData.passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    const depositAgg = await prisma.transaction.aggregate({
      where: {
        userId,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.APPROVED,
      },
      _sum: { amountPaise: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Account details updated successfully.',
      user: formatManagedUser(updated, depositAgg._sum.amountPaise || 0),
    });
  } catch (error: any) {
    console.error('Error in updateUser:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update account details.',
    });
  }
};

/**
 * PATCH /api/admin/users/:userId/permissions
 * Super Admin ONLY: updates an Employee's granular permissions (and optionally password).
 */
export const updateEmployeePermissions = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user || !req.user.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only Super Admin can update employee permissions.',
      });
    }

    const { userId } = req.params;
    const { permissions, password } = req.body;

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    if (target.role !== Role.EMPLOYEE) {
      return res.status(400).json({
        success: false,
        error: 'Permissions can only be customized for Employee accounts.',
      });
    }

    const normalized = resolveUserPermissions(Role.EMPLOYEE, permissions);
    const updateData: any = {
      permissions: normalized as any,
    };

    if (password && typeof password === 'string' && password.trim().length >= 4) {
      const salt = await bcrypt.genSalt(10);
      updateData.passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      message: 'Employee permissions updated successfully.',
      user: formatManagedUser(updated, 0),
    });
  } catch (error: any) {
    console.error('Error in updateEmployeePermissions:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update employee permissions.',
    });
  }
};

/**
 * PATCH /api/admin/users/:userId/bonus-config
 * Updates a client's custom bonusPercentage (requires canSetBonus)
 * and/or bonusThresholdLimit (requires canSetThreshold).
 */
export const updateUserBonusConfig = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const { userId } = req.params;
    const { bonusPercentage, bonusThresholdLimit, bonusThresholdLimitPaise } =
      req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `Client with ID ${userId} not found.`,
      });
    }

    const updates: any = {};

    if (bonusPercentage !== undefined) {
      if (!req.user.isSuperAdmin && !req.user.permissions.canSetBonus) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You do not have permission to set client bonus %.',
        });
      }

      const percentage = Number(bonusPercentage);
      if (isNaN(percentage) || percentage < 0 || percentage > 100) {
        return res.status(400).json({
          success: false,
          error: 'bonusPercentage must be a valid number between 0 and 100.',
        });
      }
      updates.bonusPercentage = percentage;
    }

    if (
      bonusThresholdLimitPaise !== undefined ||
      bonusThresholdLimit !== undefined
    ) {
      if (!req.user.isSuperAdmin && !req.user.permissions.canSetThreshold) {
        return res.status(403).json({
          success: false,
          error:
            'Access denied: You do not have permission to set client threshold limit.',
        });
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
    });

    const depositAgg = await prisma.transaction.aggregate({
      where: {
        userId,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.APPROVED,
      },
      _sum: { amountPaise: true },
    });

    return res.status(200).json({
      success: true,
      message: "Client's configuration updated successfully.",
      user: formatManagedUser(updatedUser, depositAgg._sum.amountPaise || 0),
    });
  } catch (error: any) {
    console.error('Error updating bonus config:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to update client's configuration.",
    });
  }
};

/**
 * PATCH /api/admin/users/:userId/toggle-block
 * Toggles an existing client's or employee's isBlocked state.
 */
export const toggleBlockUser = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const { userId } = req.params;
    const { isBlocked } = req.body;

    if (userId === req.user.userId) {
      return res.status(400).json({
        success: false,
        error: 'You cannot suspend your own account.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `Account with ID ${userId} not found.`,
      });
    }

    if (!isClientRole(user.role)) {
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Only Super Admin can block or unblock Employee accounts.',
        });
      }
    } else if (!req.user.isSuperAdmin && !req.user.permissions.canManageClients) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Client Management permission required.',
      });
    }

    const targetBlocked =
      typeof isBlocked === 'boolean' ? isBlocked : !user.isBlocked;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { isBlocked: targetBlocked },
    });

    const statusText = targetBlocked ? 'blocked' : 'unblocked';
    return res.status(200).json({
      success: true,
      message: `Account has been successfully ${statusText}.`,
      user: formatManagedUser(updatedUser, 0),
    });
  } catch (error: any) {
    console.error('Error in toggleBlockUser:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to toggle account status.',
    });
  }
};

/**
 * GET /api/admin/users/:userId
 * Returns full client or employee details, withdrawable calculation, and recent transactions.
 */
export const getUserById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `Account with ID ${userId} not found.`,
      });
    }

    if (!isClientRole(user.role) && !req.user.isSuperAdmin && user.id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        error: 'Only Super Admin can inspect Employee accounts.',
      });
    }

    const depositAgg = await prisma.transaction.aggregate({
      where: {
        userId,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.APPROVED,
      },
      _sum: { amountPaise: true },
    });

    return res.status(200).json({
      success: true,
      user: formatManagedUser(user, depositAgg._sum.amountPaise || 0),
    });
  } catch (error: any) {
    console.error('Error in getUserById:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve account details.',
    });
  }
};
