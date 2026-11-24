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
 * Retrieves the currently active daily running bonus percentage.
 * Defaults: bonus = 0% (if inactive/unset)
 */
export const getRunningDailyBonusRate = async (): Promise<{
  percentage: number;
  isActive: boolean;
  date: string;
  isSetForToday: boolean;
}> => {
  const today = getTodayDateString();

  try {
    const todayBonus = await prisma.dailyBonus.findUnique({
      where: { date: today },
    });

    if (todayBonus) {
      return {
        percentage: todayBonus.isActive ? todayBonus.percentage : 0.0,
        isActive: todayBonus.isActive,
        date: today,
        isSetForToday: true,
      };
    }

    // Check system setting fallback
    const fallbackBonus = await prisma.systemSetting.findUnique({
      where: { key: 'running_daily_bonus_rate' },
    });

    let fallbackPct = 0.0;
    let fallbackBonusActive = false;
    if (fallbackBonus && fallbackBonus.value) {
      const parsed = parseFloat(fallbackBonus.value);
      if (!isNaN(parsed) && parsed >= 0) {
        fallbackPct = parsed;
        fallbackBonusActive = true;
      }
    }

    return {
      percentage: fallbackPct,
      isActive: fallbackBonusActive,
      date: today,
      isSetForToday: false,
    };
  } catch (error) {
    console.warn('Error reading daily bonus rate:', error);
  }

  return {
    percentage: 0.0,
    isActive: false,
    date: today,
    isSetForToday: false,
  };
};

/**
 * Sets or updates the running bonus rate for the day.
 * (Super Admin or authorized employees with canSetBonus)
 */
export const setRunningDailySettings = async (params: {
  percentage?: number;
  isActive?: boolean;
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

  const [dailyRecord] = await prisma.$transaction([
    prisma.dailyBonus.upsert({
      where: { date: today },
      create: {
        date: today,
        percentage: finalPercentage,
        isActive: finalIsActive,
        createdById: params.adminId,
        createdByName: params.adminName,
      },
      update: {
        percentage: finalPercentage,
        isActive: finalIsActive,
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
  ]);

  return dailyRecord;
};

/**
 * Convenience wrapper
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
