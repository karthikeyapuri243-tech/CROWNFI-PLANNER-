export type TaskPriority = 'High' | 'Medium' | 'Low';

export type TaskCategory = 'Study' | 'Work' | 'Personal' | 'Business' | 'Health' | 'Leisure' | 'Other';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'weekdays' | 'monthly';

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  notes: string;
  priority: TaskPriority;
  category: string;
  dueDate: string; // YYYY-MM-DD
  subtasks: Subtask[];
  isCompleted: boolean;
  completedDates?: string[]; // For recurring tasks, array of completed date strings (YYYY-MM-DD)
  cancelledDates?: string[]; // For recurring tasks, array of cancelled/deleted date strings (YYYY-MM-DD)
  isInbox: boolean; // true if in quick capture inbox, false if task-list or scheduled
  isScheduled: boolean; // true if placed on visual timetable
  startTime: string; // "HH:MM" (e.g. "09:00")
  endTime: string; // "HH:MM" (e.g. "10:30")
  durationMinutes: number; // calculated or manual
  isRecurring: boolean;
  itemType?: 'task' | 'class';
  recurrence?: {
    frequency: RecurrenceFrequency;
    weekdays?: number[]; // 0 = Sunday, 1 = Monday, etc. Only for 'weekly' and 'weekdays'
    endDate?: string; // YYYY-MM-DD
  };
  originalDueDate?: string; // tracks original date to detect rescheduling
  rescheduleCount: number; // tracks how many times rolled forward
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  darkMode: boolean;
  timelineStartHour: number; // e.g. 6 (6 AM)
  timelineEndHour: number; // e.g. 24 (Midnight)
  createdAt: string;
}

export interface Habit {
  id: string;
  userId: string;
  name: string;
  emoji: string;
  category: string;
  scheduleType: 'daily' | 'weekdays' | 'specific_days' | 'flexible';
  weekdays?: number[] | null; // 0 = Sunday, 1 = Monday, etc.
  timesPerWeek?: number | null; // for flexible schedules e.g. 3 times/week
  targetValue?: number | null; // optional target e.g. 30, 10000
  targetUnit?: string | null; // optional unit e.g. "mins", "steps"
  reminderTime?: string | null; // "HH:MM" e.g. "08:00"
  startTime?: string | null; // "HH:MM" for scheduled visual block
  endTime?: string | null; // "HH:MM" for scheduled visual block
  durationMinutes?: number | null;
  isScheduled: boolean; // if true, appears on the schedule
  habitType?: 'start' | 'stop'; // 'start' for starting a new habit, 'stop' for breaking/stopping a bad habit
  startDate?: string | null; // "YYYY-MM-DD" representing the start date of the habit
  endDate?: string | null; // "YYYY-MM-DD" representing the end date of the habit (null or empty for no end date)
  habitStackId?: string | null; // ID of preceding habit for stacking
  allowanceLimit?: number | null; // optional excuse/cheat limit count e.g. 1
  allowancePeriod?: 'week' | 'month' | null; // optional period e.g. 'week' or 'month'
  createdAt: string;
  updatedAt: string;
}

export interface HabitLog {
  id: string; // e.g. `${userId}_${habitId}_${date}`
  userId: string;
  habitId: string;
  date: string; // YYYY-MM-DD
  status: 'completed' | 'skipped' | 'missed' | 'rest' | 'recovery';
  note?: string;
  value?: number; // current value achieved
  createdAt: string;
  failureReason?: string;
}
