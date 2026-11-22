import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Task, TaskPriority, TaskCategory, Habit } from '../types';
import { createTask, updateTask, deleteTask, updateHabit } from '../lib/db';
import { isTaskActiveOnDay, isTaskCompletedOnDay } from '../lib/taskHelpers';
import { 
  Inbox, ListTodo, Plus, Trash2, Calendar, CheckSquare, 
  Square, ChevronRight, AlertCircle, Sparkles, Filter, 
  ArrowUpRight, Clock, ChevronDown, BookOpen, AlertTriangle
} from 'lucide-react';

interface InboxAndTodoListProps {
  userId: string;
  tasks: Task[];
  habits: Habit[];
  selectedDate: string;
  onEditTask: (task: Task) => void;
  onAddTask: (date: string, startTime?: string, endTime?: string) => void;
}

const CATEGORIES: TaskCategory[] = ['Study', 'Work', 'Personal', 'Business', 'Health', 'Leisure', 'Other'];

const getCategoryPillStyles = (category: string) => {
  switch (category) {
    case 'Study':
      return 'bg-clay/10 dark:bg-clay/15 text-clay dark:text-clay/90 border-clay/20 dark:border-clay/30';
    case 'Work':
      return 'bg-olive/10 dark:bg-olive/15 text-olive dark:text-olive/95 border-olive/20 dark:border-olive/30';
    case 'Personal':
      return 'bg-amber-50/80 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 border-amber-200/60 dark:border-amber-900/30';
    case 'Business':
      return 'bg-blue-50/80 dark:bg-blue-950/20 text-blue-800 dark:text-blue-400 border-blue-200/50 dark:border-blue-900/30';
    case 'Health':
      return 'bg-emerald-50/80 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border-emerald-200/50 dark:border-emerald-900/30';
    case 'Leisure':
      return 'bg-purple-50/80 dark:bg-purple-950/20 text-purple-800 dark:text-purple-400 border-purple-200/50 dark:border-purple-900/30';
    default:
      return 'bg-stone-100/60 dark:bg-stone-900/40 text-stone-800 dark:text-stone-400 border-stone-200/60 dark:border-stone-800/40';
  }
};

