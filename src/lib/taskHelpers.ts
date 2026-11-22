import { Task } from '../types';

/**
 * Safely parses a "YYYY-MM-DD" string into a local Date object.
 * This avoids timezone shifts compared to parsing strings with "T00:00:00" or simple ISO strings.
 */
export function parseDateLocal(dateStr: string): Date {
  const parts = dateStr.trim().split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m - 1, d);
    }
  }
  return new Date(dateStr);
}

/**
 * Checks if a task is scheduled for a given date string (YYYY-MM-DD).
 * Supports standard tasks, scheduled hours, and weekly/daily/monthly recurring tasks.
 */
export function isTaskScheduledForDay(task: Task, dateStr: string): boolean {
  if (!task.isScheduled) return false;
  return isTaskActiveOnDay(task, dateStr);
}

/**
 * Checks if a task is active (either scheduled or as a checklist item) on a given date string (YYYY-MM-DD).
 */
export function isTaskActiveOnDay(task: Task, dateStr: string): boolean {
  if (task.isInbox && !task.isScheduled) return false;

  // Undated tasks should NOT be active on specific calendar days
  if (!task.dueDate || task.dueDate === '') return false;

  // If this specific date has been cancelled/deleted for a recurring task
  if (task.cancelledDates && task.cancelledDates.includes(dateStr)) {
    return false;
  }

  // For recurring tasks, the selected date must be on or after the initial start/due date
  if (task.isRecurring && task.recurrence) {
    if (dateStr < task.dueDate) {
      return false;
    }
    if (task.recurrence.endDate && dateStr > task.recurrence.endDate) {
      return false;
    }
    const date = parseDateLocal(dateStr);
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.

    if (task.recurrence.frequency === 'daily') {
      return true;
    }

    if (task.recurrence.frequency === 'weekly') {
      // If specific weekdays are specified (e.g. weekdays indices)
      if (task.recurrence.weekdays && task.recurrence.weekdays.length > 0) {
        return task.recurrence.weekdays.some(w => Number(w) === dayOfWeek);
      }
      // Fallback: match the same day of the week as the initial start date
      const startDayOfWeek = parseDateLocal(task.dueDate).getDay();
      return dayOfWeek === startDayOfWeek;
    }

    if (task.recurrence.frequency === 'weekdays') {
      if (task.recurrence.weekdays && task.recurrence.weekdays.length > 0) {
        return task.recurrence.weekdays.some(w => Number(w) === dayOfWeek);
      }
      return dayOfWeek >= 1 && dayOfWeek <= 5;
    }

    if (task.recurrence.frequency === 'monthly') {
      const startDayOfMonth = parseDateLocal(task.dueDate).getDate();
      return date.getDate() === startDayOfMonth;
    }
    return false;
  }

  // Non-recurring task: must match the exact due date
  return task.dueDate === dateStr;
}

/**
 * Parses and maps roster/timetable day strings into numerical weekday indices.
 * Supports abbreviations, full names, ranges ("Mon-Fri"), separators (",", "/"), and keywords like "everyday".
 */
export function getWeekdayIndices(daysArray: string[]): number[] {
  const result: number[] = [];
  const map: { [key: string]: number } = {
    sunday: 0, sun: 0, su: 0,
    monday: 1, mon: 1, mo: 1, m: 1,
    tuesday: 2, tue: 2, tues: 2, tu: 2,
    wednesday: 3, wed: 3, we: 3, w: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4, th: 4,
    friday: 5, fri: 5, fr: 5, f: 5,
    saturday: 6, sat: 6, sa: 6
  };

  const getDayIndex = (str: string): number | null => {
    const clean = str.toLowerCase().trim();
    if (map[clean] !== undefined) return map[clean];
    for (const key of Object.keys(map)) {
      if (clean.startsWith(key) || key.startsWith(clean)) {
        return map[key];
      }
    }
    return null;
  };

  for (const rawDay of daysArray) {
    if (!rawDay) continue;
    
    // Check for range like "Mon-Fri" or "Mon to Fri"
    const rangeSeparator = rawDay.includes('-') ? '-' : (rawDay.toLowerCase().includes(' to ') ? ' to ' : null);
    if (rangeSeparator) {
      const parts = rawDay.split(rangeSeparator);
      if (parts.length === 2) {
        const startIdx = getDayIndex(parts[0]);
        const endIdx = getDayIndex(parts[1]);
        if (startIdx !== null && endIdx !== null) {
          let curr = startIdx;
          while (true) {
            if (!result.includes(curr)) {
              result.push(curr);
            }
            if (curr === endIdx) break;
            curr = (curr + 1) % 7;
          }
          continue;
        }
      }
    }

    // Otherwise split by spaces, commas, slashes, semicolons
    const parts = rawDay.split(/[,;/|\s]+/).map(s => s.toLowerCase().trim()).filter(Boolean);
    for (const part of parts) {
      if (part === "everyday" || part === "daily") {
        return [0, 1, 2, 3, 4, 5, 6];
      }
      if (part === "weekdays" || part === "workdays") {
        return [1, 2, 3, 4, 5];
      }
      
      const idx = getDayIndex(part);
      if (idx !== null) {
        if (!result.includes(idx)) {
          result.push(idx);
        }
      }
    }
  }

  return result;
}

