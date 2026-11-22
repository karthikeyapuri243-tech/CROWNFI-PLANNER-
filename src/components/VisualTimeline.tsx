import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Task, TaskCategory, Habit, HabitLog } from '../types';
import { updateTask, deleteTask, updateHabit, saveHabitLog, deleteHabitLog, clearWholeUserData } from '../lib/db';
import { isTaskScheduledForDay, parseDateLocal, isTaskCompletedOnDay } from '../lib/taskHelpers';
import { 
  Calendar as CalIcon, Plus, ChevronLeft, ChevronRight, Clock, 
  Trash2, AlertTriangle, ArrowRight, CheckCircle, RefreshCw, Star, Settings,
  CheckSquare, Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface VisualTimelineProps {
  tasks: Task[];
  habits?: Habit[];
  habitLogs?: HabitLog[];
  selectedDate: string; // YYYY-MM-DD
  setSelectedDate: (date: string) => void;
  onAddTask: (date: string, startTime?: string, endTime?: string) => void;
  onEditTask: (task: Task, startOverride?: string, endOverride?: string, dateOverride?: string) => void;
  userId?: string;
}

type TimelineView = 'day' | 'week' | 'month' | 'agenda';

// Helper for color coding categories using our organic theme
export const getCategoryStyles = (category: string): { bg: string, text: string, border: string, dot: string } => {
  switch (category) {
    case 'Study':
      return { bg: 'bg-clay/10 dark:bg-clay/15', text: 'text-clay font-bold dark:text-clay/90', border: 'border-clay/20 dark:border-clay/30', dot: 'bg-clay' };
    case 'Work':
      return { bg: 'bg-olive/10 dark:bg-olive/15', text: 'text-olive font-bold dark:text-olive/95', border: 'border-olive/20 dark:border-olive/30', dot: 'bg-olive' };
    case 'Personal':
      return { bg: 'bg-amber-50/80 dark:bg-amber-950/30', text: 'text-amber-800 font-semibold dark:text-amber-400', border: 'border-amber-200/60 dark:border-amber-900/30', dot: 'bg-amber-600' };
    case 'Business':
      return { bg: 'bg-blue-50/80 dark:bg-blue-950/20', text: 'text-blue-800 font-semibold dark:text-blue-400', border: 'border-blue-200/50 dark:border-blue-900/30', dot: 'bg-blue-600' };
    case 'Health':
      return { bg: 'bg-emerald-50/80 dark:bg-emerald-950/20', text: 'text-emerald-800 font-semibold dark:text-emerald-400', border: 'border-emerald-200/50 dark:border-emerald-900/30', dot: 'bg-emerald-600' };
    case 'Leisure':
      return { bg: 'bg-purple-50/80 dark:bg-purple-950/20', text: 'text-purple-800 font-semibold dark:text-purple-400', border: 'border-purple-200/50 dark:border-purple-900/30', dot: 'bg-purple-600' };
    default:
      return { bg: 'bg-stone-100/60 dark:bg-stone-900/40', text: 'text-stone-800 font-semibold dark:text-stone-400', border: 'border-stone-200/60 dark:border-stone-800/40', dot: 'bg-stone-500' };
  }
};

export default function VisualTimeline({
  tasks,
  habits = [],
  habitLogs = [],
  selectedDate,
  setSelectedDate,
  onAddTask,
  onEditTask,
  userId
}: VisualTimelineProps) {
  const [activeView, setActiveView] = useState<TimelineView>('day');
  const [dragOverHour, setDragOverHour] = useState<string | null>(null);
  const hourlyGridRef = useRef<HTMLDivElement | null>(null);

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

  // Custom Delete/Remove Confirmation states
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [habitToUnschedule, setHabitToUnschedule] = useState<Habit | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearScope, setClearScope] = useState<'today' | 'all' | 'whole'>('today');
  const [confirmResetText, setConfirmResetText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  const isHabitScheduledForDay = (habit: Habit, dateStr: string) => {
    if (habit.startDate && dateStr < habit.startDate) return false;
    if (habit.endDate && dateStr > habit.endDate) return false;
    const date = parseDateLocal(dateStr);
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.

    if (habit.scheduleType === 'daily') return true;
    if (habit.scheduleType === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
    if (habit.scheduleType === 'specific_days') return habit.weekdays?.some(w => Number(w) === dayOfWeek);
    return true; // fallback for flexible
  };

  // Filter and sort scheduled tasks for the active day (Both tasks and classes!)
  const scheduledTasks = useMemo(() => {
    return tasks
      .filter((t) => isTaskScheduledForDay(t, selectedDate))
      .sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));
  }, [tasks, selectedDate]);

  // Filter scheduled habits for active day
  const scheduledHabits = useMemo(() => {
    return habits
      .filter((h) => h.isScheduled && h.startTime && h.endTime && isHabitScheduledForDay(h, selectedDate))
      .sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));
  }, [habits, selectedDate]);

  // Compress early morning hours (6 AM - 9 AM) if they are empty
  const [showEarlyMorning, setShowEarlyMorning] = useState(false);

  const hasEarlyItems = useMemo(() => {
    const checkEarly = (timeStr?: string | null) => {
      if (!timeStr) return false;
      const [h] = timeStr.split(':').map(Number);
      return h < 9;
    };
    const taskEarly = scheduledTasks.some((t) => checkEarly(t.startTime));
    const habitEarly = scheduledHabits.some((h) => checkEarly(h.startTime));
    return taskEarly || habitEarly;
  }, [scheduledTasks, scheduledHabits]);

  const startHour = (showEarlyMorning || hasEarlyItems) ? 6 : 9; // 6 AM or 9 AM
  const endHour = 24; // Midnight
  const HOUR_HEIGHT = 130; // Height of each hour slot in pixels

  // Format date helper
  const dateFormatted = useMemo(() => {
    const d = new Date(selectedDate);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }, [selectedDate]);

  // Adjust date by offset
  const adjustDate = (daysOffset: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + daysOffset);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  // Auto-scrolling Day View to appropriate hour block
  useEffect(() => {
    if (activeView !== 'day') return;

    const timer = setTimeout(() => {
      if (!hourlyGridRef.current) return;

      let targetHour = 8; // Default fallback to 8 AM core hours

      const todayStr = new Date().toISOString().split('T')[0];
      const isToday = selectedDate === todayStr;

      if (isToday) {
        const currentHour = new Date().getHours();
        if (currentHour >= startHour && currentHour < endHour) {
          targetHour = currentHour;
        }
      } else {
        // Find earliest hour of scheduled tasks and habits
        const allHours = [
          ...scheduledTasks.map(t => t.startTime ? Number(t.startTime.split(':')[0]) : null),
          ...scheduledHabits.map(h => h.startTime ? Number(h.startTime.split(':')[0]) : null)
        ].filter((h): h is number => h !== null);

        if (allHours.length > 0) {
          targetHour = Math.min(...allHours);
        }
      }

      // Find the element with id={`hour-row-${targetHour}`} inside our grid
      const targetEl = hourlyGridRef.current.querySelector(`#hour-row-${targetHour}`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [selectedDate, activeView, scheduledTasks.length, scheduledHabits.length, startHour, endHour]);

  // Compute Gaps between tasks for Day View
  const gaps = useMemo(() => {
    const sorted = [...scheduledTasks];
    const computedGaps: { start: string; end: string; duration: number }[] = [];

    let currentStart = `${String(startHour).padStart(2, '0')}:00`;

    for (const task of sorted) {
      const taskStart = task.startTime;
      if (taskStart && taskStart > currentStart) {
        // Find gap duration in minutes
        const [sh, sm] = currentStart.split(':').map(Number);
        const [eh, em] = taskStart.split(':').map(Number);
        const diff = (eh * 60 + em) - (sh * 60 + sm);
        if (diff >= 15) {
          computedGaps.push({ start: currentStart, end: taskStart, duration: diff });
        }
      }
      if (task.endTime && task.endTime > currentStart) {
        currentStart = task.endTime;
      }
    }

    const midnightStr = "24:00";
    const [sh, sm] = currentStart.split(':').map(Number);
    const diff = (24 * 60) - (sh * 60 + sm);
    if (diff >= 15) {
      computedGaps.push({ start: currentStart, end: midnightStr, duration: diff });
    }

    return computedGaps;
  }, [scheduledTasks, startHour]);

  // Unified list of timeline items with absolute positioning calculations and overlap clustering
  const timelineItems = useMemo(() => {
    const items: any[] = [];
    
    // Map scheduled tasks
    scheduledTasks.forEach((t) => {
      if (!t.startTime || !t.endTime) return;
      const [sh, sm] = t.startTime.split(':').map(Number);
      const [eh, em] = t.endTime.split(':').map(Number);
      
      const startMinutes = sh * 60 + sm;
      let endMinutes = eh * 60 + em;
      if (endMinutes <= startMinutes) {
        endMinutes = startMinutes + 30; // 30 min minimum
      }
      
      // Clamp values to visible window [6 AM, 24 PM]
      const visibleStart = Math.max(startHour * 60, startMinutes);
      const visibleEnd = Math.min(endHour * 60, endMinutes);
      
      if (visibleStart >= visibleEnd) return; // Completely out of bounds

      items.push({
        id: t.id,
        type: 'task',
        title: t.title,
        category: t.category,
        startTime: t.startTime,
        endTime: t.endTime,
        startMinutes: visibleStart,
        endMinutes: visibleEnd,
        notes: t.notes,
        isRecurring: t.isRecurring,
        recurrence: t.recurrence,
        rawItem: t
      });
    });

    // Map scheduled habits
    scheduledHabits.forEach((h) => {
      if (!h.startTime || !h.endTime) return;
      const [sh, sm] = h.startTime.split(':').map(Number);
      const [eh, em] = h.endTime.split(':').map(Number);
      
      const startMinutes = sh * 60 + sm;
      let endMinutes = eh * 60 + em;
      if (endMinutes <= startMinutes) {
        endMinutes = startMinutes + 30; // 30 min minimum
      }

      // Clamp values to visible window [6 AM, 24 PM]
      const visibleStart = Math.max(startHour * 60, startMinutes);
      const visibleEnd = Math.min(endHour * 60, endMinutes);
      
      if (visibleStart >= visibleEnd) return; // Completely out of bounds

      const todayLog = habitLogs?.find(l => l.habitId === h.id && l.date === selectedDate);
      const isCompleted = todayLog?.status === 'completed';

      items.push({
        id: h.id,
        type: 'habit',
        title: h.name,
        category: h.category || 'Other',
        startTime: h.startTime,
        endTime: h.endTime,
        startMinutes: visibleStart,
        endMinutes: visibleEnd,
        emoji: h.emoji || '🌿',
        isCompleted,
        rawItem: h
      });
    });

    // Sort items by start time
    const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes);
    const clusters: { items: any[] }[] = [];
    
    // Group into clusters of overlapping events (either direct or indirect chain)
    for (const item of sorted) {
      let addedToCluster = false;
      for (const cluster of clusters) {
        const overlaps = cluster.items.some(clusterItem => {
          return item.startMinutes < clusterItem.endMinutes && item.endMinutes > clusterItem.startMinutes;
        });
        if (overlaps) {
          cluster.items.push(item);
          addedToCluster = true;
          break;
        }
      }
      if (!addedToCluster) {
        clusters.push({ items: [item] });
      }
    }

    // Assign column indices within each cluster to avoid visual overlay
    for (const cluster of clusters) {
      const columns: any[][] = [];
      for (const item of cluster.items) {
        let assignedCol = -1;
        for (let colIndex = 0; colIndex < columns.length; colIndex++) {
          const colItems = columns[colIndex];
          const hasOverlap = colItems.some(colItem => {
            return item.startMinutes < colItem.endMinutes && item.endMinutes > colItem.startMinutes;
          });
          if (!hasOverlap) {
            colItems.push(item);
            assignedCol = colIndex;
            break;
          }
        }
        if (assignedCol === -1) {
          columns.push([item]);
          assignedCol = columns.length - 1;
        }
        item.colIndex = assignedCol;
      }
      
      for (const item of cluster.items) {
        item.totalColumns = columns.length;
      }
    }

    // Compute layout properties (top, height, left, width)
    const dayStartMinutes = startHour * 60;
    
    return sorted.map((item) => {
      const top = (item.startMinutes - dayStartMinutes) * (HOUR_HEIGHT / 60);
      const height = Math.max(65, (item.endMinutes - item.startMinutes) * (HOUR_HEIGHT / 60));
      const leftPercent = (item.colIndex / item.totalColumns) * 100;
      const widthPercent = 100 / item.totalColumns;
      
      return {
        ...item,
        top,
        height,
        leftPercent,
        widthPercent
      };
    });
  }, [scheduledTasks, scheduledHabits, habitLogs, selectedDate, startHour]);

  // Drag-and-drop operations for timeline hours
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnHour = async (e: React.DragEvent, hourStr: string) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData('text/plain');
    const type = e.dataTransfer.getData('type') || 'task';
    if (!itemId) return;

    // Default duration is 1 hour
    const [h, m] = hourStr.split(':').map(Number);
    const endH = h + 1;
    const endStr = `${String(endH).padStart(2, '0')}:00`;

    if (type === 'habit') {
      try {
        await updateHabit(itemId, {
          isScheduled: true,
          startTime: hourStr,
          endTime: endStr,
          durationMinutes: 60
        });
      } catch (err) {
        console.error('Failed to reschedule habit on timeline', err);
      }
    } else {
      const taskObj = tasks.find(t => t.id === itemId);
      if (taskObj) {
        onEditTask(taskObj, hourStr, endStr, selectedDate);
      } else {
        onAddTask(selectedDate, hourStr, endStr);
      }
    }
  };

  const handleToggleComplete = async (task: Task, e?: React.MouseEvent) => {
    try {
      if (task.isRecurring) {
        const completedDates = task.completedDates ? [...task.completedDates] : [];
        if (completedDates.includes(selectedDate)) {
          const updated = completedDates.filter(d => d !== selectedDate);
          await updateTask(task.id, { completedDates: updated });
        } else {
          completedDates.push(selectedDate);
          if (e) triggerXpEffect(e, "+10 XP");
          await updateTask(task.id, { completedDates });
        }
      } else {
        if (!task.isCompleted && e) {
          triggerXpEffect(e, "+10 XP");
        }
        await updateTask(task.id, { isCompleted: !task.isCompleted });
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Reschedule/adjust duration blocks
  const adjustTaskDuration = async (task: Task, offsetMins: number) => {
    if (!task.startTime || !task.endTime) return;
    const [sh, sm] = task.startTime.split(':').map(Number);
    const [eh, em] = task.endTime.split(':').map(Number);
    
    let totalEndMins = (eh * 60 + em) + offsetMins;
    let totalStartMins = sh * 60 + sm;

    if (totalEndMins - totalStartMins < 30) {
      totalEndMins = totalStartMins + 30; // 30 mins minimum
    }

    const endH = Math.floor(totalEndMins / 60);
    const endM = totalEndMins % 60;
    const newEndStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    try {
      await updateTask(task.id, {
        endTime: newEndStr,
        durationMinutes: totalEndMins - totalStartMins
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Helper to convert decimal hours or minutes to pretty string
  const formatMinutes = (mins: number) => {
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  };

  // Week View dates generator
  const weekDates = useMemo(() => {
    const current = parseDateLocal(selectedDate);
    const week = [];
    // Get start of week (Monday)
    const day = current.getDay();
    const diff = current.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    current.setDate(diff);

    for (let i = 0; i < 7; i++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return week;
  }, [selectedDate]);

  // Combined and sorted agenda items (tasks and habits scheduled)
  const agendaItems = useMemo(() => {
    const items = [
      ...scheduledTasks.map(t => ({
        id: t.id,
        title: t.title,
        time: `${t.startTime} - ${t.endTime}`,
        category: t.category,
        priority: t.priority,
        type: 'task' as const,
        item: t,
      })),
      ...scheduledHabits.map(h => ({
        id: h.id,
        title: `${h.emoji} ${h.name}`,
        time: `${h.startTime} - ${h.endTime}`,
        category: h.category,
        priority: 'Medium' as const,
        type: 'habit' as const,
        item: h,
      }))
    ];
    return items.sort((a, b) => {
      const startA = a.item.startTime || '00:00';
      const startB = b.item.startTime || '00:00';
      return startA.localeCompare(startB);
    });
  }, [scheduledTasks, scheduledHabits]);

  return (
    <div className="space-y-6" id="visual-timetable-container">
      {/* Calendar Header with Toggles */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" id="timetable-header">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-olive/10 text-olive">
            <CalIcon className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-natmuted">Crown Planner</span>
            <div className="flex items-center gap-1">
              <h2 className="text-lg font-bold font-serif italic text-nattext">{dateFormatted}</h2>
            </div>
          </div>
        </div>

        {/* Navigation Toggles */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto" id="timetable-nav-controls">
          <button 
            onClick={() => adjustDate(-1)} 
            className="p-2 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext transition-all cursor-pointer"
            title="Previous Day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])} 
            className="px-3 py-2 text-xs font-bold border border-natborder hover:bg-paper text-nattext rounded-xl transition-all cursor-pointer"
          >
            Today
          </button>
          <button 
            onClick={() => adjustDate(1)} 
            className="p-2 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext transition-all cursor-pointer"
            title="Next Day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="h-6 w-px bg-natborder mx-1" />

          {/* View Selection Toggle */}
          <div className="flex bg-paper border border-natborder rounded-xl p-0.5" id="view-mode-tabs">
            {(['day', 'week', 'agenda'] as TimelineView[]).map((v) => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize tracking-wide transition-all cursor-pointer ${
                  activeView === v ? 'bg-olive text-white shadow-xs' : 'text-natmuted hover:text-nattext'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Secondary Actions Bar (Collapsible hours toggle + Safe Clear Schedule location) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-subtlebg/50 border border-natborder/60 rounded-2xl px-4 py-2.5" id="timeline-sub-actions">
        {/* Morning hours control */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEarlyMorning(!showEarlyMorning)}
            disabled={hasEarlyItems}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              hasEarlyItems 
                ? 'bg-olive/10 border-olive/20 text-olive cursor-not-allowed' 
                : showEarlyMorning 
                  ? 'bg-olive text-white border-olive' 
                  : 'bg-paper hover:bg-paper/80 border-natborder text-natmuted hover:text-nattext'
            }`}
            title={hasEarlyItems ? "Morning hours visible because items are scheduled before 9 AM" : "Toggle early morning hours (6 AM - 9 AM)"}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>
              {hasEarlyItems 
                ? "Early Morning Active (6 AM)" 
                : showEarlyMorning 
                  ? "Hide Early Morning (Starts 9 AM)" 
                  : "Show Early Morning (Starts 6 AM)"}
            </span>
          </button>
          
          {!hasEarlyItems && (
            <span className="text-[10px] text-natmuted font-sans font-medium hidden sm:inline">
              (early morning is collapsed by default when empty)
            </span>
          )}
        </div>

        {/* Safer place for clear schedule option */}
        <div className="flex items-center gap-2">
          <button
            id="clear-timeline-btn"
            onClick={() => {
              setClearScope('today');
              setConfirmResetText('');
              setClearError(null);
              setShowClearModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-rose-200/50 hover:border-rose-300 dark:border-rose-950/40 bg-rose-50/50 hover:bg-rose-50/90 dark:bg-rose-950/10 dark:hover:bg-rose-950/20 text-rose-600 dark:text-rose-450 rounded-xl transition-all cursor-pointer hover:shadow-3xs active:scale-95"
            title="Clear today's scheduled blocks safely"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Schedule</span>
          </button>
        </div>
      </div>

      {/* TIMELINE VIEW STAGE */}
      <AnimatePresence mode="wait">
        {activeView === 'day' && (
          <motion.div 
            key="day-timeline" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {/* 1. BACKDROP GRID CONTAINER */}
            <div ref={hourlyGridRef} className="relative max-h-[500px] lg:max-h-[calc(100vh-320px)] overflow-y-auto pr-2 scrollbar-thin scroll-smooth" id="hourly-grid">
              <div className="relative" style={{ height: `${(endHour - startHour) * HOUR_HEIGHT}px` }}>
                
                {/* BACKDROP ROWS LAYER */}
                <div className="absolute inset-0 flex flex-col pointer-events-none z-0">
                  {Array.from({ length: endHour - startHour }).map((_, i) => {
                    const hour = startHour + i;
                    const ampm = hour >= 12 ? (hour === 24 ? 'AM' : 'PM') : 'AM';
                    const displayHour = hour > 12 ? (hour === 24 ? 12 : hour - 12) : hour;
                    const hourStr = `${String(hour).padStart(2, '0')}:00`;

                    return (
                      <div 
                        key={hour} 
                        id={`hour-row-${hour}`}
                        className={`flex gap-4 relative group p-1.5 transition-all duration-200 pointer-events-auto border-b border-natborder/15`}
                        style={{ height: `${HOUR_HEIGHT}px` }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverHour(hourStr);
                          
                          if (hourlyGridRef.current) {
                            const rect = hourlyGridRef.current.getBoundingClientRect();
                            const dragY = e.clientY;
                            const threshold = 65;
                            const scrollSpeed = 10;
                            
                            const distanceToTop = dragY - rect.top;
                            const distanceToBottom = rect.bottom - dragY;
                            
                            if (distanceToTop > 0 && distanceToTop < threshold) {
                              hourlyGridRef.current.scrollTop -= scrollSpeed;
                            } else if (distanceToBottom > 0 && distanceToBottom < threshold) {
                              hourlyGridRef.current.scrollTop += scrollSpeed;
                            }
                          }
                        }}
                        onDragLeave={() => {
                          setDragOverHour(null);
                        }}
                        onDrop={async (e) => {
                          setDragOverHour(null);
                          await handleDropOnHour(e, hourStr);
                        }}
                      >
                        {/* Hour Sidebar label */}
                        <div className="w-14 text-right text-xs font-mono font-medium text-natmuted pt-1 select-none shrink-0">
                          {displayHour} {ampm}
                        </div>

                        {/* Hour Track Backdrop */}
                        <div className={`flex-1 relative rounded-lg transition-colors pointer-events-none ${
                          dragOverHour === hourStr ? 'bg-olive/10 border border-dashed border-olive/35' : 'group-hover:bg-sand/10'
                        }`}>
                          <button 
                            onClick={() => onAddTask(selectedDate, hourStr, `${String(hour + 1).padStart(2, '0')}:00`)}
                            className="absolute right-3 top-2.5 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-olive/10 text-olive hover:bg-olive hover:text-white transition-all cursor-pointer z-10 pointer-events-auto"
                            title={`Plan event at ${displayHour} ${ampm}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 2. OVERLAID ABSOLUTE CARDS LAYER */}
                <div className="absolute inset-y-0 left-[78px] right-2 pointer-events-none z-10">
                  {timelineItems.length === 0 ? (
                    <div className="absolute top-10 left-4 text-natmuted/30 text-xs italic font-mono select-none">
                      No items scheduled for today. Drag and drop cards from the left panel to plan your day.
                    </div>
                  ) : (
                    timelineItems.map((item) => {
                      if (item.type === 'task') {
                        const task = item.rawItem;
                        const colors = getCategoryStyles(item.category);
                        const isCompleted = isTaskCompletedOnDay(task, selectedDate);
                        
                        const isShortItem = item.height < 75;
                        
                        return (
                          <div
                            key={item.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', item.id);
                              e.dataTransfer.setData('type', 'task');
                            }}
                            className={`flex flex-col sm:flex-row justify-between items-stretch sm:items-center ${isShortItem ? 'p-1.5 sm:p-2' : 'p-3 sm:p-3.5'} rounded-2xl border ${colors.bg} ${colors.border} absolute shadow-2xs group/card hover:shadow-xs hover:z-20 transition-all cursor-grab active:cursor-grabbing pointer-events-auto gap-2 sm:gap-4`}
                            style={{
                              top: `${item.top}px`,
                              height: `${item.height}px`,
                              left: `${item.leftPercent}%`,
                              width: `calc(${item.widthPercent}% - 4px)`,
                              overflow: 'hidden'
                            }}
                            id={`timeline-task-${item.id}`}
                            title={`${item.title} (${item.startTime} - ${item.endTime}). Drag back to the checklist or drag to reschedule!`}
                          >
                            <div className="flex items-start gap-2 min-w-0 h-full">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleComplete(task, e);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onDragStart={(e) => e.stopPropagation()}
                                draggable={false}
                                className={`mt-0.5 shrink-0 transition-colors cursor-pointer ${colors.text} hover:opacity-85`}
                                title={isCompleted ? "Mark class incomplete" : "Mark class complete"}
                              >
                                {isCompleted ? (
                                  <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 shrink-0" />
                                )}
                              </button>
                              <div className="flex flex-col justify-between h-full min-w-0">
                                <div className="min-w-0">
                                  {!isShortItem && (
                                    <span className={`text-[10px] font-bold font-serif ${colors.text} uppercase tracking-wider block mb-0.5 truncate`}>
                                      {item.category}
                                    </span>
                                  )}
                                  <h4 className={`text-xs sm:text-sm font-semibold text-nattext truncate ${isCompleted ? 'line-through text-natmuted' : ''}`}>
                                    {item.title}
                                  </h4>
                                </div>
                                
                                <div className="flex items-center gap-1.5 text-natmuted text-[10px] sm:text-xs shrink-0 mt-0.5">
                                  <Clock className="w-2.5 h-2.5 shrink-0 text-olive" />
                                  <span className="truncate">{item.startTime} - {item.endTime}</span>
                                  {item.isRecurring && (
                                    <>
                                      <span aria-hidden="true" className="text-natborder/50">·</span>
                                      <span className="text-olive font-bold text-[10px] shrink-0 capitalize">
                                        🔁 {item.recurrence?.frequency}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Actions on hover */}
                            <div className="flex items-center gap-1.5 justify-end sm:justify-start opacity-100 lg:opacity-0 lg:group-hover/card:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  adjustTaskDuration(task, -30);
                                }}
                                onDragStart={(e) => e.stopPropagation()}
                                draggable={false}
                                className="px-1.5 py-0.5 rounded bg-cardbg border border-natborder text-natmuted hover:text-nattext text-[9px] font-bold transition-all cursor-pointer"
                                title="Shrink block 30m"
                              >
                                -30m
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  adjustTaskDuration(task, 30);
                                }}
                                onDragStart={(e) => e.stopPropagation()}
                                draggable={false}
                                className="px-1.5 py-0.5 rounded bg-cardbg border border-natborder text-natmuted hover:text-nattext text-[9px] font-bold transition-all cursor-pointer"
                                title="Expand block 30m"
                              >
                                +30m
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditTask(task, undefined, undefined, selectedDate);
                                }}
                                onDragStart={(e) => e.stopPropagation()}
                                draggable={false}
                                className="px-1 py-0.5 rounded hover:bg-olive/10 text-olive transition-all cursor-pointer text-xs font-semibold"
                              >
                                Edit
                              </button>
                            </div>
                          </div>
                        );
                      } else {
                        // Habit
                        const habit = item.rawItem;
                        const isCompleted = item.isCompleted;
                        
                        const isShortItem = item.height < 75;
                        
                        return (
                          <div
                            key={item.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', item.id);
                              e.dataTransfer.setData('type', 'habit');
                            }}
                            className={`flex flex-col sm:flex-row justify-between items-stretch sm:items-center ${isShortItem ? 'p-1.5 sm:p-2' : 'p-3 sm:p-3.5'} rounded-2xl border absolute transition-all cursor-grab active:cursor-grabbing hover:shadow-xs hover:z-20 pointer-events-auto shadow-2xs group/card gap-2 sm:gap-4 ${
                              isCompleted
                                ? 'bg-emerald-50/10 dark:bg-emerald-950/20 border-emerald-500/30 text-emerald-950 dark:text-emerald-300'
                                : 'bg-sand/15 border-sand/30 text-nattext'
                            }`}
                            style={{
                              top: `${item.top}px`,
                              height: `${item.height}px`,
                              left: `${item.leftPercent}%`,
                              width: `calc(${item.widthPercent}% - 4px)`,
                              overflow: 'hidden'
                            }}
                            id={`timeline-habit-${item.id}`}
                            title={`${item.title} (${item.startTime} - ${item.endTime}). Drag back to the checklist or drag to reschedule!`}
                          >
                            <div className="flex items-start gap-2 min-w-0 h-full">
                              <div className="flex flex-col justify-between h-full min-w-0">
                                <div className="min-w-0">
                                  {!isShortItem && (
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-mono block mb-0.5">
                                      {item.emoji} Habit • {item.category}
                                    </span>
                                  )}
                                  <h4 className={`text-xs sm:text-sm font-semibold text-nattext truncate ${isCompleted ? 'line-through text-emerald-850/60 dark:text-emerald-500/60' : ''}`}>
                                    {item.title}
                                  </h4>
                                </div>
                                <div className="flex items-center gap-1 text-natmuted text-[10px] sm:text-xs shrink-0 mt-0.5">
                                  <Clock className="w-2.5 h-2.5 text-emerald-500" />
                                  <span className="truncate">{item.startTime} - {item.endTime}</span>
                                </div>
                              </div>
                            </div>

                            {/* Actions on hover */}
                            <div className="flex items-center gap-1.5 justify-end sm:justify-start opacity-100 lg:opacity-0 lg:group-hover/card:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const event = new CustomEvent('aura-edit-habit', { detail: habit });
                                  window.dispatchEvent(event);
                                }}
                                onDragStart={(e) => e.stopPropagation()}
                                draggable={false}
                                className="p-1 rounded hover:bg-olive/10 text-olive transition-all cursor-pointer"
                                title="Edit Habit Settings"
                              >
                                <Settings className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }
                    })
                  )}
                </div>

              </div>
            </div>
          </motion.div>
        )}

        {/* WEEK VIEW */}
        {activeView === 'week' && (
          <motion.div 
            key="week-timeline" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 md:grid-cols-7 gap-3"
            id="week-grid"
          >
            {weekDates.map((date, idx) => {
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const dayStr = `${year}-${month}-${day}`;
              const isSelected = dayStr === selectedDate;
              
              const tToday = new Date();
              const tTodayStr = `${tToday.getFullYear()}-${String(tToday.getMonth() + 1).padStart(2, '0')}-${String(tToday.getDate()).padStart(2, '0')}`;
              const isCurrentToday = dayStr === tTodayStr;

              // Find tasks and habits for this day of week
              const dayTasks = tasks.filter((t) => isTaskScheduledForDay(t, dayStr));
              const dayHabits = habits.filter((h) => h.isScheduled && h.startTime && h.endTime && isHabitScheduledForDay(h, dayStr));

              return (
                <button 
                  key={idx}
                  type="button"
                  onClick={() => setSelectedDate(dayStr)}
                  className={`text-left w-full p-3.5 rounded-2xl border transition-all cursor-pointer block ${
                    isSelected 
                      ? 'bg-cardbg border-olive ring-2 ring-olive/10 shadow-sm' 
                      : isCurrentToday
                        ? 'bg-clay/5 border-clay'
                        : 'bg-paper/40 border-natborder hover:bg-cardbg'
                  }`}
                >
                  <div className="text-center pb-2 border-b border-natborder mb-2.5">
                    <span className="text-[10px] font-bold text-natmuted uppercase tracking-wider block">
                      {date.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span className={`text-base font-bold font-serif ${isCurrentToday ? 'text-clay italic' : 'text-nattext'}`}>
                      {date.getDate()}
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                    {dayTasks.length > 0 || dayHabits.length > 0 ? (
                      <>
                        {dayTasks.map((t) => {
                          const colors = getCategoryStyles(t.category);
                          return (
                            <div 
                              key={t.id} 
                              className={`p-1.5 rounded-lg border text-[10px] leading-tight ${colors.bg} ${colors.border}`}
                            >
                              <span className="font-bold text-nattext truncate block">{t.title}</span>
                              <span className="text-natmuted text-[9px] block">{t.startTime || 'Scheduled'}</span>
                            </div>
                          );
                        })}
                        {dayHabits.map((h) => {
                          return (
                            <div 
                              key={h.id} 
                              className="p-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-[10px] leading-tight"
                            >
                              <span className="font-bold text-nattext truncate block">{h.emoji} {h.name}</span>
                              <span className="text-natmuted text-[9px] block">{h.startTime}</span>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <span className="text-[10px] italic text-natmuted text-center block py-4">Free</span>
                    )}
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}

        {/* AGENDA VIEW */}
        {activeView === 'agenda' && (
          <motion.div 
            key="agenda-timeline" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="space-y-3"
            id="agenda-grid"
          >
            {agendaItems.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {agendaItems.map((item) => {
                  const colors = getCategoryStyles(item.category);
                  return (
                    <div 
                      key={item.id} 
                      onClick={() => {
                        if (item.type === 'task') {
                          onEditTask(item.item as Task, undefined, undefined, selectedDate);
                        } else if (item.type === 'habit') {
                          const event = new CustomEvent('aura-edit-habit', { detail: item.item });
                          window.dispatchEvent(event);
                        }
                      }}
                      className={`flex items-center justify-between p-3 rounded-2xl border ${
                        item.type === 'habit'
                          ? 'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10'
                          : 'border-natborder hover:bg-paper/40 hover:border-olive/30'
                      } transition-all cursor-pointer`}
                    >
                      <div className="flex items-center gap-3">
                        {item.type === 'habit' ? (
                          <span className="text-base select-none">{(item.item as Habit).emoji}</span>
                        ) : (
                          <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                        )}
                        <div>
                          <h4 className="text-sm font-semibold text-nattext">{item.title}</h4>
                          <p className="text-xs text-natmuted">
                            {item.time} • {item.category} {item.type === 'habit' && '• Habit'}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold uppercase text-natmuted">
                        {item.type === 'habit' ? 'Habit' : item.priority}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 bg-paper/20 rounded-3xl border border-dashed border-natborder">
                <CalIcon className="w-8 h-8 text-natmuted mx-auto mb-2.5 opacity-40" />
                <p className="text-sm text-natmuted italic">No events planned for this date.</p>
                <button
                  onClick={() => onAddTask(selectedDate)}
                  className="mt-3 px-4 py-2 bg-olive hover:bg-olive/90 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer"
                >
                  Schedule Event
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Modals for Deletion & Unscheduling */}
      {createPortal(
        <AnimatePresence>
          {taskToDelete && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <div 
                onClick={() => {
                  setTaskToDelete(null);
                  setDeleteError(null);
                }}
                className="absolute inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
              />
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-cardbg border border-natborder rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 z-10"
                id="delete-task-timeline-modal"
              >
                <div className="w-12 h-12 rounded-full bg-clay/10 text-clay flex items-center justify-center mx-auto">
                  <Trash2 className="w-6 h-6 animate-pulse" />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-base font-serif font-bold italic text-nattext">
                    Delete Event Block
                  </h3>
                  <p className="text-xs text-natmuted leading-relaxed">
                    Are you sure you want to delete the planned block <strong className="text-nattext font-medium">"{taskToDelete.title}"</strong>? This action cannot be undone.
                  </p>
                  {deleteError && (
                    <p className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/30 p-2.5 rounded-xl mt-2 font-mono break-all border border-rose-250/30">
                      Error: {deleteError}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 pt-2 w-full">
                  {taskToDelete.isRecurring ? (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!taskToDelete) return;
                          setIsProcessing(true);
                          setDeleteError(null);
                          try {
                            const cancelledDates = taskToDelete.cancelledDates ? [...taskToDelete.cancelledDates] : [];
                            if (!cancelledDates.includes(selectedDate)) {
                              cancelledDates.push(selectedDate);
                            }
                            await updateTask(taskToDelete.id, { cancelledDates });
                            setTaskToDelete(null);
                          } catch (err: any) {
                            console.error("Failed to cancel occurrence:", err);
                            setDeleteError(err.message || String(err));
                          } finally {
                            setIsProcessing(false);
                          }
                        }}
                        disabled={isProcessing}
                        className="w-full py-2 px-4 rounded-xl bg-clay text-white text-xs font-semibold hover:bg-clay/90 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {isProcessing ? 'Removing...' : 'This Occurrence Only'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!taskToDelete) return;
                          setIsProcessing(true);
                          setDeleteError(null);
                          try {
                            await deleteTask(taskToDelete.id);
                            setTaskToDelete(null);
                          } catch (err: any) {
                            console.error("Failed to delete task series:", err);
                            setDeleteError(err.message || String(err));
                          } finally {
                            setIsProcessing(false);
                          }
                        }}
                        disabled={isProcessing}
                        className="w-full py-2 px-4 rounded-xl border border-rose-200 hover:bg-rose-50/50 dark:border-rose-950/40 dark:hover:bg-rose-950/10 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center"
                      >
                        {isProcessing ? 'Deleting...' : 'Delete Entire Series'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTaskToDelete(null);
                          setDeleteError(null);
                        }}
                        disabled={isProcessing}
                        className="w-full py-2 px-4 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-2 w-full">
                      <button
                        type="button"
                        onClick={() => {
                          setTaskToDelete(null);
                          setDeleteError(null);
                        }}
                        disabled={isProcessing}
                        className="flex-1 py-2 px-4 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!taskToDelete) return;
                          setIsProcessing(true);
                          setDeleteError(null);
                          try {
                            await deleteTask(taskToDelete.id);
                            setTaskToDelete(null);
                          } catch (err: any) {
                            console.error("Failed to delete task from timeline:", err);
                            setDeleteError(err.message || String(err));
                          } finally {
                            setIsProcessing(false);
                          }
                        }}
                        disabled={isProcessing}
                        className="flex-1 py-2 px-4 rounded-xl bg-clay text-white text-xs font-semibold hover:bg-clay/90 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {isProcessing ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {createPortal(
        <AnimatePresence>
          {habitToUnschedule && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <div 
                onClick={() => setHabitToUnschedule(null)}
                className="absolute inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
              />
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-cardbg border border-natborder rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 z-10"
                id="unschedule-habit-modal"
              >
                <div className="w-12 h-12 rounded-full bg-clay/10 text-clay flex items-center justify-center mx-auto">
                  <Trash2 className="w-6 h-6 animate-pulse" />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-base font-serif font-bold italic text-nattext">
                    Unschedule Habit
                  </h3>
                  <p className="text-xs text-natmuted leading-relaxed">
                    Are you sure you want to remove the habit block <strong className="text-nattext font-medium">"{habitToUnschedule.emoji} {habitToUnschedule.name}"</strong> from today's schedule? This will not delete the habit itself.
                  </p>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setHabitToUnschedule(null)}
                    disabled={isProcessing}
                    className="flex-1 py-2 px-4 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!habitToUnschedule) return;
                      setIsProcessing(true);
                      try {
                        await updateHabit(habitToUnschedule.id, {
                          isScheduled: false,
                          startTime: '',
                          endTime: ''
                        });
                      } catch (err) {
                        console.error("Failed to unschedule habit:", err);
                      } finally {
                        setIsProcessing(false);
                        setHabitToUnschedule(null);
                      }
                    }}
                    disabled={isProcessing}
                    className="flex-1 py-2 px-4 rounded-xl bg-clay text-white text-xs font-semibold hover:bg-clay/90 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    {isProcessing ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {createPortal(
        <AnimatePresence>
          {showClearModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <div 
                onClick={() => setShowClearModal(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
              />
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-cardbg border border-natborder rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 z-10"
                id="clear-crownplanner-modal"
              >
                <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                  <Trash2 className="w-6 h-6 animate-pulse" />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-base font-serif font-bold italic text-nattext">
                    Remove Crown Planner Items
                  </h3>
                  <p className="text-xs text-natmuted leading-relaxed">
                    Choose the scope of scheduled items you want to remove. This is irreversible.
                  </p>
                </div>

                {clearError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/25 rounded-2xl text-center">
                    <p className="text-xs font-semibold text-rose-500 leading-relaxed">
                      ⚠️ {clearError}
                    </p>
                  </div>
                )}

                 {/* Selection options */}
                <div className="grid grid-cols-1 gap-3">
                  <label 
                    className={`flex items-start gap-3 p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      clearScope === 'today'
                        ? 'bg-olive/10 border-olive text-nattext'
                        : 'bg-paper/40 border-natborder text-natmuted hover:bg-paper'
                    }`}
                  >
                    <input 
                      type="radio" 
                      name="clear-scope" 
                      checked={clearScope === 'today'} 
                      onChange={() => { setClearScope('today'); setConfirmResetText(''); }}
                      className="mt-0.5 accent-olive"
                    />
                    <div>
                      <span className="text-xs font-bold block">Only Today's Schedule</span>
                      <span className="text-[10px] block opacity-80 mt-0.5">Delete scheduled tasks and unschedule habits for {dateFormatted}.</span>
                    </div>
                  </label>

                  <label 
                    className={`flex items-start gap-3 p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      clearScope === 'all'
                        ? 'bg-rose-500/10 border-rose-500 text-nattext'
                        : 'bg-paper/40 border-natborder text-natmuted hover:bg-paper'
                    }`}
                  >
                    <input 
                      type="radio" 
                      name="clear-scope" 
                      checked={clearScope === 'all'} 
                      onChange={() => { setClearScope('all'); setConfirmResetText(''); }}
                      className="mt-0.5 accent-rose-500"
                    />
                    <div>
                      <span className="text-xs font-bold block">All Scheduled Items</span>
                      <span className="text-[10px] block opacity-80 mt-0.5">Delete all scheduled tasks/events and unschedule habits across all dates.</span>
                    </div>
                  </label>

                  <label 
                    className={`flex items-start gap-3 p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      clearScope === 'whole'
                        ? 'bg-red-50/50 dark:bg-red-950/25 border-red-500 dark:border-red-900 text-nattext'
                        : 'bg-paper/40 border-natborder text-natmuted hover:bg-paper'
                    }`}
                  >
                    <input 
                      type="radio" 
                      name="clear-scope" 
                      checked={clearScope === 'whole'} 
                      onChange={() => { setClearScope('whole'); setConfirmResetText(''); }}
                      className="mt-0.5 accent-red-650"
                    />
                    <div>
                      <span className="text-xs font-bold block text-red-600 dark:text-red-400">Clear Whole App Data</span>
                      <span className="text-[10px] block opacity-80 mt-0.5">Factory Reset: Permanently delete all tasks, classes, habits, and check-ins.</span>
                    </div>
                  </label>
                </div>

                {clearScope === 'whole' && (
                  <div className="p-4 bg-red-500/5 dark:bg-red-950/10 border border-red-500/20 rounded-2xl space-y-2.5">
                    <label className="text-xs font-semibold text-red-600 dark:text-red-400 block flex items-center gap-1">
                      ⚠️ Factory Reset Confirmation
                    </label>
                    <p className="text-[11px] text-natmuted leading-relaxed">
                      To prevent accidental deletions, please type <span className="font-mono font-bold bg-red-100 dark:bg-red-950/40 px-1.5 py-0.5 rounded text-red-700 dark:text-red-300">RESET</span> to confirm permanently deleting all data:
                    </p>
                    <input
                      type="text"
                      placeholder="Type RESET here"
                      value={confirmResetText}
                      onChange={(e) => setConfirmResetText(e.target.value)}
                      className="w-full bg-paper border border-red-500/30 rounded-xl px-3.5 py-2 text-xs font-mono text-center tracking-wider text-nattext focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                    />
                  </div>
                )}

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowClearModal(false);
                      setConfirmResetText('');
                    }}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 px-4 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setIsProcessing(true);
                      setClearError(null);
                      let successCount = 0;
                      let failCount = 0;
                      let lastError: any = null;

                      try {
                        if (clearScope === 'whole') {
                          if (confirmResetText !== 'RESET') {
                            throw new Error("Confirmation text does not match.");
                          }
                          if (!userId) throw new Error("User session required to perform factory reset.");
                          await clearWholeUserData(userId);
                        } else if (clearScope === 'today') {
                          // Clear active day's scheduled tasks & habits
                          const tasksToClear = tasks.filter(t => isTaskScheduledForDay(t, selectedDate));
                          
                          await Promise.all(tasksToClear.map(async (t) => {
                            try {
                              if (t.isRecurring) {
                                const cancelledDates = t.cancelledDates ? [...t.cancelledDates] : [];
                                if (!cancelledDates.includes(selectedDate)) {
                                  cancelledDates.push(selectedDate);
                                }
                                await updateTask(t.id, { cancelledDates });
                              } else {
                                // Safe unscheduling instead of total deletion for checklist tasks
                                await updateTask(t.id, {
                                  isScheduled: false,
                                  itemType: 'task',
                                  startTime: '',
                                  endTime: ''
                                });
                              }
                              successCount++;
                            } catch (err) {
                              console.error(`Failed to clear task ${t.id}:`, err);
                              failCount++;
                              lastError = err;
                            }
                          }));

                          const habitsToUnschedule = habits.filter(h => h.isScheduled && h.startTime && h.endTime && isHabitScheduledForDay(h, selectedDate));
                          await Promise.all(habitsToUnschedule.map(async (h) => {
                            try {
                              await updateHabit(h.id, {
                                isScheduled: false,
                                startTime: '',
                                endTime: ''
                              });
                              successCount++;
                            } catch (err) {
                              console.error(`Failed to unschedule habit ${h.id}:`, err);
                              failCount++;
                              lastError = err;
                            }
                          }));
                        } else {
                          // Clear all scheduled tasks & habits
                          const tasksToClear = tasks.filter(t => t.isScheduled && !t.isInbox);
                          await Promise.all(tasksToClear.map(async (t) => {
                            try {
                              if (t.isRecurring) {
                                // Recurring classes/events can be deleted
                                await deleteTask(t.id);
                              } else {
                                // Non-recurring tasks are unscheduled safely back to checklist
                                await updateTask(t.id, {
                                  isScheduled: false,
                                  itemType: 'task',
                                  startTime: '',
                                  endTime: ''
                                });
                              }
                              successCount++;
                            } catch (err) {
                              console.error(`Failed to delete/unschedule task ${t.id}:`, err);
                              failCount++;
                              lastError = err;
                            }
                          }));

                          const habitsToUnschedule = habits.filter(h => h.isScheduled);
                          await Promise.all(habitsToUnschedule.map(async (h) => {
                            try {
                              await updateHabit(h.id, {
                                isScheduled: false,
                                startTime: '',
                                endTime: ''
                              });
                              successCount++;
                            } catch (err) {
                              console.error(`Failed to unschedule habit ${h.id}:`, err);
                              failCount++;
                              lastError = err;
                            }
                          }));
                        }

                        if (failCount > 0) {
                          setClearError(`Cleared ${successCount} items, but encountered issues with ${failCount}. Error: ${lastError?.message || String(lastError)}`);
                        } else {
                          setShowClearModal(false);
                          setConfirmResetText('');
                        }
                      } catch (err: any) {
                        console.error("Failed to clear data:", err);
                        setClearError(err.message || String(err));
                      } finally {
                        setIsProcessing(false);
                      }
                    }}
                    disabled={isProcessing || (clearScope === 'whole' && confirmResetText !== 'RESET')}
                    className={`flex-1 py-2.5 px-4 rounded-xl text-white text-xs font-semibold active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                      clearScope === 'whole'
                        ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-600/50'
                        : clearScope === 'all'
                        ? 'bg-rose-650 hover:bg-rose-700'
                        : 'bg-olive hover:bg-olive/90'
                    }`}
                  >
                    {isProcessing ? 'Removing...' : 'Confirm'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Floating XP Dopamine animations */}
      <AnimatePresence>
        {floatingXps.map(item => (
          <motion.div
            key={item.id}
            initial={{ opacity: 1, y: item.y - 10, x: item.x - 20, scale: 0.8 }}
            animate={{ opacity: 0, y: item.y - 80, scale: 1.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="fixed z-50 pointer-events-none font-bold text-[11px] bg-olive text-white px-2.5 py-1 rounded-full shadow-lg flex items-center gap-1 font-mono select-none"
          >
            🌿 {item.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