export default function InboxAndTodoList({
  userId,
  tasks,
  habits,
  selectedDate,
  onEditTask,
  onAddTask
}: InboxAndTodoListProps) {
  const [quickInput, setQuickInput] = useState('');
  const [todoInput, setTodoInput] = useState('');
  
  // Custom Delete Confirmation state
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [deleteType, setDeleteType] = useState<'raw' | 'todo' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  
  // Filters
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'priority' | 'dueDate' | 'createdAtNewest' | 'createdAtOldest'>('priority');
  const [showCompleted, setShowCompleted] = useState<boolean>(false);
  const [rolledForwardCount, setRolledForwardCount] = useState(0);

  // Drag over states
  const [isDragOverInbox, setIsDragOverInbox] = useState(false);
  const [isDragOverChecklist, setIsDragOverChecklist] = useState(false);

  // Floating XP Dopamine animations
  const [floatingXps, setFloatingXps] = useState<Array<{ id: string; x: number; y: number; text: string }>>([]);

  const triggerXpEffect = (e: React.MouseEvent, xpText: string) => {
    const x = e.clientX || window.innerWidth / 2;
    const y = e.clientY || window.innerHeight / 2;
    const newId = Math.random().toString(36).substring(2, 9);
    setFloatingXps(prev => [...prev, { id: newId, x, y, text: xpText }]);
    setTimeout(() => {
      setFloatingXps(prev => prev.filter(item => item.id !== newId));
    }, 1000);
  };

  // Parsing indicator
  const [parsedPreview, setParsedPreview] = useState<{
    title: string;
    date: string;
    time?: string;
    isScheduled: boolean;
  } | null>(null);

  // Scheduling States
  const [taskToSchedule, setTaskToSchedule] = useState<Task | null>(null);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleStartTime, setScheduleStartTime] = useState('09:00');
  const [scheduleEndTime, setScheduleEndTime] = useState('10:00');
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [showOverlapConfirm, setShowOverlapConfirm] = useState(false);
  const [overlapDetails, setOverlapDetails] = useState<{ tasks: Task[]; habits: Habit[] }>({ tasks: [], habits: [] });
  const [pendingScheduleData, setPendingScheduleData] = useState<any | null>(null);

  useEffect(() => {
    if (taskToSchedule) {
      setScheduleDate(taskToSchedule.dueDate || selectedDate);
      setScheduleStartTime(taskToSchedule.startTime || '09:00');
      setScheduleEndTime(taskToSchedule.endTime || '10:00');
      setScheduleError(null);
    }
  }, [taskToSchedule, selectedDate]);

  const executeSaveSchedule = async (scheduleData: any) => {
    if (!taskToSchedule) return;
    await updateTask(taskToSchedule.id, {
      isInbox: false,
      isScheduled: true,
      itemType: 'class',
      dueDate: scheduleData.dueDate,
      startTime: scheduleData.startTime,
      endTime: scheduleData.endTime,
      durationMinutes: scheduleData.durationMinutes
    });
    setTaskToSchedule(null);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskToSchedule) return;

    if (!scheduleStartTime || !scheduleEndTime) {
      setScheduleError('Please specify both start and end times');
      return;
    }

    if (scheduleStartTime >= scheduleEndTime) {
      setScheduleError('End time must be after start time');
      return;
    }

    const [sh, sm] = scheduleStartTime.split(':').map(Number);
    const [eh, em] = scheduleEndTime.split(':').map(Number);
    const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
    const finalDuration = durationMinutes > 0 ? durationMinutes : 60;

    const scheduleData = {
      dueDate: scheduleDate,
      startTime: scheduleStartTime,
      endTime: scheduleEndTime,
      durationMinutes: finalDuration
    };

    // CHECK FOR OVERLAPS
    const overlappingTasks = tasks.filter((t) => {
      if (!t.isScheduled || t.dueDate !== scheduleDate || t.id === taskToSchedule.id || !t.startTime || !t.endTime) return false;
      return t.startTime < scheduleEndTime && t.endTime > scheduleStartTime;
    });

    const overlappingHabits = habits.filter((h) => {
      const isHabitScheduledForDay = (habit: Habit, dateStr: string) => {
        if (habit.startDate && dateStr < habit.startDate) return false;
        if (habit.endDate && dateStr > habit.endDate) return false;
        const d = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = d.getDay();
        if (habit.scheduleType === 'daily') return true;
        if (habit.scheduleType === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
        if (habit.scheduleType === 'specific_days') return habit.weekdays?.some(w => Number(w) === dayOfWeek);
        return true;
      };

      if (!h.isScheduled || !h.startTime || !h.endTime || !isHabitScheduledForDay(h, scheduleDate)) return false;
      return h.startTime < scheduleEndTime && h.endTime > scheduleStartTime;
    });

    if (overlappingTasks.length > 0 || overlappingHabits.length > 0) {
      setPendingScheduleData(scheduleData);
      setOverlapDetails({ tasks: overlappingTasks, habits: overlappingHabits });
      setShowOverlapConfirm(true);
      return;
    }

    setIsScheduling(true);
    setScheduleError(null);

    try {
      await executeSaveSchedule(scheduleData);
    } catch (err) {
      console.error('Failed to schedule task:', err);
      setScheduleError('Could not save schedule. Please try again.');
    } finally {
      setIsScheduling(false);
    }
  };

  // OVERDUE AUTO-ROLL FORWARD UTILITY
  useEffect(() => {
    const rollOverdueTasks = async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const overdue = tasks.filter((t) => !t.isCompleted && t.dueDate && t.dueDate < todayStr && !t.isInbox && !t.isRecurring);
      if (overdue.length === 0) return;

      let count = 0;
      for (const task of overdue) {
        try {
          await updateTask(task.id, {
            dueDate: todayStr,
            originalDueDate: task.originalDueDate || task.dueDate,
            rescheduleCount: task.rescheduleCount + 1,
            isScheduled: false, // remove from yesterday's timetable to prevent empty time block ghosting
            startTime: '',
            endTime: ''
          });
          count++;
        } catch (err) {
          console.error("Failed to roll task forward automatically:", task.id, err);
        }
      }
      if (count > 0) {
        setRolledForwardCount(count);
        // Clear message after 6 seconds
        setTimeout(() => setRolledForwardCount(0), 6000);
      }
    };

    if (tasks.length > 0) {
      rollOverdueTasks();
    }
  }, [tasks]);

  // SMART NATURAL LANGUAGE PARSER
  const handleInputChange = (text: string) => {
    setTodoInput(text);
    if (!text.trim()) {
      setParsedPreview(null);
      return;
    }

    // Simple natural language parsing
    const lower = text.toLowerCase();
    const today = new Date();
    let parsedDate = today.toISOString().split('T')[0];
    let parsedTime: string | undefined;
    let isScheduled = false;

    // Detect "tomorrow"
    if (lower.includes('tomorrow')) {
      const tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);
      parsedDate = tomorrow.toISOString().split('T')[0];
    }
    // Detect specific weekdays (e.g., "on monday", "next friday")
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < 7; i++) {
      if (lower.includes(`on ${days[i]}`) || lower.includes(`next ${days[i]}`)) {
        const nextDay = new Date();
        const currentDayIdx = today.getDay();
        const targetDayIdx = i;
        let daysToAdd = targetDayIdx - currentDayIdx;
        if (daysToAdd <= 0) daysToAdd += 7; // Next week's weekday
        nextDay.setDate(today.getDate() + daysToAdd);
        parsedDate = nextDay.toISOString().split('T')[0];
        break;
      }
    }

    // Detect time (e.g. "at 5pm", "at 14:30", "at 9am", "5pm", "9am")
    const timeMatch = lower.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ampm = timeMatch[3].toLowerCase();

      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;

      parsedTime = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      isScheduled = true;
    }

    // Clean title from date keywords
    let titleClean = text
      .replace(/tomorrow/gi, '')
      .replace(/on\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/gi, '')
      .replace(/next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/gi, '')
      .replace(/(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    setParsedPreview({
      title: titleClean || 'Untitled Plan',
      date: parsedDate,
      time: parsedTime,
      isScheduled
    });
  };

  const handleQuickAddInbox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;

    try {
      await createTask(userId, {
        title: quickInput.trim(),
        notes: '',
        priority: 'Medium',
        category: 'Other',
        dueDate: selectedDate,
        subtasks: [],
        isCompleted: false,
        isInbox: true,
        isScheduled: false,
        startTime: '',
        endTime: '',
        durationMinutes: 0,
        isRecurring: false
      });
      setQuickInput('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleNaturalAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!todoInput.trim()) return;

    const title = parsedPreview?.title || todoInput.trim();
    const dueDate = parsedPreview?.date || selectedDate;
    const isScheduled = parsedPreview?.isScheduled || false;
    const startTime = parsedPreview?.time || '';
    
    let endTime = '';
    if (startTime) {
      const [h, m] = startTime.split(':').map(Number);
      endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    try {
      await createTask(userId, {
        title,
        notes: '',
        priority: 'Medium',
        category: 'Personal',
        dueDate,
        subtasks: [],
        isCompleted: false,
        isInbox: false,
        isScheduled,
        startTime,
        endTime,
        durationMinutes: isScheduled ? 60 : 0,
        isRecurring: false
      });
      setTodoInput('');
      setParsedPreview(null);
    } catch (err) {
      console.error(err);
    }
  };

  // Draggable task start
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
  };

  const handleDragOverInbox = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverInbox(true);
  };

  const handleDragLeaveInbox = () => {
    setIsDragOverInbox(false);
  };

  const handleDropOnInbox = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverInbox(false);
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    try {
      await updateTask(taskId, {
        isInbox: true,
        isScheduled: false,
        itemType: 'task',
        startTime: '',
        endTime: '',
        durationMinutes: 0
      });
    } catch (err) {
      console.error('Failed to move task back to inbox', err);
    }
  };

  const handleDragOverChecklist = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverChecklist(true);
  };

  const handleDragLeaveChecklist = () => {
    setIsDragOverChecklist(false);
  };

  const handleDropOnChecklist = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverChecklist(false);
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    try {
      await updateTask(taskId, {
        isInbox: false,
        isScheduled: false,
        itemType: 'task',
        startTime: '',
        endTime: '',
        durationMinutes: 0
      });
    } catch (err) {
      console.error('Failed to move task back to checklist', err);
    }
  };

  // Convert Inbox to standard task
  const handleMoveToTodoList = async (task: Task) => {
    try {
      await updateTask(task.id, { isInbox: false, isScheduled: false });
    } catch (err) {
      console.error(err);
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

  // Separate tasks
  const inboxTasks = useMemo(() => {
    return tasks.filter((t) => t.isInbox && !t.isCompleted);
  }, [tasks]);

  const todayTasksCountStats = useMemo(() => {
    const todayAll = tasks.filter(t => isTaskActiveOnDay(t, selectedDate) && t.itemType === 'task');
    const done = todayAll.filter(t => isTaskCompletedOnDay(t, selectedDate)).length;
    const total = todayAll.length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
  }, [tasks, selectedDate]);

  const filteredTodoTasks = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (t.itemType !== 'task') return false;

      // Match Selected Day (supports recurring schedules)
      if (!isTaskActiveOnDay(t, selectedDate)) return false;

      // Match Filters
      if (filterCategory !== 'All' && t.category !== filterCategory) return false;
      if (filterPriority !== 'All' && t.priority !== filterPriority) return false;
      if (!showCompleted && isTaskCompletedOnDay(t, selectedDate)) return false;

      return true;
    });

    // Sort the tasks
    return [...filtered].sort((a, b) => {
      if (sortBy === 'priority') {
        const priorityWeight = { High: 3, Medium: 2, Low: 1 };
        const weightA = priorityWeight[a.priority] || 2;
        const weightB = priorityWeight[b.priority] || 2;
        if (weightA !== weightB) {
          return weightB - weightA; // High priority first
        }
        // Fallback to newest created
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      } else if (sortBy === 'dueDate') {
        const dateA = a.dueDate || '';
        const dateB = b.dueDate || '';
        if (dateA !== dateB) {
          return dateA.localeCompare(dateB); // Earliest due date first
        }
        // Fallback to priority
        const priorityWeight = { High: 3, Medium: 2, Low: 1 };
        return (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2);
      } else if (sortBy === 'createdAtNewest') {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeB - timeA; // Newest first
      } else { // createdAtOldest
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeA - timeB; // Oldest first
      }
    });
  }, [tasks, selectedDate, filterCategory, filterPriority, showCompleted, sortBy]);

  return (
    <div className="space-y-6" id="inbox-todo-component">
      {/* Overdue alert indicator */}
      {rolledForwardCount > 0 && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-olive/10 border border-olive/20 animate-pulse shrink-0" id="roll-forward-alert">
          <div className="flex items-center gap-2 text-olive">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-xs font-semibold">
              {rolledForwardCount} incomplete task{rolledForwardCount > 1 ? 's' : ''} rolled forward to Today! Original dates preserved.
            </span>
          </div>
          <span className="text-[10px] font-mono text-natmuted">Auto-Synced</span>
        </div>
      )}

      {/* 1. QUICK CAPTURE INBOX */}
      <div 
        onDragOver={handleDragOverInbox}
        onDragLeave={handleDragLeaveInbox}
        onDrop={handleDropOnInbox}
        className={`bg-cardbg border rounded-3xl p-5 shadow-xs space-y-3.5 transition-all duration-200 ${
          isDragOverInbox ? 'border-olive bg-olive/5 ring-4 ring-olive/10 scale-[1.01]' : 'border-natborder'
        }`} 
        id="quick-capture-container"
      >
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-2 rounded-xl bg-olive/10 text-olive">
            <Inbox className="w-4.5 h-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-bold font-serif italic text-nattext">Brain Dump Inbox</h3>
            <p className="text-[10px] text-natmuted">Instantly dump ideas. Drag to calendar or make a to-do later.</p>
          </div>
        </div>

        {/* Input box */}
        <form onSubmit={handleQuickAddInbox} className="flex gap-2 shrink-0">
          <input
            type="text"
            placeholder="Type anything and press Enter to dump..."
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            className="flex-1 px-4 py-2.5 text-xs bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
            title="Dump idea"
          />
          <button 
            type="submit" 
            className="p-2.5 rounded-xl bg-olive text-white hover:bg-olive/95 active:bg-olive transition-all cursor-pointer flex items-center justify-center"
            title="Quick capture"
          >
            <Plus className="w-4.5 h-4.5" />
          </button>
        </form>

        {/* Inbox Items rendering (Draggable) */}
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1.5 scrollbar-thin" id="inbox-list">
          {inboxTasks.length > 0 ? (
            inboxTasks.map((task) => (
              <div
                key={task.id}
                draggable
                onDragStart={(e) => handleDragStart(e, task.id)}
                className="flex items-center justify-between p-2.5 rounded-xl border border-natborder bg-paper/60 hover:bg-cardbg hover:border-olive/30 cursor-grab active:cursor-grabbing group transition-all"
                title="Drag this item directly onto the hourly calendar!"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="text-olive select-none">⋮⋮</span>
                  <span className="text-xs text-nattext font-medium truncate">{task.title}</span>
                </div>
                <div className="flex items-center gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleMoveToTodoList(task)}
                    onDragStart={(e) => e.stopPropagation()}
                    draggable={false}
                    className="px-2 py-1 bg-olive/10 hover:bg-olive hover:text-white rounded-lg text-[9px] font-bold text-olive transition-all cursor-pointer"
                    title="Move to Active To-Dos"
                  >
                    To-Do
                  </button>
                  <button
                    onClick={() => setTaskToSchedule(task)}
                    onDragStart={(e) => e.stopPropagation()}
                    draggable={false}
                    className="p-1 rounded text-natmuted hover:text-olive transition-colors cursor-pointer flex items-center justify-center"
                    title="Schedule to Crown Planner"
                  >
                    <Clock className="w-3.5 h-3.5 text-olive" />
                  </button>
                  <button
                    onClick={() => onEditTask(task)}
                    onDragStart={(e) => e.stopPropagation()}
                    draggable={false}
                    className="p-1 rounded text-natmuted hover:text-olive transition-colors text-xs font-bold cursor-pointer"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center py-6 text-xs italic text-natmuted font-serif">Inbox is empty. Brain is fully clear!</p>
          )}
        </div>
      </div>

      {/* 2. TO-DO LIST & NATURAL QUICK-ADD */}
      <div 
        onDragOver={handleDragOverChecklist}
        onDragLeave={handleDragLeaveChecklist}
        onDrop={handleDropOnChecklist}
        className={`bg-cardbg border rounded-3xl p-5 shadow-xs space-y-3 transition-all duration-200 ${
          isDragOverChecklist ? 'border-olive bg-olive/5 ring-4 ring-olive/10 scale-[1.01]' : 'border-natborder'
        }`}
        id="todo-list-container"
      >
        <div className="flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-olive/10 text-olive">
              <ListTodo className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-serif italic text-nattext">Active To-Dos</h3>
              <p className="text-[10px] text-natmuted">Specific checklist goals scheduled for the day.</p>
            </div>
          </div>
          
          <button
            onClick={() => onAddTask(selectedDate)}
            className="flex items-center gap-1 px-3 py-1.5 bg-olive text-white rounded-xl text-xs font-semibold hover:bg-olive/90 transition-all cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Detail</span>
          </button>
        </div>

        {/* Natural Language quick add input with preview */}
        <form onSubmit={handleNaturalAddTodo} className="space-y-2 shrink-0">
          <div className="relative">
            <input
              type="text"
              placeholder="e.g. Study Chemistry tomorrow at 3pm (Auto-formats details!)"
              value={todoInput}
              onChange={(e) => handleInputChange(e.target.value)}
              className="w-full pl-3 pr-10 py-2.5 text-xs bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
              title="Natural Quick-Add"
            />
            <div className="absolute right-2 top-2 text-olive/60" title="AI Natural Language Recognition">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>

          {/* AI Parser Feedback Preview */}
          {parsedPreview && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30 text-[10px] text-amber-900 dark:text-amber-200 animate-slide-in">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              <span>
                Add: <strong>"{parsedPreview.title}"</strong> on {parsedPreview.date}
                {parsedPreview.time ? ` at ${parsedPreview.time} (Calendar time-block)` : ' (Standard To-Do)'}
              </span>
              <button 
                type="submit" 
                className="ml-auto bg-amber-600 text-white px-2 py-0.5 rounded font-bold cursor-pointer hover:bg-amber-700 transition-colors"
              >
                Confirm
              </button>
            </div>
          )}
        </form>

        {/* Today's Tasks Progress Bar */}
        {todayTasksCountStats.total > 0 && (
          <div className="space-y-1.5 py-1 my-0.5 shrink-0" id="todo-progress-indicator">
            <div className="flex items-center justify-between text-[11px] font-bold text-natmuted font-mono uppercase tracking-wider">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-olive animate-pulse" />
                Today's Task Progress
              </span>
              <span>{todayTasksCountStats.percent}% ({todayTasksCountStats.done}/{todayTasksCountStats.total} Done)</span>
            </div>
            <div className="w-full h-2 bg-paper rounded-full overflow-hidden border border-natborder/40 relative">
              <motion.div 
                className="h-full bg-gradient-to-r from-olive/80 to-olive rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${todayTasksCountStats.percent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}

        {/* Filters and sorting layout */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 pb-1.5 border-b border-natborder/60 shrink-0" id="todo-filters">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Category Filter */}
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2.5 py-1.5 text-[10px] bg-paper border border-natborder rounded-lg text-nattext focus:outline-none cursor-pointer"
              title="Category Filter"
            >
              <option value="All">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            {/* Priority Filter */}
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="px-2.5 py-1.5 text-[10px] bg-paper border border-natborder rounded-lg text-nattext focus:outline-none cursor-pointer"
              title="Priority Filter"
            >
              <option value="All">All Priorities</option>
              <option value="High">High Only</option>
              <option value="Medium">Medium Only</option>
              <option value="Low">Low Only</option>
            </select>

            {/* Sorting Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-2.5 py-1.5 text-[10px] bg-paper border border-natborder rounded-lg text-nattext focus:outline-none cursor-pointer font-medium"
              title="Sort Tasks"
              id="select-sort-by"
            >
              <option value="priority">Sort: Priority</option>
              <option value="dueDate">Sort: Due Date</option>
              <option value="createdAtNewest">Sort: Created (Newest)</option>
              <option value="createdAtOldest">Sort: Created (Oldest)</option>
            </select>
          </div>

          <label className="flex items-center gap-1.5 text-[10px] text-natmuted cursor-pointer font-semibold">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-olive border-natborder focus:ring-olive cursor-pointer"
            />
            Show Completed
          </label>
        </div>

        {/* To-Do Items List */}
        <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1.5 scrollbar-thin" id="active-todo-items">
          {filteredTodoTasks.length > 0 ? (
            filteredTodoTasks.map((task) => {
              const subCount = task.subtasks.length;
              const subCompletedCount = task.subtasks.filter((s) => s.completed).length;
              const isTaskCompleted = isTaskCompletedOnDay(task, selectedDate);

              return (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  className={`flex flex-col sm:flex-row justify-between items-stretch sm:items-start p-3 rounded-2xl border transition-all cursor-grab active:cursor-grabbing gap-3 sm:gap-4 ${
                    isTaskCompleted 
                      ? 'bg-paper/40 border-natborder text-natmuted opacity-60' 
                      : task.priority === 'High' 
                        ? 'bg-clay/5 border-clay/30 text-nattext hover:border-clay/65' 
                        : 'bg-cardbg border-natborder hover:border-olive/30 text-nattext shadow-2xs'
                  }`}
                  title="Drag this task to the visual calendar timetable on the right to time block it!"
                >
                  <div className="flex items-start gap-2 overflow-hidden flex-1">
                    <span className="text-natmuted/40 font-semibold cursor-grab select-none mt-0.5" title="Drag to schedule">⋮⋮</span>
                    <button
                      onClick={(e) => handleToggleComplete(task, e)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => e.stopPropagation()}
                      draggable={false}
                      className="mt-0.5 text-natmuted hover:text-olive transition-colors cursor-pointer"
                      title={isTaskCompleted ? "Mark incomplete" : "Mark complete"}
                    >
                      {isTaskCompleted ? (
                        <CheckSquare className="w-4.5 h-4.5 text-olive shrink-0" />
                      ) : (
                        <Square className="w-4.5 h-4.5 shrink-0" />
                      )}
                    </button>
                    <div>
                      <div className="flex items-center gap-1.5 text-[10px] text-natmuted font-medium flex-wrap select-none mb-1">
                        {/* Category Label */}
                        <span className={`font-serif italic font-bold tracking-tight ${
                          task.category === 'Study' ? 'text-clay' :
                          task.category === 'Work' ? 'text-olive' : 'text-nattext'
                        }`}>
                          {task.category}
                        </span>
                        
                        <span aria-hidden="true" className="text-natborder/50">·</span>
                        
                        {/* Priority indicator dot + label */}
                        <span className="inline-flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            task.priority === 'High' 
                              ? 'bg-clay animate-pulse' 
                              : task.priority === 'Medium'
                                ? 'bg-amber-500'
                                : 'bg-olive/40'
                          }`} />
                          <span className={`font-medium ${
                            task.priority === 'High' ? 'text-clay font-bold' : ''
                          }`}>
                            {task.priority} Priority
                          </span>
                        </span>

                        {task.isScheduled ? (
                          <>
                            <span aria-hidden="true" className="text-natborder/50">·</span>
                            <span className="text-olive font-semibold font-mono flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5 shrink-0" />
                              <span>{task.startTime}</span>
                            </span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true" className="text-natborder/50">·</span>
                            <span className="text-natmuted/70">Unscheduled</span>
                          </>
                        )}

                        {task.isRecurring && (
                          <>
                            <span aria-hidden="true" className="text-natborder/50">·</span>
                            <span className="text-olive/80 font-medium flex items-center gap-0.5">
                              <span>🔁</span>
                              <span className="capitalize">{task.recurrence?.frequency}</span>
                            </span>
                          </>
                        )}
                      </div>
                      <h4 className={`text-xs font-semibold mt-1 ${isTaskCompleted ? 'line-through text-natmuted' : ''}`}>
                        {task.title}
                      </h4>
                      {task.notes && (
                        <p className="text-[11px] text-natmuted mt-0.5 italic truncate max-w-xs">{task.notes}</p>
                      )}

                      {/* Checklist subtask count indicator */}
                      {subCount > 0 && (
                        <div className="flex items-center gap-1.5 text-[10px] text-natmuted mt-1.5">
                          <CheckSquare className="w-3.5 h-3.5" />
                          <span>{subCompletedCount}/{subCount} checklist items</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 justify-end sm:justify-start shrink-0 pt-1.5 sm:pt-0">
                    <button
                      onClick={() => setTaskToSchedule(task)}
                      onDragStart={(e) => e.stopPropagation()}
                      draggable={false}
                      className="px-2 py-1 hover:bg-paper rounded-lg text-[10px] font-semibold text-olive transition-all cursor-pointer flex items-center gap-0.5"
                      title="Schedule to Crown Planner"
                    >
                      <Clock className="w-3.5 h-3.5 text-olive" />
                      <span>Schedule</span>
                    </button>
                    <button
                      onClick={() => onEditTask(task)}
                      onDragStart={(e) => e.stopPropagation()}
                      draggable={false}
                      className="px-2 py-1 hover:bg-paper rounded-lg text-[10px] font-semibold text-olive transition-all cursor-pointer"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-10 bg-paper/20 rounded-2xl border border-dashed border-natborder">
              <ListTodo className="w-7 h-7 text-natmuted mx-auto mb-2 opacity-35" />
              <p className="text-xs text-natmuted italic">No matching checklist to-dos for today.</p>
            </div>
          )}
        </div>
      </div>

      {/* Schedule to Crown Planner Modal */}
      <AnimatePresence>
        {taskToSchedule && createPortal(
          <div className="fixed inset-0 z-50 overflow-y-auto">
            {/* Backdrop */}
            <div 
              onClick={() => setTaskToSchedule(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
            />
            {/* Content Wrapper */}
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-cardbg border border-natborder rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 z-10"
                id="schedule-task-modal"
              >
                <div className="flex items-center justify-between border-b border-natborder/60 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-olive/10 text-olive">
                      <Clock className="w-4 h-4" />
                    </div>
                    <h3 className="text-base font-serif font-bold italic text-nattext">
                      Schedule to Crown Planner
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTaskToSchedule(null)}
                    className="p-1 rounded-lg text-natmuted hover:text-clay transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4 rotate-45" />
                  </button>
                </div>

                <div className="space-y-1">
                  <p className="text-[10px] text-natmuted font-semibold uppercase tracking-wider">Task Title</p>
                  <p className="text-xs font-bold text-nattext bg-paper/60 border border-natborder/40 p-2.5 rounded-xl">
                    {taskToSchedule.title}
                  </p>
                </div>

                <form onSubmit={handleSaveSchedule} className="space-y-4">
                  {scheduleError && (
                    <div className="p-2.5 rounded-xl bg-clay/10 border border-clay/30 text-[11px] text-clay font-medium">
                      {scheduleError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-[10px] text-natmuted font-semibold uppercase tracking-wider mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-natmuted font-semibold uppercase tracking-wider mb-1">
                          Start Time
                        </label>
                        <input
                          type="time"
                          value={scheduleStartTime}
                          onChange={(e) => setScheduleStartTime(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-natmuted font-semibold uppercase tracking-wider mb-1">
                          End Time
                        </label>
                        <input
                          type="time"
                          value={scheduleEndTime}
                          onChange={(e) => setScheduleEndTime(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-natborder/40">
                    <button
                      type="button"
                      onClick={() => setTaskToSchedule(null)}
                      disabled={isScheduling}
                      className="flex-1 py-2.5 px-4 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isScheduling}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-olive text-white text-xs font-semibold hover:bg-olive/90 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-sm"
                    >
                      {isScheduling ? 'Scheduling...' : 'Confirm Schedule'}
                    </button>
                  </div>
                </form>
              </motion.div>

              {showOverlapConfirm && (
                <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
                  <div className="bg-cardbg border border-natborder rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-4 text-left z-50 animate-scale-up">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 shrink-0">
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                      </div>
                      <div>
                        <h3 className="text-lg font-serif font-bold italic text-nattext">Time Block Overlap!</h3>
                        <p className="text-xs text-natmuted mt-1">
                          The scheduled time <strong>{scheduleStartTime} - {scheduleEndTime}</strong> overlaps with other scheduled items:
                        </p>
                      </div>
                    </div>

                    <div className="bg-paper/40 border border-natborder rounded-2xl p-3.5 space-y-2 max-h-[160px] overflow-y-auto">
                      {overlapDetails.tasks.map((t) => (
                        <div key={t.id} className="flex justify-between text-xs gap-3">
                          <span className="font-semibold text-nattext truncate">📝 {t.title}</span>
                          <span className="text-natmuted font-mono shrink-0">{t.startTime} - {t.endTime}</span>
                        </div>
                      ))}
                      {overlapDetails.habits.map((h) => (
                        <div key={h.id} className="flex justify-between text-xs gap-3">
                          <span className="font-semibold text-nattext truncate">🌿 {h.emoji} {h.name}</span>
                          <span className="text-natmuted font-mono shrink-0">{h.startTime} - {h.endTime}</span>
                        </div>
                      ))}
                    </div>

                    <p className="text-xs text-natmuted leading-relaxed">
                      Would you like to do both tasks (overlap them) or replace the old task(s) with your new task?
                    </p>

                    <div className="flex flex-col gap-2 pt-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            setIsScheduling(true);
                            setShowOverlapConfirm(false);
                            try {
                              await executeSaveSchedule(pendingScheduleData);
                            } catch (err) {
                              console.error(err);
                              setScheduleError('Could not save schedule.');
                            } finally {
                              setIsScheduling(false);
                            }
                          }}
                          className="w-full py-2.5 px-4 rounded-xl bg-paper border border-natborder hover:bg-paper/85 text-xs font-bold text-nattext transition-all cursor-pointer"
                        >
                          Do Both
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setIsScheduling(true);
                            setShowOverlapConfirm(false);
                            try {
                              for (const t of overlapDetails.tasks) {
                                await updateTask(t.id, { isScheduled: false, startTime: '', endTime: '' });
                              }
                              for (const h of overlapDetails.habits) {
                                await updateHabit(h.id, { isScheduled: false, startTime: '', endTime: '' });
                              }
                              await executeSaveSchedule(pendingScheduleData);
                            } catch (err) {
                              console.error(err);
                              setScheduleError('Could not replace old tasks.');
                            } finally {
                              setIsScheduling(false);
                            }
                          }}
                          className="w-full py-2.5 px-4 rounded-xl bg-olive hover:bg-olive/90 text-xs font-bold text-white shadow-xs transition-all cursor-pointer"
                        >
                          Replace Old
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowOverlapConfirm(false);
                          setPendingScheduleData(null);
                        }}
                        className="w-full py-2 text-xs font-semibold text-natmuted hover:text-nattext transition-all cursor-pointer"
                      >
                        Go Back & Adjust Time
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      </AnimatePresence>

      {/* Custom Delete Confirmation Modal */}
      <AnimatePresence>
        {taskToDelete && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div 
              onClick={() => {
                setTaskToDelete(null);
                setDeleteType(null);
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
              id="delete-confirmation-modal"
            >
              <div className="w-12 h-12 rounded-full bg-clay/10 text-clay flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6 animate-pulse" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-base font-serif font-bold italic text-nattext">
                  Confirm Deletion
                </h3>
                <p className="text-xs text-natmuted leading-relaxed">
                  Are you sure you want to delete the {deleteType === 'raw' ? 'brain dump' : 'to-do task'} <strong className="text-nattext font-medium">"{taskToDelete.title}"</strong>? This action cannot be undone.
                </p>
                {deleteError && (
                  <p className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/30 p-2.5 rounded-xl mt-2 font-mono break-all border border-rose-250/30">
                    Error: {deleteError}
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setTaskToDelete(null);
                    setDeleteType(null);
                    setDeleteError(null);
                  }}
                  disabled={isDeleting}
                  className="flex-1 py-2 px-4 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!taskToDelete) return;
                    setIsDeleting(true);
                    setDeleteError(null);
                    try {
                      await deleteTask(taskToDelete.id);
                      setTaskToDelete(null);
                      setDeleteType(null);
                    } catch (err: any) {
                      console.error("Failed to delete task:", err);
                      setDeleteError(err.message || String(err));
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                  disabled={isDeleting}
                  className="flex-1 py-2 px-4 rounded-xl bg-clay text-white text-xs font-semibold hover:bg-clay/90 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>,
          document.body
        )}
      </AnimatePresence>

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
