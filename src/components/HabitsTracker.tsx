import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Habit, HabitLog, Task } from '../types';
import { createHabit, updateHabit, deleteHabit, saveHabitLog, deleteHabitLog } from '../lib/db';
import { calculateHabitStreaks, parseDateLocal, isTaskActiveOnDay, isTaskCompletedOnDay } from '../lib/taskHelpers';
import { 
  Plus, Check, Flame, Award, Calendar, BookOpen, 
  Trash2, Smile, Settings, ChevronRight, Activity, Clock, Play, X
} from 'lucide-react';

interface HabitsTrackerProps {
  userId: string;
  habits: Habit[];
  habitLogs: HabitLog[];
  selectedDate: string; // YYYY-MM-DD
  tasks?: Task[];
}

export const FAILURE_REASONS = [
  { id: 'tired', label: 'Tired / Lazy', icon: '🥱', color: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-900/40 dark:text-indigo-300' },
  { id: 'busy', label: 'Too Busy', icon: '⏰', color: 'border-sky-200 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:border-sky-900/40 dark:text-sky-300' },
  { id: 'forgot', label: 'Forgot', icon: '🧠', color: 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:bg-zinc-950/40 dark:border-zinc-900/40 dark:text-zinc-300' },
  { id: 'sick', label: 'Sick / Unwell', icon: '🤒', color: 'border-red-200 bg-red-50 text-red-700 dark:bg-red-950/40 dark:border-red-900/40 dark:text-red-300' },
  { id: 'weather', label: 'Bad Weather', icon: '🌧️', color: 'border-slate-200 bg-slate-50 text-slate-700 dark:bg-slate-950/40 dark:border-slate-900/40 dark:text-slate-300' },
  { id: 'distracted', label: 'Distracted', icon: '📱', color: 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:border-amber-900/40 dark:text-amber-300' },
  { id: 'other', label: 'Other', icon: '❌', color: 'border-clay/20 bg-clay/5 text-clay dark:bg-clay/10 dark:border-clay/20' }
];

export default function HabitsTracker({
  userId,
  habits,
  habitLogs,
  selectedDate,
  tasks
}: HabitsTrackerProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [isHeatmapExpanded, setIsHeatmapExpanded] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Custom delete confirmation state
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // New Habit Form States
  const [habitName, setHabitName] = useState('');
  const [habitEmoji, setHabitEmoji] = useState('🧘');
  const [habitCategory, setHabitCategory] = useState('Personal');
  const [habitType, setHabitType] = useState<'start' | 'stop'>('start');
  const [scheduleType, setScheduleType] = useState<'daily' | 'weekdays' | 'specific_days' | 'flexible'>('daily');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri default for weekdays
  const [timesPerWeek, setTimesPerWeek] = useState(3);
  const [targetValue, setTargetValue] = useState<number | ''>('');
  const [targetUnit, setTargetUnit] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [startDate, setStartDate] = useState(selectedDate);
  const [endDate, setEndDate] = useState('');
  const [hasEndDate, setHasEndDate] = useState(false);
  const [habitStackId, setHabitStackId] = useState('');

  // Allowance (Excuse / Cheat Limit) states
  const [allowanceLimit, setAllowanceLimit] = useState<number | ''>('');
  const [allowancePeriod, setAllowancePeriod] = useState<'week' | 'month'>('week');

  // Habit visual timeline tab selection ('14days' vs '6months' per habit)
  const [habitViewRange, setHabitViewRange] = useState<Record<string, '14days' | '6months'>>({});

  // Floating XP Dopamine animations
  const [floatingXps, setFloatingXps] = useState<Array<{ id: string; x: number; y: number; text: string }>>([]);

  const triggerXpEffect = (e: React.MouseEvent | any, xpText: string) => {
    const x = e.clientX || window.innerWidth / 2;
    const y = e.clientY || window.innerHeight / 2;
    const newId = Math.random().toString(36).substring(2, 9);
    setFloatingXps(prev => [...prev, { id: newId, x, y, text: xpText }]);
    setTimeout(() => {
      setFloatingXps(prev => prev.filter(item => item.id !== newId));
    }, 1000);
  };

  // Synchronize start date when selected date changes in the calendar
  useEffect(() => {
    if (!editingHabit) {
      setStartDate(selectedDate);
    }
  }, [selectedDate, editingHabit]);

  // Selected Log notes modal
  const [activeLogModal, setActiveLogModal] = useState<string | null>(null); // habitId for notes/skip modal
  const [logNote, setLogNote] = useState('');
  const [logValue, setLogValue] = useState<number>(0);

  // Selected day for 30-day heatmap inspection
  const [selectedHeatmapDay, setSelectedHeatmapDay] = useState<{
    date: Date;
    dateStr: string;
    scheduledCount: number;
    completedCount: number;
    completionRate: number;
    completedHabitNames: string[];
    pendingHabitNames: string[];
  } | null>(null);

  // Active Month tab selection for 6-month heatmap
  const [activeHeatmapMonth, setActiveHeatmapMonth] = useState<string>('');

  // Listen for custom edit-habit event to open edit modal from other components (like timeline)
  useEffect(() => {
    const handleCustomEditHabit = (e: Event) => {
      const customEvent = e as CustomEvent<Habit>;
      if (customEvent.detail) {
        // Find latest habit from habits array to prevent stale closure data if possible, or fall back to detail
        const currentHabit = habits.find(h => h.id === customEvent.detail.id) || customEvent.detail;
        handleOpenEdit(currentHabit);
      }
    };
    window.addEventListener('aura-edit-habit', handleCustomEditHabit);
    return () => window.removeEventListener('aura-edit-habit', handleCustomEditHabit);
  }, [habits]);

  // Reset form helper
  const resetForm = () => {
    setHabitName('');
    setHabitEmoji('🧘');
    setHabitCategory('Personal');
    setHabitType('start');
    setScheduleType('daily');
    setWeekdays([1, 2, 3, 4, 5]);
    setTimesPerWeek(3);
    setTargetValue('');
    setTargetUnit('');
    setReminderTime('');
    setStartTime('');
    setEndTime('');
    setStartDate(selectedDate);
    setEndDate('');
    setHasEndDate(false);
    setHabitStackId('');
    setAllowanceLimit('');
    setAllowancePeriod('week');
    setEditingHabit(null);
    setIsConfirmingDelete(false);
    setDeleteError(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const handleOpenEdit = (habit: Habit) => {
    setEditingHabit(habit);
    setHabitName(habit.name);
    setHabitEmoji(habit.emoji || '🧘');
    setHabitCategory(habit.category || 'Personal');
    setHabitType(habit.habitType || 'start');
    setScheduleType(habit.scheduleType || 'daily');
    setWeekdays(habit.weekdays || []);
    setTimesPerWeek(habit.timesPerWeek || 3);
    setTargetValue(habit.targetValue !== undefined && habit.targetValue !== null ? habit.targetValue : '');
    setTargetUnit(habit.targetUnit || '');
    setReminderTime(habit.reminderTime || '');
    setStartTime(habit.startTime || '');
    setEndTime(habit.endTime || '');
    setStartDate(habit.startDate || habit.createdAt?.split('T')[0] || selectedDate);
    setEndDate(habit.endDate || '');
    setHasEndDate(!!habit.endDate);
    setHabitStackId(habit.habitStackId || '');
    setAllowanceLimit(habit.allowanceLimit !== undefined && habit.allowanceLimit !== null ? habit.allowanceLimit : '');
    setAllowancePeriod(habit.allowancePeriod || 'week');
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    resetForm();
  };

  const handleSaveHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!habitName.trim()) return;

    let computedDuration = 0;
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      computedDuration = (eh * 60 + em) - (sh * 60 + sm);
      if (computedDuration <= 0) computedDuration = 30; // safety fallback
    }

    const isTargetValueValid = typeof targetValue === 'number' && targetValue > 0;

    const payload: Omit<Habit, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
      name: habitName,
      emoji: habitEmoji,
      category: habitCategory,
      scheduleType,
      weekdays: (scheduleType === 'specific_days' || scheduleType === 'weekdays') ? weekdays : null,
      timesPerWeek: scheduleType === 'flexible' ? timesPerWeek : null,
      targetValue: isTargetValueValid ? targetValue : null,
      targetUnit: isTargetValueValid ? (targetUnit || null) : null,
      reminderTime: reminderTime || null,
      startTime: startTime || null,
      endTime: endTime || null,
      durationMinutes: (startTime && endTime) ? computedDuration : null,
      isScheduled: !!startTime && !!endTime,
      habitType,
      startDate: startDate || selectedDate,
      endDate: hasEndDate && endDate ? endDate : null,
      habitStackId: habitStackId || null,
      allowanceLimit: typeof allowanceLimit === 'number' ? allowanceLimit : null,
      allowancePeriod: typeof allowanceLimit === 'number' ? allowancePeriod : null
    };

    try {
      if (editingHabit) {
        await updateHabit(editingHabit.id, payload);
      } else {
        await createHabit(userId, payload);
      }
      setShowCreateModal(false);
      resetForm();
    } catch (err) {
      console.error('Failed to save habit', err);
    }
  };

  // Check-in or Log custom status
  const handleCheckIn = async (
    habitId: string, 
    status: 'completed' | 'skipped' | 'missed' | 'rest' | 'recovery', 
    val: number = 0, 
    note: string = '',
    failureReason?: string,
    e?: React.MouseEvent | any
  ) => {
    try {
      await saveHabitLog(userId, habitId, selectedDate, status, note, val, failureReason);
      if (status === 'completed' || status === 'rest' || status === 'recovery') {
        if (e) triggerXpEffect(e, "+15 XP");
      }
      setActiveLogModal(null);
      setLogNote('');
      setLogValue(0);
    } catch (err) {
      console.error('Check-in error', err);
    }
  };

  const handleUndoCheckIn = async (habitId: string) => {
    try {
      await deleteHabitLog(userId, habitId, selectedDate);
    } catch (err) {
      console.error(err);
    }
  };

  // Determine if a habit is scheduled for the selectedDate
  const isHabitScheduledForDay = (habit: Habit, dateStr: string) => {
    if (habit.startDate && dateStr < habit.startDate) return false;
    if (habit.endDate && dateStr > habit.endDate) return false;
    const date = parseDateLocal(dateStr);
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.

    if (habit.scheduleType === 'daily') return true;
    if (habit.scheduleType === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
    if (habit.scheduleType === 'specific_days') return habit.weekdays?.some(w => Number(w) === dayOfWeek);
    return true; // fallback for flexible (shows up daily for check-in target)
  };

  // Compute stats for each habit
  const getHabitStats = (habitId: string) => {
    const logs = habitLogs.filter(l => l.habitId === habitId);
    const habitObj = habits.find(h => h.id === habitId);
    
    // Calculate last 30 days rolling completeness score (completed / actual scheduled days)
    const today = new Date();
    let scheduledDaysInLast30 = 0;
    let completedInLast30 = 0;

    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dStr = `${year}-${month}-${day}`;

      if (habitObj && isHabitScheduledForDay(habitObj, dStr)) {
        const log = logs.find(l => l.date === dStr);
        if (log) {
          if (log.status === 'completed' || log.status === 'rest' || log.status === 'recovery') {
            scheduledDaysInLast30++;
            completedInLast30++;
          } else if (log.status === 'skipped') {
            // Skipped: don't count in either to prevent penalizing consistency
          } else {
            // Missed
            scheduledDaysInLast30++;
          }
        } else {
          scheduledDaysInLast30++;
        }
      }
    }

    const consistencyScore = scheduledDaysInLast30 > 0 
      ? Math.round((completedInLast30 / scheduledDaysInLast30) * 100) 
      : 0;

    const { currentStreak } = habitObj ? calculateHabitStreaks(habitObj, habitLogs) : { currentStreak: 0 };

    return { consistencyScore, currentStreak };
  };

  // Compute excuse/cheat limit statistics for a habit
  const getAllowanceStats = (habit: Habit) => {
    if (!habit.allowanceLimit) return null;
    
    const logs = habitLogs.filter(l => l.habitId === habit.id && l.status === 'skipped');
    const refDate = parseDateLocal(selectedDate);
    
    let startDateStr = '';
    let endDateStr = '';
    
    if (habit.allowancePeriod === 'month') {
      const year = refDate.getFullYear();
      const month = String(refDate.getMonth() + 1).padStart(2, '0');
      startDateStr = `${year}-${month}-01`;
      
      const lastDay = new Date(year, refDate.getMonth() + 1, 0).getDate();
      endDateStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    } else {
      const dayOfWeek = refDate.getDay();
      const startOfWeek = new Date(refDate);
      startOfWeek.setDate(refDate.getDate() - dayOfWeek);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      
      const pad = (n: number) => String(n).padStart(2, '0');
      startDateStr = `${startOfWeek.getFullYear()}-${pad(startOfWeek.getMonth() + 1)}-${pad(startOfWeek.getDate())}`;
      endDateStr = `${endOfWeek.getFullYear()}-${pad(endOfWeek.getMonth() + 1)}-${pad(endOfWeek.getDate())}`;
    }
    
    const logsInPeriod = logs.filter(l => l.date >= startDateStr && l.date <= endDateStr);
    const used = logsInPeriod.length;
    const limit = habit.allowanceLimit;
    const period = habit.allowancePeriod || 'week';
    
    return {
      used,
      limit,
      period,
      startDateStr,
      endDateStr,
      isExceeded: used > limit
    };
  };

  // Get active habits for today
  const todaysHabits = useMemo(() => {
    return habits.filter(h => isHabitScheduledForDay(h, selectedDate));
  }, [habits, selectedDate]);

  // Check if all today's habits are completed
  const isAllCompletedToday = useMemo(() => {
    if (todaysHabits.length === 0) return false;
    return todaysHabits.every((habit) => {
      const log = habitLogs.find(l => l.habitId === habit.id && l.date === selectedDate);
      return log && (log.status === 'completed' || log.status === 'rest' || log.status === 'recovery');
    });
  }, [todaysHabits, habitLogs, selectedDate]);

  const prevIsAllCompletedRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const wasCompletedBefore = prevIsAllCompletedRef.current[selectedDate] || false;
    
    if (isAllCompletedToday && !wasCompletedBefore) {
      // Trigger confetti reward burst
      confetti({
        particleCount: 80,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.8 },
        colors: ['#a3b18a', '#585a40', '#dad7cd', '#3a5a40', '#e9c46a']
      });
      confetti({
        particleCount: 80,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.8 },
        colors: ['#a3b18a', '#585a40', '#dad7cd', '#3a5a40', '#e9c46a']
      });

      // Show toast
      const messages = [
        "🌿 Consistency is key! All daily habits completed!",
        "✨ Incredible! You've checked off every habit for today!",
        "🎯 Perfect day! Keep the streak burning bright!",
        "🚀 Outstanding effort! Today's habit goals accomplished!"
      ];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      setToastMessage(randomMessage);
      
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
    
    if (todaysHabits.length > 0) {
      prevIsAllCompletedRef.current[selectedDate] = isAllCompletedToday;
    }
  }, [isAllCompletedToday, selectedDate, todaysHabits.length]);

  // Handle Drag Start
  const handleDragStart = (e: React.DragEvent, habitId: string) => {
    e.dataTransfer.setData('text/plain', habitId);
    e.dataTransfer.setData('type', 'habit');
  };

  // Prepare heatmap coordinates (last 14 days for high-fidelity figures layout)
  const heatmapDates = useMemo(() => {
    const dates = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }, []);

  // Compute 180-day (6-month) comprehensive heatmap data
  const last180DaysData = useMemo(() => {
    const data = [];
    const today = new Date();
    
    for (let i = 179; i >= 0; i--) {
      // Use timestamp subtract to avoid timezone or date-set issues
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dStr = `${year}-${month}-${day}`;
      
      let scheduledCount = 0;
      let completedCount = 0;
      const completedHabitNames: string[] = [];
      const pendingHabitNames: string[] = [];
      
      // Habits count
      habits.forEach(habit => {
        if (isHabitScheduledForDay(habit, dStr)) {
          const log = habitLogs.find(l => l.habitId === habit.id && l.date === dStr);
          if (log) {
            if (log.status === 'completed') {
              scheduledCount++;
              completedCount++;
              completedHabitNames.push(`${habit.emoji} ${habit.name}`);
            } else if (log.status === 'rest' || log.status === 'recovery') {
              scheduledCount++;
              completedCount++;
              completedHabitNames.push(`${log.status === 'rest' ? '💤' : '🩹'} ${habit.name} (${log.status === 'rest' ? 'Rest Day' : 'Recovery Day'})`);
            } else if (log.status === 'skipped') {
              // Exclude skipped from both scheduled and completed so consistency is unaffected
            } else {
              scheduledCount++;
              pendingHabitNames.push(`${habit.emoji} ${habit.name}`);
            }
          } else {
            scheduledCount++;
            pendingHabitNames.push(`${habit.emoji} ${habit.name}`);
          }
        }
      });

      // Tasks count
      if (tasks) {
        tasks.forEach(task => {
          if (isTaskActiveOnDay(task, dStr)) {
            scheduledCount++;
            if (isTaskCompletedOnDay(task, dStr)) {
              completedCount++;
              completedHabitNames.push(`📝 ${task.title}`);
            } else {
              pendingHabitNames.push(`📝 ${task.title}`);
            }
          }
        });
      }
      
      const completionRate = scheduledCount > 0 ? (completedCount / scheduledCount) * 100 : 0;
      
      data.push({
        date: d,
        dateStr: dStr,
        scheduledCount,
        completedCount,
        completionRate,
        completedHabitNames,
        pendingHabitNames
      });
    }
    return data;
  }, [habits, habitLogs, tasks]);

  // Aligns the 180 days to start precisely on the correct weekday columns of a weekly calendar grid
  const calendarHeatmapCells = useMemo(() => {
    if (last180DaysData.length === 0) return [];
    
    // Day of the week of the oldest day (e.g., 0 = Sunday, 1 = Monday, etc.)
    const firstDayWeekday = last180DaysData[0].date.getDay();
    
    const dummyPre = Array.from({ length: firstDayWeekday }).map((_, i) => ({
      isDummy: true,
      key: `dummy-pre-${i}`
    }));
    
    const mainDays = last180DaysData.map(day => ({
      ...day,
      isDummy: false,
      key: day.dateStr
    }));
    
    const totalCells = dummyPre.length + mainDays.length;
    const remainder = totalCells % 7;
    const dummyPost = remainder > 0 
      ? Array.from({ length: 7 - remainder }).map((_, i) => ({
          isDummy: true,
          key: `dummy-post-${i}`
        }))
      : [];
      
    return [...dummyPre, ...mainDays, ...dummyPost];
  }, [last180DaysData]);

  // Group 180 days by Month for structured, gorgeous multi-month grids
  const monthsData = useMemo(() => {
    const groups: Record<string, { name: string; cells: any[] }> = {};
    
    last180DaysData.forEach(day => {
      const year = day.date.getFullYear();
      const monthNum = String(day.date.getMonth() + 1).padStart(2, '0');
      const monthKey = `${year}-${monthNum}`;
      const monthName = day.date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      
      if (!groups[monthKey]) {
        groups[monthKey] = {
          name: monthName,
          cells: []
        };
      }
      groups[monthKey].cells.push(day);
    });

    const sortedKeys = Object.keys(groups).sort().reverse(); // Newest month first
    return sortedKeys.map(key => {
      const group = groups[key];
      // Pad beginning of the month so Sunday aligns correctly
      const firstCell = group.cells[0];
      const firstDayWeekday = firstCell.date.getDay();

      const dummyPre = Array.from({ length: firstDayWeekday }).map((_, i) => ({
        isDummy: true,
        key: `dummy-pre-${key}-${i}`
      }));

      const mainCells = group.cells.map(day => ({
        ...day,
        isDummy: false,
        key: day.dateStr
      }));

      return {
        key,
        name: group.name,
        cells: [...dummyPre, ...mainCells]
      };
    });
  }, [last180DaysData]);

  // Synchronize default active heatmap month
  useEffect(() => {
    if (monthsData.length > 0 && !activeHeatmapMonth) {
      setActiveHeatmapMonth(monthsData[0].key);
    }
  }, [monthsData, activeHeatmapMonth]);

  return (
    <div className="bg-cardbg border border-natborder rounded-3xl p-5 shadow-xs space-y-4" id="habits-tracker-container">
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-clay/10 text-clay">
            <Activity className="w-4.5 h-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-nattext">Daily Habits</h3>
            <p className="text-[10px] text-natmuted">Build long-term consistency</p>
          </div>
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-clay/10 hover:bg-clay text-clay hover:text-white transition-all text-xs font-bold cursor-pointer"
          id="btn-add-habit"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      {todaysHabits.length === 0 ? (
        <div className="py-6 text-center border border-dashed border-natborder rounded-2xl bg-paper/40 shrink-0">
          <p className="text-xs text-natmuted italic">No habits scheduled for today.</p>
          <button 
            onClick={handleOpenCreate} 
            className="text-xs font-semibold text-clay hover:underline mt-1 cursor-pointer"
          >
            Create your first habit
          </button>
        </div>
      ) : (
        <div className="space-y-3.5 max-h-[400px] overflow-y-auto pr-1.5 scrollbar-thin" id="todays-habits-list">
          {todaysHabits.map((habit) => {
            const todayLog = habitLogs.find(l => l.habitId === habit.id && l.date === selectedDate);
            const { consistencyScore, currentStreak } = getHabitStats(habit.id);

            // Stacking preceding habit if any
            const precedingHabit = habit.habitStackId ? habits.find(h => h.id === habit.habitStackId) : null;

            const actionButtons = todayLog ? (
              <div className="flex items-center gap-1">
                {(() => {
                  let btnStyle = "bg-emerald-600 text-white border-emerald-700 hover:bg-clay hover:border-clay/80";
                  let btnIcon = <Check className="w-4 h-4 stroke-[3px]" />;
                  let btnTitle = "Check-in Complete! Tap to undo.";

                  if (todayLog.status === 'skipped') {
                    btnStyle = "bg-amber-500 text-white border-amber-600 hover:bg-clay hover:border-clay/80";
                    btnIcon = <span className="text-xs font-bold leading-none">🟡</span>;
                    btnTitle = "Habit Skipped! Tap to undo.";
                  } else if (todayLog.status === 'rest') {
                    btnStyle = "bg-blue-600 text-white border-blue-700 hover:bg-clay hover:border-clay/80";
                    btnIcon = <span className="text-xs font-bold leading-none">💤</span>;
                    btnTitle = "Rest Day! Tap to undo.";
                  } else if (todayLog.status === 'recovery') {
                    btnStyle = "bg-purple-600 text-white border-purple-700 hover:bg-clay hover:border-clay/80";
                    btnIcon = <span className="text-xs font-bold leading-none">🩹</span>;
                    btnTitle = "Recovery Day! Tap to undo.";
                  } else if (todayLog.status === 'missed') {
                    btnStyle = "bg-clay text-white border-clay/80 hover:bg-paper hover:text-nattext hover:border-natborder";
                    const reasonObj = FAILURE_REASONS.find(r => r.id === todayLog.failureReason);
                    btnIcon = <span className="text-sm font-bold leading-none shrink-0 select-none">{reasonObj?.icon || '❌'}</span>;
                    btnTitle = `Failed: ${reasonObj ? reasonObj.label : 'Missed'}! Tap to undo.`;
                  }

                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUndoCheckIn(habit.id);
                      }}
                      className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center shadow-3xs ${btnStyle}`}
                      title={btnTitle}
                    >
                      {btnIcon}
                    </button>
                  );
                })()}
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenEdit(habit);
                  }}
                  className="p-2 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext transition-all cursor-pointer bg-cardbg shadow-3xs"
                  title="Edit Habit Settings"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCheckIn(habit.id, 'completed', habit.targetValue || 0, '', undefined, e);
                  }}
                  className="p-2 rounded-xl border border-natborder hover:border-emerald-200 hover:bg-emerald-50 text-natmuted hover:text-emerald-700 transition-all cursor-pointer bg-cardbg shadow-3xs"
                  title="One-Tap Check-in"
                >
                  <Check className="w-4 h-4" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveLogModal(habit.id);
                    setLogValue(habit.targetValue || 0);
                    setLogNote('');
                  }}
                  className="p-2 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext transition-all cursor-pointer bg-cardbg shadow-3xs"
                  title="Detailed options (Notes, Skip, Missed)"
                >
                  <Award className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenEdit(habit);
                  }}
                  className="p-2 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext transition-all cursor-pointer bg-cardbg shadow-3xs"
                  title="Edit Habit Settings"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </div>
            );

            return (
              <div 
                key={habit.id}
                draggable
                onDragStart={(e) => handleDragStart(e, habit.id)}
                className={`group relative p-3.5 rounded-2xl border transition-all cursor-grab active:cursor-grabbing hover:shadow-2xs ${
                  todayLog?.status === 'completed'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-950 dark:text-emerald-300'
                    : todayLog?.status === 'skipped'
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-900 dark:text-amber-300'
                      : todayLog?.status === 'rest'
                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-950 dark:text-blue-300'
                        : todayLog?.status === 'recovery'
                          ? 'bg-purple-500/10 border-purple-500/20 text-purple-950 dark:text-purple-300'
                          : todayLog?.status === 'missed'
                            ? 'bg-clay/5 border-clay/20 text-natmuted opacity-60'
                            : 'bg-cardbg border-natborder'
                }`}
                title="Drag to schedule on timeline!"
              >
                {/* Drag handle anchored to top left */}
                <div className="absolute left-2.5 top-[18px] flex flex-col gap-0.5 opacity-30 group-hover:opacity-100 cursor-grab select-none">
                  <span className="text-[11px] font-bold">⋮</span>
                </div>

                <div className="pl-3.5 flex flex-col gap-3.5 w-full">
                  {/* Top Header Row: Emoji, Name, Badges, and Action Buttons */}
                  <div className="flex items-start justify-between gap-3 w-full">
                    <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                      <span className="text-lg select-none shrink-0">{habit.emoji || "🌱"}</span>
                      <h4 className="font-bold text-xs leading-tight text-nattext truncate max-w-[150px] sm:max-w-[240px]" title={habit.name || "Untitled Habit"}>
                        {habit.name || "Untitled Habit"}
                      </h4>
                      
                      {/* Clean typographic metadata block */}
                      <div className="flex items-center gap-1.5 text-[10px] text-natmuted font-medium flex-wrap select-none shrink-0">
                        {todayLog?.status === 'rest' ? (
                          <span className="text-blue-600 dark:text-blue-400 font-bold flex items-center gap-0.5 whitespace-nowrap">
                            💤 Rest Day
                          </span>
                        ) : todayLog?.status === 'recovery' ? (
                          <span className="text-purple-600 dark:text-purple-400 font-bold flex items-center gap-0.5 whitespace-nowrap">
                            🩹 Recovery Day
                          </span>
                        ) : todayLog?.status === 'skipped' ? (
                          <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-0.5 whitespace-nowrap">
                            🟡 Skipped
                          </span>
                        ) : todayLog?.status === 'missed' ? (
                          (() => {
                            const reasonObj = FAILURE_REASONS.find(r => r.id === todayLog.failureReason);
                            return (
                              <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-0.5 whitespace-nowrap">
                                ❌ {reasonObj ? reasonObj.label : 'Missed'}
                              </span>
                            );
                          })()
                        ) : habit.habitType === 'stop' ? (
                          <span className="text-clay font-bold flex items-center gap-0.5 whitespace-nowrap">
                            🚫 Break Habit
                          </span>
                        ) : (
                          <span className="text-olive font-bold flex items-center gap-0.5 whitespace-nowrap">
                            🌱 New Habit
                          </span>
                        )}
                        {habit.startTime && (
                          <>
                            <span aria-hidden="true" className="text-natborder/50">·</span>
                            <span className="text-olive font-semibold font-mono flex items-center gap-0.5 whitespace-nowrap">
                              <Clock className="w-2.5 h-2.5 shrink-0" />
                              {habit.startTime}
                            </span>
                          </>
                        )}
                        {precedingHabit && (
                          <>
                            <span aria-hidden="true" className="text-natborder/50">·</span>
                            <span className="text-clay font-bold flex items-center gap-0.5 whitespace-nowrap" title={`Stacked after ${precedingHabit.name}`}>
                              <Play className="w-2 h-2 fill-clay shrink-0" />
                              Stack: {precedingHabit.emoji} {precedingHabit.name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Aligned actionButtons at top-right */}
                    <div className="shrink-0 flex items-center">
                      {actionButtons}
                    </div>
                  </div>

                  {/* Target & Note Row */}
                  {(habit.targetValue || todayLog?.note) && (
                    <div className="flex items-center gap-3 text-[10px] text-natmuted -mt-2 pl-0.5">
                      {habit.targetValue && (
                        <span>
                          Target: <strong className="font-bold">{habit.targetValue} {habit.targetUnit}</strong>
                        </span>
                      )}
                      {todayLog?.note && (
                        <span className="italic text-clay max-w-[220px] truncate" title={todayLog.note}>
                          "{todayLog.note}"
                        </span>
                      )}
                    </div>
                  )}

                  <div className="space-y-1 flex-1">
                    {/* Progress Section with Toggle & Allowance/Excuse Limits */}
                    <div className="mt-3 pt-2.5 border-t border-natborder/40 flex flex-col gap-1.5" id={`habit-progress-${habit.id}`}>
                      <div className="flex items-center justify-between text-[10px] font-semibold text-natmuted">
                        <span className="flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5 text-clay shrink-0" />
                          <span>Progress Timeline</span>
                          
                          {/* View range toggle buttons */}
                          <span className="inline-flex rounded-md bg-paper p-0.5 border border-natborder/40 ml-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHabitViewRange(prev => ({ ...prev, [habit.id]: '14days' }));
                              }}
                              className={`px-1 py-0.5 text-[8px] rounded-xs font-bold transition-all ${
                                (habitViewRange[habit.id] || '14days') === '14days'
                                  ? 'bg-clay text-white shadow-3xs'
                                  : 'text-natmuted hover:text-nattext'
                              }`}
                            >
                              14D
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHabitViewRange(prev => ({ ...prev, [habit.id]: '6months' }));
                              }}
                              className={`px-1 py-0.5 text-[8px] rounded-xs font-bold transition-all ${
                                habitViewRange[habit.id] === '6months'
                                  ? 'bg-clay text-white shadow-3xs'
                                  : 'text-natmuted hover:text-nattext'
                              }`}
                            >
                              6M
                            </button>
                          </span>
                        </span>

                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {/* Allowance Stats Chip */}
                          {(() => {
                            const allowance = getAllowanceStats(habit);
                            if (!allowance) return null;
                            const isExceeded = allowance.used > allowance.limit;
                            const isNearLimit = allowance.used === allowance.limit;
                            let colorClass = "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30";
                            let icon = "✅";
                            if (isExceeded) {
                              colorClass = "bg-red-50 text-clay border-red-200 dark:bg-red-950/20 dark:text-clay/90 dark:border-red-900/30 font-extrabold animate-pulse";
                              icon = "🚨";
                            } else if (isNearLimit) {
                              colorClass = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30 font-bold";
                              icon = "⚠️";
                            }
                            return (
                              <span 
                                className={`px-1.5 py-0.5 rounded-md border text-[9px] flex items-center gap-0.5 ${colorClass}`}
                                title={`Limit: ${allowance.limit} excuses per ${allowance.period}. Range: ${allowance.startDateStr} to ${allowance.endDateStr}`}
                              >
                                <span>{icon}</span>
                                <span>Excuses: {allowance.used}/{allowance.limit} {allowance.period === 'week' ? 'this wk' : 'this mo'}</span>
                              </span>
                            );
                          })()}

                          <span className="bg-emerald-50 px-1.5 py-0.5 rounded-sm text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 font-bold">
                            {consistencyScore}% consistency
                          </span>
                          {currentStreak > 0 && (
                            <span className="bg-amber-50 px-1.5 py-0.5 rounded-sm text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 font-bold flex items-center gap-0.5">
                              🔥 {currentStreak}d streak
                            </span>
                          )}
                        </div>
                      </div>

                      {habitViewRange[habit.id] === '6months' ? (
                        /* Mini 6-Month dot grid */
                        <div className="flex flex-col gap-1 bg-paper/25 rounded-xl p-2 border border-natborder/30 mt-1">
                          <div className="flex items-center justify-between text-[8px] text-natmuted font-semibold leading-none mb-1">
                            <span>Oldest (6M ago)</span>
                            <span className="flex items-center gap-1.5 scale-90">
                              <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Done</span>
                              <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Skip</span>
                              <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Rest</span>
                              <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Miss</span>
                            </span>
                            <span>Today</span>
                          </div>
                          
                          <div className="flex gap-1">
                            {/* Weekday indicator */}
                            <div className="flex flex-col justify-between text-[7px] text-natmuted/60 uppercase font-extrabold shrink-0 select-none py-0.5 h-14 leading-none pr-1">
                              <span>S</span>
                              <span>M</span>
                              <span>T</span>
                              <span>W</span>
                              <span>T</span>
                              <span>F</span>
                              <span>S</span>
                            </div>

                            {/* Scrollable mini dot grid */}
                            <div className="flex-1 overflow-x-auto pb-0.5 scrollbar-thin scrollbar-thumb-natborder/40">
                              <div className="grid grid-flow-col grid-rows-7 gap-0.5 h-14 min-w-[500px]">
                                {calendarHeatmapCells.map((cell) => {
                                  if (cell.isDummy) {
                                    return (
                                      <div 
                                        key={cell.key} 
                                        className="w-1.5 h-1.5 rounded-[1px] bg-transparent opacity-5" 
                                      />
                                    );
                                  }

                                  const { date, dateStr } = cell as any;
                                  const log = habitLogs.find(l => l.habitId === habit.id && l.date === dateStr);
                                  const isScheduled = isHabitScheduledForDay(habit, dateStr);

                                  let dotClass = "bg-paper/30 border border-natborder/10 opacity-30";
                                  let tooltipText = `${dateStr}: Off day`;

                                  if (isScheduled) {
                                    tooltipText = `${dateStr}: Scheduled (Pending)`;
                                    dotClass = "bg-paper/70 border border-natborder/35";
                                    if (log) {
                                      if (log.status === 'completed') {
                                        dotClass = "bg-emerald-500 border border-emerald-600 shadow-3xs";
                                        tooltipText = `${dateStr}: Completed`;
                                      } else if (log.status === 'skipped') {
                                        dotClass = "bg-amber-400 border border-amber-500";
                                        tooltipText = `${dateStr}: Skipped (Excuse)`;
                                      } else if (log.status === 'rest') {
                                        dotClass = "bg-blue-500 border border-blue-600";
                                        tooltipText = `${dateStr}: Rest Day`;
                                      } else if (log.status === 'recovery') {
                                        dotClass = "bg-purple-500 border border-purple-600";
                                        tooltipText = `${dateStr}: Recovery Day`;
                                      } else if (log.status === 'missed') {
                                        dotClass = "bg-red-400 border border-red-500";
                                        tooltipText = `${dateStr}: Missed`;
                                      }
                                    }
                                  }

                                  const isSelected = dateStr === selectedDate;

                                  return (
                                    <div
                                      key={cell.key}
                                      className={`w-1.5 h-1.5 rounded-[1px] relative group transition-all ${dotClass} ${
                                        isSelected ? 'ring-1 ring-clay scale-110 z-10' : ''
                                      }`}
                                      title={tooltipText}
                                    >
                                      {/* Floating Micro Tooltip */}
                                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 w-32 bg-nattext text-cardbg text-[8px] p-1 rounded shadow-md pointer-events-none text-center">
                                        <p className="font-bold text-white dark:text-gray-900 leading-none">{dateStr}</p>
                                        <p className="mt-0.5 text-gray-200 dark:text-gray-700">{tooltipText.split(': ')[1]}</p>
                                        {log?.note && <p className="mt-0.5 text-[7px] italic text-emerald-200 truncate">"{log.note}"</p>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Timeline figures */
                        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1 scrollbar-none">
                          {heatmapDates.map((dateStr) => {
                            const log = habitLogs.find(l => l.habitId === habit.id && l.date === dateStr);
                            const isScheduled = isHabitScheduledForDay(habit, dateStr);
                            
                            const dateObj = new Date(dateStr + 'T00:00:00');
                            const dayLetter = dateObj.toLocaleDateString('en-US', { weekday: 'narrow' });
                            const dayNum = dateObj.getDate();
                            const isSelectedDate = dateStr === selectedDate;

                            let nodeContent = null;
                            let nodeClass = '';
                            let tooltip = `${dateStr}: Not scheduled (off day)`;

                            if (isScheduled) {
                              if (log) {
                                if (log.status === 'completed') {
                                  nodeClass = 'bg-emerald-500 border border-emerald-600 text-white shadow-xs shadow-emerald-500/20';
                                  nodeContent = <Check className="w-2.5 h-2.5 stroke-[4px]" />;
                                  tooltip = `${dateStr}: Completed`;
                                } else if (log.status === 'skipped') {
                                  nodeClass = 'bg-amber-50 border border-amber-300 text-amber-600 dark:bg-amber-950/30 dark:border-amber-900/40';
                                  nodeContent = <span className="text-[9px] font-bold">🟡</span>;
                                  tooltip = `${dateStr}: Skipped`;
                                } else if (log.status === 'rest') {
                                  nodeClass = 'bg-blue-50 border border-blue-200 text-blue-600 dark:bg-blue-950/30 dark:border-blue-900/40';
                                  nodeContent = <span className="text-[10px] leading-none select-none">💤</span>;
                                  tooltip = `${dateStr}: Rest Day`;
                                } else if (log.status === 'recovery') {
                                  nodeClass = 'bg-purple-50 border border-purple-200 text-purple-600 dark:bg-purple-950/30 dark:border-purple-900/40';
                                  nodeContent = <span className="text-[10px] leading-none select-none">🩹</span>;
                                  tooltip = `${dateStr}: Recovery Day`;
                                } else if (log.status === 'missed') {
                                  const reasonObj = FAILURE_REASONS.find(r => r.id === log.failureReason);
                                  nodeClass = 'bg-red-50 border border-red-200 text-red-600 dark:bg-red-950/30 dark:border-red-900/40 shadow-2xs';
                                  nodeContent = <span className="text-xs leading-none shrink-0 select-none">{reasonObj?.icon || '❌'}</span>;
                                  tooltip = `${dateStr}: Failed (${reasonObj ? reasonObj.label : 'Missed'})`;
                                }
                              } else {
                                // Scheduled but no log yet (pending/untracked)
                                nodeClass = 'bg-sand/10 border border-sand/30 dark:bg-zinc-800/20 dark:border-zinc-700/30 text-natmuted/40';
                                nodeContent = <span className="text-[9px] font-bold leading-none select-none">•</span>;
                                tooltip = `${dateStr}: Scheduled (Pending)`;
                              }
                            } else {
                              // Off day (not scheduled)
                              nodeClass = 'bg-transparent border border-dashed border-natborder/40 opacity-40 text-natmuted/20';
                              nodeContent = <span className="text-[9px] leading-none select-none">·</span>;
                            }

                            return (
                              <div 
                                key={dateStr}
                                className={`flex flex-col items-center gap-1 ${isSelectedDate ? 'scale-105 font-bold' : ''}`}
                                title={tooltip}
                              >
                                <span className={`text-[8px] tracking-tight ${isSelectedDate ? 'text-clay font-extrabold' : 'text-natmuted/60'}`}>
                                  {dayLetter}{dayNum}
                                </span>
                                <div 
                                  className={`w-5.5 h-5.5 rounded-full flex items-center justify-center transition-all ${nodeClass} ${
                                    isSelectedDate ? 'ring-2 ring-clay/40 ring-offset-1 ring-offset-paper' : ''
                                  }`}
                                >
                                  {nodeContent}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 6-MONTH COMPLETION HEATMAP VIEW */}
      <div className="border-t border-natborder/60 pt-4 mt-4 space-y-3 shrink-0" id="habits-heatmap-section">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-clay" />
            <h4 className="text-xs font-bold text-nattext">6-Month Completion Heatmap</h4>
          </div>
          
          <button
            type="button"
            onClick={() => setIsHeatmapExpanded(!isHeatmapExpanded)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-bold text-clay bg-clay/10 hover:bg-clay hover:text-white transition-all cursor-pointer select-none"
          >
            <span>{isHeatmapExpanded ? 'Hide' : 'Show'} Heatmap</span>
          </button>
        </div>

        {isHeatmapExpanded ? (
          <div className="space-y-3 animate-slide-in">
            {/* Legend */}
            <div className="flex items-center justify-between text-[9px] text-natmuted">
              <span className="font-semibold uppercase tracking-wider text-[8px]">Consistency</span>
              <div className="flex items-center gap-1">
                <span>Less</span>
                <div className="w-2.5 h-2.5 rounded-[3px] bg-paper border border-natborder/40" title="No Habits" />
                <div className="w-2.5 h-2.5 rounded-[3px] bg-paper border border-natborder/70" title="0% complete" />
                <div className="w-2.5 h-2.5 rounded-[3px] bg-emerald-500/15 border border-emerald-500/10" title="1-33% complete" />
                <div className="w-2.5 h-2.5 rounded-[3px] bg-emerald-500/40 border border-emerald-500/30" title="34-66% complete" />
                <div className="w-2.5 h-2.5 rounded-[3px] bg-emerald-500/70 border border-emerald-500/60" title="67-99% complete" />
                <div className="w-2.5 h-2.5 rounded-[3px] bg-emerald-500 border border-emerald-600" title="100% complete" />
                <span>More</span>
              </div>
            </div>

            {/* Month Selection Tabs */}
            <div className="flex gap-1 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-natborder/20" id="heatmap-month-tabs">
              {monthsData.map((m) => {
                const isActive = activeHeatmapMonth === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => {
                      setActiveHeatmapMonth(m.key);
                      setSelectedHeatmapDay(null);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all whitespace-nowrap cursor-pointer select-none ${
                      isActive
                        ? 'bg-clay text-white shadow-xs'
                        : 'bg-paper/70 text-natmuted hover:bg-paper border border-natborder/30 hover:border-natborder/80'
                    }`}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>

            {/* Selected Month Calendar Container */}
            {(() => {
              const currentMonth = monthsData.find(m => m.key === activeHeatmapMonth) || monthsData[0];
              if (!currentMonth) return null;

              return (
                <div className="bg-paper/30 border border-natborder/60 rounded-2xl p-4 space-y-3.5 transition-all">
                  {/* Weekday labels */}
                  <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-extrabold text-natmuted/80 uppercase tracking-wider">
                    <span>Sun</span>
                    <span>Mon</span>
                    <span>Tue</span>
                    <span>Wed</span>
                    <span>Thu</span>
                    <span>Fri</span>
                    <span>Sat</span>
                  </div>

                  {/* Grid Cells */}
                  <div className="grid grid-cols-7 gap-2">
                    {currentMonth.cells.map((cell: any) => {
                      if (cell.isDummy) {
                        return (
                          <div 
                            key={cell.key} 
                            className="aspect-square rounded-xl border border-dashed border-natborder/15 bg-transparent/5 opacity-10" 
                          />
                        );
                      }

                      const {
                        date,
                        dateStr,
                        scheduledCount,
                        completedCount,
                        completionRate,
                        completedHabitNames,
                        pendingHabitNames
                      } = cell;

                      const isSelected = selectedHeatmapDay?.dateStr === dateStr;

                      // Compute cell classes based on scheduled & completed counts with perfect dark-mode contrast
                      let cellClass = "";
                      let titleText = "";
                      
                      const dayLabel = date.toLocaleDateString(undefined, { 
                        weekday: 'short', 
                        month: 'short', 
                        day: 'numeric' 
                      });

                      if (scheduledCount === 0) {
                        cellClass = "bg-paper/30 border border-natborder/20 opacity-35 hover:opacity-100 cursor-help text-natmuted/60";
                        titleText = `${dayLabel}: No scheduled focus`;
                      } else {
                        titleText = `${dayLabel}: ${completedCount}/${scheduledCount} completed (${Math.round(completionRate)}%)`;
                        if (completionRate === 0) {
                          cellClass = "bg-paper border border-natborder hover:border-clay cursor-pointer text-natmuted";
                        } else if (completionRate <= 33) {
                          cellClass = "bg-emerald-500/15 border border-emerald-500/20 hover:scale-105 cursor-pointer text-emerald-800 dark:text-emerald-300 font-bold";
                        } else if (completionRate <= 66) {
                          cellClass = "bg-emerald-500/40 border border-emerald-500/30 hover:scale-105 cursor-pointer text-emerald-950 dark:text-emerald-200 font-black";
                        } else if (completionRate < 100) {
                          cellClass = "bg-emerald-500/75 border border-emerald-500/65 hover:scale-105 cursor-pointer text-white dark:text-emerald-50 font-black";
                        } else {
                          cellClass = "bg-emerald-500 border border-emerald-600 shadow-3xs hover:scale-110 cursor-pointer text-white font-black";
                        }
                      }

                      if (isSelected) {
                        cellClass += " ring-2 ring-clay ring-offset-2 ring-offset-cardbg scale-110 z-10 shadow-xs";
                      }

                      return (
                        <button
                          type="button"
                          key={cell.key}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (scheduledCount > 0) {
                              setSelectedHeatmapDay(isSelected ? null : cell);
                            }
                          }}
                          className={`aspect-square rounded-xl transition-all duration-200 flex flex-col items-center justify-center relative group select-none ${cellClass}`}
                          title={titleText}
                        >
                          <span className="text-[11px] leading-none">{date.getDate()}</span>
                          
                          {/* Floating Micro Custom Tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 w-44 bg-nattext text-paper text-[10px] p-2.5 rounded-xl shadow-lg pointer-events-none text-center border border-natborder/20">
                            <p className="font-bold text-white dark:text-gray-900 leading-none">{dayLabel}</p>
                            <p className="mt-1 text-gray-200 dark:text-gray-700">
                              {scheduledCount === 0 
                                ? 'No focus scheduled' 
                                : `${completedCount} of ${scheduledCount} done (${Math.round(completionRate)}%)`
                              }
                            </p>
                            {completedCount > 0 && (
                              <p className="text-emerald-300 dark:text-emerald-400 mt-1 truncate font-medium">
                                ✔ {completedHabitNames.slice(0, 2).map((name: string) => name.split(' ').slice(1).join(' ') || name).join(', ')}
                              </p>
                            )}
                            <div className="w-1.5 h-1.5 bg-nattext absolute top-full left-1/2 -translate-x-1/2 -translate-y-0.5 rotate-45 border-r border-b border-natborder/20" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

        {/* Selected Heatmap Day Details Box */}
        <AnimatePresence>
          {selectedHeatmapDay && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden bg-clay/5 border border-clay/10 rounded-2xl p-3 space-y-2.5"
              id="selected-heatmap-day-details"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-clay uppercase tracking-wider">
                  Details for {selectedHeatmapDay.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedHeatmapDay(null)}
                  className="text-[10px] font-semibold text-natmuted hover:text-clay cursor-pointer"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                {/* Completed */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1 font-bold text-emerald-800 dark:text-emerald-400 text-[10px] uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Completed ({selectedHeatmapDay.completedCount})
                  </div>
                  {selectedHeatmapDay.completedHabitNames.length > 0 ? (
                    <ul className="space-y-1 pl-1">
                      {selectedHeatmapDay.completedHabitNames.map((name: string, i: number) => (
                        <li key={i} className="text-nattext/90 flex items-center gap-1 text-[11px] truncate" title={name}>
                          <span>✔</span>
                          <span className="truncate">{name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[10px] text-natmuted italic pl-1">None completed</p>
                  )}
                </div>

                {/* Pending / Missed */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1 font-bold text-clay text-[10px] uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-clay" />
                    Incomplete / Pending ({selectedHeatmapDay.scheduledCount - selectedHeatmapDay.completedCount})
                  </div>
                  {selectedHeatmapDay.pendingHabitNames.length > 0 ? (
                    <ul className="space-y-1 pl-1">
                      {selectedHeatmapDay.pendingHabitNames.map((name: string, i: number) => (
                        <li key={i} className="text-nattext/90 flex items-center gap-1 text-[11px] truncate" title={name}>
                          <span className="text-natmuted/50">○</span>
                          <span className="truncate">{name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[10px] text-emerald-800 dark:text-emerald-400 italic pl-1">All habits completed! 🎉</p>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
          </div>
        ) : null}
      </div>
      {activeLogModal && createPortal(
        <div className="fixed inset-0 z-50 overflow-y-auto">
          {/* Backdrop */}
          <div 
            onClick={() => setActiveLogModal(null)}
            className="fixed inset-0 bg-black/40 backdrop-blur-xs cursor-pointer"
          />
          {/* Content Wrapper */}
          <div className="flex min-h-full items-center justify-center p-4">
            <div 
              onClick={(e) => e.stopPropagation()}
              className="relative bg-cardbg border border-natborder rounded-3xl p-5 shadow-lg max-w-sm w-full space-y-4 z-10"
            >
              <h4 className="text-sm font-bold text-nattext">Habit Logging Options</h4>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                    Value/Progress reached
                  </label>
                  <input
                    type="number"
                    value={logValue}
                    onChange={(e) => setLogValue(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay"
                    placeholder="e.g. 30"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                    Quick Note / Reflection
                  </label>
                  <input
                    type="text"
                    value={logNote}
                    onChange={(e) => setLogNote(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay"
                    placeholder="e.g. Felt highly energetic today"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <button
                  onClick={(e) => handleCheckIn(activeLogModal, 'completed', logValue, logNote, undefined, e)}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  <Check className="w-4 h-4 stroke-[3px]" />
                  <span>Mark Completed</span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={(e) => handleCheckIn(activeLogModal, 'rest', logValue, logNote, undefined, e)}
                    className="py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-all cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>💤 Rest Day</span>
                  </button>
                  <button
                    onClick={(e) => handleCheckIn(activeLogModal, 'recovery', logValue, logNote, undefined, e)}
                    className="py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs transition-all cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>🩹 Recovery</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleCheckIn(activeLogModal, 'skipped', logValue, logNote)}
                    className="py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs transition-all cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>Skip / Excuse</span>
                  </button>
                  <button
                    onClick={() => handleCheckIn(activeLogModal, 'missed', logValue, logNote, 'other')}
                    className="py-2 rounded-xl bg-clay hover:bg-clay/80 text-white font-semibold text-xs transition-all cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>Mark Failed (Other)</span>
                  </button>
                </div>

                <div className="border-t border-natborder/60 pt-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1.5">
                    Select Failure Reason (Custom Cross Marks)
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FAILURE_REASONS.map((reason) => (
                      <button
                        key={reason.id}
                        onClick={() => handleCheckIn(activeLogModal, 'missed', logValue, logNote, reason.id)}
                        className={`px-2 py-1.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-1.5 text-[11px] font-semibold ${reason.color}`}
                      >
                        <span className="text-xs shrink-0 select-none">{reason.icon}</span>
                        <span className="truncate">{reason.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setActiveLogModal(null)}
                  className="flex-1 py-2 border border-natborder hover:bg-paper rounded-xl text-xs font-semibold text-natmuted cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const habitToEdit = habits.find(h => h.id === activeLogModal);
                    if (habitToEdit) {
                      setActiveLogModal(null);
                      handleOpenEdit(habitToEdit);
                    }
                  }}
                  className="flex-1 py-2 bg-clay/10 hover:bg-clay text-clay hover:text-white rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center justify-center gap-1"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Edit Settings</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* CREATE / EDIT HABIT MODAL */}
      {showCreateModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            onClick={handleCloseModal}
            className="absolute inset-0 bg-black/40 backdrop-blur-xs cursor-pointer"
          />
          {/* Content Wrapper */}
          <div 
            onClick={(e) => e.stopPropagation()}
            className="relative bg-dialogbg border border-natborder rounded-3xl w-full max-w-md shadow-xl overflow-hidden flex flex-col max-h-[90vh] z-10"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4.5 border-b border-natborder bg-paper shrink-0">
              <h3 className="text-base font-serif font-bold italic text-nattext">
                {editingHabit ? 'Edit Habit Settings' : 'Create New Habit'}
              </h3>
              <div className="flex items-center gap-1.5">
                {editingHabit && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setIsConfirmingDelete(true);
                    }}
                    className="p-1.5 rounded-lg bg-clay/10 hover:bg-clay text-clay hover:text-white transition-all cursor-pointer"
                    title="Delete Habit"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button 
                  onClick={handleCloseModal}
                  className="p-1.5 rounded-xl hover:bg-clay/10 text-natmuted hover:text-clay transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Form Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <form onSubmit={handleSaveHabit} className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                      Emoji
                    </label>
                    <input
                      type="text"
                      maxLength={2}
                      value={habitEmoji}
                      onChange={(e) => setHabitEmoji(e.target.value)}
                      className="w-full px-3 py-2 text-center text-xl rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay"
                      placeholder="🧘"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                      Habit Name
                    </label>
                    <input
                      type="text"
                      required
                      value={habitName}
                      onChange={(e) => setHabitName(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay"
                      placeholder="e.g. Morning Mindfulness Meditation"
                    />
                  </div>
                </div>

                {/* Habit Type Selector */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted">
                    Habit Goal Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setHabitType('start')}
                      className={`flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                        habitType === 'start'
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-900 dark:text-emerald-400 ring-2 ring-emerald-500/10'
                          : 'bg-paper border-natborder/60 text-natmuted hover:bg-paper/85'
                      }`}
                    >
                      <span className="text-xs font-bold flex items-center gap-1">
                        ✨ Start New Habit
                      </span>
                      <span className="text-[9px] text-natmuted mt-0.5 leading-tight">
                        Build a positive routine
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHabitType('stop')}
                      className={`flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                        habitType === 'stop'
                          ? 'bg-clay/10 border-clay/40 text-clay dark:text-clay/90 ring-2 ring-clay/10'
                          : 'bg-paper border-natborder/60 text-natmuted hover:bg-paper/85'
                      }`}
                    >
                      <span className="text-xs font-bold flex items-center gap-1">
                        🚫 Stop Bad Habit
                      </span>
                      <span className="text-[9px] text-natmuted mt-0.5 leading-tight">
                        Break or limit a bad habit
                      </span>
                    </button>
                  </div>
                </div>

                {/* Emoji Quick Picker Grid */}
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted">
                    Quick Emoji Picker
                  </label>
                  <div className="p-3 bg-paper/50 border border-natborder/40 rounded-xl space-y-2.5">
                    {/* Wellness & Mindfulness */}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-natmuted w-10 shrink-0">Mind:</span>
                      <div className="flex flex-wrap gap-1">
                        {['🧘', '🧠', '💭', '📝', '🎨', '📚', '☕', '🍵', '💤', '🛌'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setHabitEmoji(emoji)}
                            className={`w-7 h-7 flex items-center justify-center text-base rounded-lg transition-all cursor-pointer hover:scale-110 hover:bg-clay/10 ${
                              habitEmoji === emoji ? 'bg-clay/20 border border-clay/35 scale-105 shadow-3xs' : 'bg-transparent border border-transparent'
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    {/* Health & Sports */}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-natmuted w-10 shrink-0">Health:</span>
                      <div className="flex flex-wrap gap-1">
                        {['🏃', '🚶', '🏋️', '🚴', '🏊', '🤸', '🥗', '💧', '🍏', '💊'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setHabitEmoji(emoji)}
                            className={`w-7 h-7 flex items-center justify-center text-base rounded-lg transition-all cursor-pointer hover:scale-110 hover:bg-clay/10 ${
                              habitEmoji === emoji ? 'bg-clay/20 border border-clay/35 scale-105 shadow-3xs' : 'bg-transparent border border-transparent'
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Focus & Productivity */}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-natmuted w-10 shrink-0">Focus:</span>
                      <div className="flex flex-wrap gap-1">
                        {['💻', '✍️', '💡', '🎯', '📅', '📈', '💼', '📧', '🛠️', '🔑'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setHabitEmoji(emoji)}
                            className={`w-7 h-7 flex items-center justify-center text-base rounded-lg transition-all cursor-pointer hover:scale-110 hover:bg-clay/10 ${
                              habitEmoji === emoji ? 'bg-clay/20 border border-clay/35 scale-105 shadow-3xs' : 'bg-transparent border border-transparent'
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Lifestyle & Leisure */}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-natmuted w-10 shrink-0">Life:</span>
                      <div className="flex flex-wrap gap-1">
                        {['🪴', '🧹', '🐶', '🐱', '🎸', '🎮', '🌤️', '🌳', '🚲', '🌻'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setHabitEmoji(emoji)}
                            className={`w-7 h-7 flex items-center justify-center text-base rounded-lg transition-all cursor-pointer hover:scale-110 hover:bg-clay/10 ${
                              habitEmoji === emoji ? 'bg-clay/20 border border-clay/35 scale-105 shadow-3xs' : 'bg-transparent border border-transparent'
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Custom Category Selection Row */}
                {(() => {
                  const getCategoryStyles = (cat: string) => {
                    switch (cat) {
                      case 'Study':
                        return { bg: 'bg-clay/10 dark:bg-clay/15', text: 'text-clay dark:text-clay/90', border: 'border-clay/20 dark:border-clay/30', dot: 'bg-clay' };
                      case 'Work':
                        return { bg: 'bg-olive/10 dark:bg-olive/15', text: 'text-olive dark:text-olive/95', border: 'border-olive/20 dark:border-olive/30', dot: 'bg-olive' };
                      case 'Personal':
                        return { bg: 'bg-amber-50/80 dark:bg-amber-950/30', text: 'text-amber-800 dark:text-amber-400', border: 'border-amber-200/60 dark:border-amber-900/30', dot: 'bg-amber-600' };
                      case 'Business':
                        return { bg: 'bg-blue-50/80 dark:bg-blue-950/20', text: 'text-blue-800 dark:text-blue-400', border: 'border-blue-200/50 dark:border-blue-900/30', dot: 'bg-blue-600' };
                      case 'Health':
                        return { bg: 'bg-emerald-50/80 dark:bg-emerald-950/20', text: 'text-emerald-800 dark:text-emerald-400', border: 'border-emerald-200/50 dark:border-emerald-900/30', dot: 'bg-emerald-600' };
                      case 'Leisure':
                        return { bg: 'bg-purple-50/80 dark:bg-purple-950/20', text: 'text-purple-800 dark:text-purple-400', border: 'border-purple-200/50 dark:border-purple-900/30', dot: 'bg-purple-600' };
                      default:
                        return { bg: 'bg-stone-100/60 dark:bg-stone-900/40', text: 'text-stone-800 dark:text-stone-400', border: 'border-stone-200/60 dark:border-stone-800/40', dot: 'bg-stone-500' };
                    }
                  };

                  return (
                    <div className="space-y-4">
                      {/* Category Selector Grid */}
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted">Category Color Theme</label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {['Study', 'Work', 'Personal', 'Business', 'Health', 'Leisure', 'Other'].map((cat) => {
                            const styles = getCategoryStyles(cat);
                            const isSelected = habitCategory === cat;
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => setHabitCategory(cat)}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all border cursor-pointer ${
                                  isSelected 
                                    ? `${styles.bg} ${styles.border} ${styles.text} ring-2 ring-clay/20 shadow-2xs` 
                                    : 'bg-paper border-natborder/60 text-natmuted hover:bg-paper/85'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
                                <span>{cat}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Schedule Frequency Dropdown */}
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted" htmlFor="habit-schedule-type">
                          Schedule Frequency
                        </label>
                        <select
                          id="habit-schedule-type"
                          value={scheduleType}
                          onChange={(e) => setScheduleType(e.target.value as any)}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay cursor-pointer"
                        >
                          <option value="daily">Daily</option>
                          <option value="weekdays">Weekdays (Mon-Fri)</option>
                          <option value="specific_days">Specific Weekdays</option>
                          <option value="flexible">Flexible (X times/week)</option>
                        </select>
                      </div>
                    </div>
                  );
                })()}

                {scheduleType === 'specific_days' && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1.5">
                      Select Weekdays
                    </label>
                    <div className="flex gap-1 justify-between">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => {
                        const selected = weekdays.includes(idx);
                        return (
                          <button
                            type="button"
                            key={idx}
                            onClick={() => {
                              if (selected) {
                                setWeekdays(weekdays.filter(w => w !== idx));
                              } else {
                                setWeekdays([...weekdays, idx].sort());
                              }
                            }}
                            className={`w-8 h-8 rounded-full border text-xs font-bold transition-all cursor-pointer ${
                              selected 
                                ? 'bg-clay text-white border-clay shadow-3xs' 
                                : 'bg-paper text-natmuted border-natborder hover:bg-sand/45'
                            }`}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {scheduleType === 'flexible' && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                      Goal Target Frequency
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={7}
                        value={timesPerWeek}
                        onChange={(e) => setTimesPerWeek(Number(e.target.value))}
                        className="w-20 px-3 py-2 text-xs rounded-xl border border-natborder bg-paper text-center font-bold focus:outline-none focus:border-clay"
                      />
                      <span className="text-xs text-natmuted">times per week</span>
                    </div>
                  </div>
                )}

                {/* START AND END DATES */}
                <div className="border-t border-natborder/60 pt-3.5 space-y-3">
                  <h4 className="text-xs font-bold text-nattext">Active Date Range</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1 flex items-center justify-between">
                        <span>End Date</span>
                        <span className="text-[9px] lowercase text-natmuted font-normal flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={!hasEndDate}
                            onChange={(e) => setHasEndDate(!e.target.checked)}
                            className="rounded-sm border-natborder accent-clay cursor-pointer"
                            id="no-end-date"
                          />
                          <label htmlFor="no-end-date" className="cursor-pointer select-none">no end date</label>
                        </span>
                      </label>
                      <input
                        type="date"
                        value={endDate}
                        disabled={!hasEndDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className={`w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay font-medium transition-all ${
                          !hasEndDate ? 'opacity-40 cursor-not-allowed select-none' : ''
                        }`}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                      Optional Target Value
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={targetValue}
                      onChange={(e) => setTargetValue(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay"
                      placeholder="e.g. 10000"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                      Target Unit
                    </label>
                    <input
                      type="text"
                      value={targetUnit}
                      onChange={(e) => setTargetUnit(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay"
                      placeholder="e.g. steps, mins, oz"
                    />
                  </div>
                </div>

                {/* TIMETABLE PLACEMENT SETTINGS */}
                <div className="border-t border-natborder/60 pt-3.5 space-y-3">
                  <h4 className="text-xs font-bold text-nattext">Timetable Scheduling Block (Optional)</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                        Start Time
                      </label>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                        End Time
                      </label>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay"
                      />
                    </div>
                  </div>
                </div>

                {/* HABIT STACKING */}
                <div className="border-t border-natborder/60 pt-3.5">
                  <label className="block text-xs font-bold text-nattext mb-1.5">
                    Habit Stacking (Action sequence)
                  </label>
                  <p className="text-[9px] text-natmuted mb-2">Build a routine by stacking this habit immediately after an existing one.</p>
                  <select
                    value={habitStackId}
                    onChange={(e) => setHabitStackId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay"
                  >
                    <option value="">No preceding habit (Stand-alone)</option>
                    {habits
                      .filter(h => h.id !== editingHabit?.id)
                      .map(h => (
                        <option key={h.id} value={h.id}>Trigger after: {h.emoji} {h.name}</option>
                      ))}
                  </select>
                </div>

                {/* EXCUSE / CHEAT LIMIT */}
                <div className="border-t border-natborder/60 pt-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-nattext">Excuse / Cheat Meal Limit (Optional)</label>
                    <span className="text-[8px] bg-clay/10 text-clay font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider">New option</span>
                  </div>
                  <p className="text-[9px] text-natmuted">Set a maximum allowance for skips/excuses (e.g. 1 cheat meal per week on a diet).</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                        Allowed Skips
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={allowanceLimit === undefined || allowanceLimit === '' ? '' : allowanceLimit}
                        onChange={(e) => setAllowanceLimit(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay font-semibold"
                        placeholder="e.g. 1, 2"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1">
                        Time Period
                      </label>
                      <select
                        value={allowancePeriod}
                        onChange={(e) => setAllowancePeriod(e.target.value as 'week' | 'month')}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-natborder bg-paper focus:outline-none focus:border-clay cursor-pointer font-semibold"
                      >
                        <option value="week">per Week</option>
                        <option value="month">per Month</option>
                      </select>
                    </div>
                  </div>
                </div>

                {isConfirmingDelete ? (
                  <div className="w-full bg-clay/5 border border-clay/25 rounded-2xl p-4 space-y-3 mt-4">
                    <p className="text-xs text-nattext text-center font-medium leading-relaxed">
                      Are you sure you want to delete this habit? All check-ins will be preserved but the habit itself will be removed from the tracker.
                    </p>
                    {deleteError && (
                      <p className="text-xs text-clay text-center font-bold bg-clay/10 p-2 rounded-xl">
                        Error: {deleteError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsConfirmingDelete(false);
                          setDeleteError(null);
                        }}
                        className="flex-1 py-2 border border-natborder hover:bg-paper rounded-xl text-xs font-semibold text-natmuted cursor-pointer transition-all text-center"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!editingHabit) return;
                          setIsDeleting(true);
                          setDeleteError(null);
                          try {
                            await deleteHabit(editingHabit.id);
                            setShowCreateModal(false);
                            resetForm();
                          } catch (err) {
                            console.error("Failed to delete habit:", err);
                            setDeleteError(err instanceof Error ? err.message : String(err));
                          } finally {
                            setIsDeleting(false);
                          }
                        }}
                        disabled={isDeleting}
                        className="flex-1 py-2 bg-clay hover:bg-clay/90 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 pt-2">
                    {editingHabit && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setIsConfirmingDelete(true);
                        }}
                        className="px-3.5 py-2.5 border border-clay/30 hover:bg-clay hover:text-white hover:border-clay text-clay rounded-xl text-xs font-semibold cursor-pointer transition-all text-center flex items-center justify-center gap-1.5 shrink-0"
                        title="Delete Habit"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Delete</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="flex-1 py-2.5 border border-natborder hover:bg-paper rounded-xl text-xs font-semibold text-natmuted cursor-pointer transition-all text-center"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2.5 bg-clay hover:bg-clay/90 text-white font-bold text-xs rounded-xl transition-all cursor-pointer text-center shadow-3xs"
                    >
                      Save Habit
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}


      {/* Toast Reward Notification Overlay */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <div className="bg-cardbg border border-emerald-500/30 text-nattext px-6 py-3.5 rounded-2xl shadow-lg flex items-center gap-3.5 max-w-md bg-paper/95 backdrop-blur-md">
              <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
                <Award className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider font-mono">Streak Reward Activated!</p>
                <p className="text-sm font-medium text-nattext/90 mt-0.5 leading-relaxed">{toastMessage}</p>
              </div>
              <button 
                onClick={() => setToastMessage(null)}
                className="p-1 text-natmuted hover:text-nattext rounded-lg hover:bg-paper cursor-pointer pointer-events-auto ml-2 shrink-0 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating XP Dopamine animations */}
      <AnimatePresence>
        {floatingXps.map(item => (
          <motion.div
            key={item.id}
            initial={{ opacity: 1, y: item.y - 10, x: item.x - 25, scale: 0.8 }}
            animate={{ opacity: 0, y: item.y - 85, scale: 1.25 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.75, ease: "easeOut" }}
            className="fixed z-50 pointer-events-none font-bold text-[11px] bg-olive text-white px-2.5 py-1 rounded-full shadow-lg flex items-center gap-1 font-mono select-none"
          >
            🔥 {item.text}
          </motion.div>
        ))}
      </AnimatePresence>

    </div>
  );
}
