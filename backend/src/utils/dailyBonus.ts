import prisma from './prisma';

/**
 * Returns today's date formatted as YYYY-MM-DD in local time
 */
export const getTodayDateString = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Retrieves the currently active daily running bonus rate and threshold settings.
 * - If set for today -> returns configured daily values
 * - Defaults: bonus = 0% (if inactive/unset), threshold = ₹15,000 (1,500,000 paise)
 */
export const getRunningDailyBonusRate = async (): Promise<{
  percentage: number;
  isActive: boolean;
  thresholdLimitPaise: number;
  thresholdLimitRupees: number;
  isThresholdActive: boolean;
  date: string;
  isSetForToday: boolean;
}> => {
  const today = getTodayDateString();

  try {
    const todayBonus = await prisma.dailyBonus.findUnique({
      where: { date: today },
    });

    if (todayBonus) {
      const thresholdPaise =
        todayBonus.thresholdLimitPaise !== undefined && todayBonus.thresholdLimitPaise !== null
          ? todayBonus.thresholdLimitPaise
          : 1500000;
      const isThreshActive =
        todayBonus.isThresholdActive !== undefined && todayBonus.isThresholdActive !== null
          ? todayBonus.isThresholdActive
          : true;

      return {
        percentage: todayBonus.isActive ? todayBonus.percentage : 0.0,
        isActive: todayBonus.isActive,
        thresholdLimitPaise: thresholdPaise,
        thresholdLimitRupees: Math.round(thresholdPaise / 100),
        isThresholdActive: isThreshActive,
        date: today,
        isSetForToday: true,
      };
    }

    // Check system setting for global running bonus & threshold fallback
    const [fallbackBonus, fallbackThreshold] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'running_daily_bonus_rate' } }),
      prisma.systemSetting.findUnique({ where: { key: 'running_daily_threshold_paise' } }),
    ]);

    let fallbackPct = 0.0;
    let fallbackBonusActive = false;
    if (fallbackBonus && fallbackBonus.value) {
      const parsed = parseFloat(fallbackBonus.value);
      if (!isNaN(parsed) && parsed >= 0) {
        fallbackPct = parsed;
        fallbackBonusActive = true;
      }
    }

    let fallbackThreshPaise = 1500000;
    let fallbackThreshActive = true;
    if (fallbackThreshold && fallbackThreshold.value) {
      const parsedThresh = parseInt(fallbackThreshold.value, 10);
      if (!isNaN(parsedThresh) && parsedThresh >= 0) {
        fallbackThreshPaise = parsedThresh;
      }
    }

    return {
      percentage: fallbackPct,
      isActive: fallbackBonusActive,
      thresholdLimitPaise: fallbackThreshPaise,
      thresholdLimitRupees: Math.round(fallbackThreshPaise / 100),
      isThresholdActive: fallbackThreshActive,
      date: today,
      isSetForToday: false,
    };
  } catch (error) {
    console.warn('Error reading daily bonus and threshold rate:', error);
  }

  // Default fallback
  return {
    percentage: 0.0,
    isActive: false,
    thresholdLimitPaise: 1500000,
    thresholdLimitRupees: 15000,
    isThresholdActive: true,
    date: today,
    isSetForToday: false,
  };
};

/**
 * Sets or updates the running bonus rate and threshold start limit for the day.
 * (Super Admin or authorized employees with canSetBonus / canSetThreshold)
 */
export const setRunningDailySettings = async (params: {
  percentage?: number;
  isActive?: boolean;
  thresholdLimitPaise?: number;
  isThresholdActive?: boolean;
  adminId: string;
  adminName: string;
}) => {
  const today = getTodayDateString();
  const current = await getRunningDailyBonusRate();

  const finalPercentage =
    params.percentage !== undefined
      ? Math.max(0, Math.min(100, Number(params.percentage) || 0))
      : current.percentage;

  const finalIsActive =
    params.isActive !== undefined ? Boolean(params.isActive) : current.isActive;

  const finalThresholdPaise =
    params.thresholdLimitPaise !== undefined
      ? Math.max(0, Math.round(Number(params.thresholdLimitPaise) || 0))
      : current.thresholdLimitPaise;

  const finalIsThresholdActive =
    params.isThresholdActive !== undefined
      ? Boolean(params.isThresholdActive)
      : current.isThresholdActive;

  const [dailyRecord] = await prisma.$transaction([
    prisma.dailyBonus.upsert({
      where: { date: today },
      create: {
        date: today,
        percentage: finalPercentage,
        isActive: finalIsActive,
        thresholdLimitPaise: finalThresholdPaise,
        isThresholdActive: finalIsThresholdActive,
        createdById: params.adminId,
        createdByName: params.adminName,
      },
      update: {
        percentage: finalPercentage,
        isActive: finalIsActive,
        thresholdLimitPaise: finalThresholdPaise,
        isThresholdActive: finalIsThresholdActive,
        createdById: params.adminId,
        createdByName: params.adminName,
      },
    }),
    prisma.systemSetting.upsert({
      where: { key: 'running_daily_bonus_rate' },
      create: {
        key: 'running_daily_bonus_rate',
        value: finalIsActive ? String(finalPercentage) : '0',
      },
      update: {
        value: finalIsActive ? String(finalPercentage) : '0',
      },
    }),
    prisma.systemSetting.upsert({
      where: { key: 'running_daily_threshold_paise' },
      create: {
        key: 'running_daily_threshold_paise',
        value: String(finalThresholdPaise),
      },
      update: {
        value: String(finalThresholdPaise),
      },
    }),
  ]);

  return dailyRecord;
};

/**
 * Backward-compatibility wrapper for setRunningDailyBonusRate
 */
export const setRunningDailyBonusRate = async (
  percentage: number,
  adminId: string,
  adminName: string,
  isActive: boolean = true
) => {
  return setRunningDailySettings({
    percentage,
    isActive,
    adminId,
    adminName,
  });
};