/**
 * Standardizes any user/extracted time string (12h AM/PM, irregular spacing, 24h) 
 * into a clean 24-hour "HH:MM" format.
 */
export function parseTimeTo24h(timeStr: string): string {
  if (!timeStr) return '09:00';
  
  let clean = timeStr.toLowerCase().trim();
  const isPM = clean.includes('pm');
  const isAM = clean.includes('am');
  
  clean = clean.replace(/[ap]m/, '').trim();
  
  let hour = 9;
  let minute = 0;
  
  const separators = [':', '.', ' '];
  let parts: string[] = [clean];
  for (const sep of separators) {
    if (clean.includes(sep)) {
      parts = clean.split(sep);
      break;
    }
  }
  
  if (parts.length >= 1) {
    const parsedHour = parseInt(parts[0], 10);
    if (!isNaN(parsedHour)) {
      hour = parsedHour;
    }
  }
  if (parts.length >= 2) {
    const parsedMin = parseInt(parts[1], 10);
    if (!isNaN(parsedMin)) {
      minute = parsedMin;
    }
  } else if (clean.length === 4 && !isNaN(parseInt(clean, 10))) {
    const parsedHour = parseInt(clean.substring(0, 2), 10);
    const parsedMin = parseInt(clean.substring(2, 4), 10);
    if (!isNaN(parsedHour) && !isNaN(parsedMin)) {
      hour = parsedHour;
      minute = parsedMin;
    }
  }
  
  if (isPM && hour < 12) {
    hour += 12;
  } else if (isAM && hour === 12) {
    hour = 0;
  }
  
  if (hour < 0 || hour > 23) hour = 9;
  if (minute < 0 || minute > 59) minute = 0;
  
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

import { Habit, HabitLog } from '../types';

/**
 * Calculates both the current streak and the all-time best streak for a given habit.
 * This is fully timezone-safe and correctly handles 'skipped' statuses.
 */
export function calculateHabitStreaks(habit: Habit, logs: HabitLog[]) {
  const habitLogsForHabit = logs.filter(l => l.habitId === habit.id);
  
  const isHabitScheduledForDay = (h: Habit, dateStr: string) => {
    if (h.startDate && dateStr < h.startDate) return false;
    if (h.endDate && dateStr > h.endDate) return false;
    const date = parseDateLocal(dateStr);
    const dayOfWeek = date.getDay();
    if (h.scheduleType === 'daily') return true;
    if (h.scheduleType === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
    if (h.scheduleType === 'specific_days') return h.weekdays?.some(w => Number(w) === dayOfWeek);
    return true;
  };

  // Generate date strings for the last 365 days up to today (local timezone safe)
  const today = new Date();
  const dates: string[] = [];
  for (let i = 365; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }

  let bestStreak = 0;
  let runningStreak = 0;
  const todayStr = dates[dates.length - 1];

  // Walk forward to calculate best streak of all time
  dates.forEach((dStr) => {
    if (isHabitScheduledForDay(habit, dStr)) {
      const log = habitLogsForHabit.find(l => l.date === dStr);
      if (log) {
        if (log.status === 'completed') {
          runningStreak++;
          if (runningStreak > bestStreak) {
            bestStreak = runningStreak;
          }
        } else if (log.status === 'skipped' || log.status === 'rest' || log.status === 'recovery') {
          // Excused, keep streak running but don't increment
        } else {
          // Missed
          runningStreak = 0;
        }
      } else {
        // No log
        if (dStr !== todayStr) {
          runningStreak = 0;
        }
      }
    }
  });

  // Walk backward to calculate current streak
  let currentStreak = 0;
  let streakDate = new Date();
  for (let i = 0; i < 365; i++) {
    const year = streakDate.getFullYear();
    const month = String(streakDate.getMonth() + 1).padStart(2, '0');
    const day = String(streakDate.getDate()).padStart(2, '0');
    const dStr = `${year}-${month}-${day}`;

    if (isHabitScheduledForDay(habit, dStr)) {
      const log = habitLogsForHabit.find(l => l.date === dStr);
      if (log) {
        if (log.status === 'completed') {
          currentStreak++;
        } else if (log.status === 'skipped' || log.status === 'rest' || log.status === 'recovery') {
          // Excused, keep current streak going
        } else {
          if (i > 0 || dStr !== todayStr) {
            break;
          }
        }
      } else {
        if (i > 0 || dStr !== todayStr) {
          break;
        }
      }
    }
    streakDate.setDate(streakDate.getDate() - 1);
  }

  if (currentStreak > bestStreak) {
    bestStreak = currentStreak;
  }

  return { currentStreak, bestStreak };
}

/**
 * Checks if a task is completed on a specific date (YYYY-MM-DD).
 * For recurring tasks, it checks if the date is in completedDates.
 * For non-recurring tasks, it checks isCompleted.
 */
export function isTaskCompletedOnDay(task: Task, dateStr: string): boolean {
  if (task.isRecurring) {
    return !!(task.completedDates && task.completedDates.includes(dateStr));
  }
  return task.isCompleted;
}



