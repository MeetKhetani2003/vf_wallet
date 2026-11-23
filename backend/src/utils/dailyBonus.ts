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
 * Retrieves the currently active daily running bonus rate.
 * - If Super Admin set a bonus rate for today and isActive is true -> returns that rate (e.g. 10.0)
 * - If no bonus is set for today -> defaults to 0.0 (0%)
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

    // Check system setting for global running bonus fallback
    const fallbackSetting = await prisma.systemSetting.findUnique({
      where: { key: 'running_daily_bonus_rate' },
    });

    if (fallbackSetting && fallbackSetting.value) {
      const parsed = parseFloat(fallbackSetting.value);
      if (!isNaN(parsed) && parsed >= 0) {
        return {
          percentage: parsed,
          isActive: true,
          date: today,
          isSetForToday: false,
        };
      }
    }
  } catch (error) {
    console.warn('Error reading daily bonus rate:', error);
  }

  // Default to 0% if no bonus is configured for the day
  return {
    percentage: 0.0,
    isActive: false,
    date: today,
    isSetForToday: false,
  };
};

/**
 * Sets or updates the running bonus rate for the day.
 * (Super Admin only)
 */
export const setRunningDailyBonusRate = async (
  percentage: number,
  adminId: string,
  adminName: string,
  isActive: boolean = true
) => {
  const today = getTodayDateString();
  const rate = Math.max(0, Math.min(100, Number(percentage) || 0));

  const [dailyRecord] = await prisma.$transaction([
    prisma.dailyBonus.upsert({
      where: { date: today },
      create: {
        date: today,
        percentage: rate,
        isActive,
        createdById: adminId,
        createdByName: adminName,
      },
      update: {
        percentage: rate,
        isActive,
        createdById: adminId,
        createdByName: adminName,
      },
    }),
    prisma.systemSetting.upsert({
      where: { key: 'running_daily_bonus_rate' },
      create: {
        key: 'running_daily_bonus_rate',
        value: isActive ? String(rate) : '0',
      },
      update: {
        value: isActive ? String(rate) : '0',
      },
    }),
  ]);

  return dailyRecord;
};
