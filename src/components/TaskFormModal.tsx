import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Task, TaskPriority, TaskCategory, RecurrenceFrequency, Subtask, Habit } from '../types';
import { X, Plus, Trash2, CheckCircle, Clock, Calendar, AlertTriangle, Layers } from 'lucide-react';
import { createTask, updateTask, deleteTask, updateHabit } from '../lib/db';

interface TaskFormModalProps {
  userId: string;
  editTask: Task | null;
  onClose: () => void;
  defaultDate?: string; // e.g. "2026-07-04"
  defaultScheduled?: boolean;
  defaultStartTime?: string;
  defaultEndTime?: string;
  tasks?: Task[];
  habits?: Habit[];
}

const CATEGORIES: TaskCategory[] = ['Study', 'Work', 'Personal', 'Business', 'Health', 'Leisure', 'Other'];
const PRIORITIES: TaskPriority[] = ['High', 'Medium', 'Low'];

export default function TaskFormModal({
  userId,
  editTask,
  onClose,
  defaultDate,
  defaultScheduled,
  defaultStartTime = '',
  defaultEndTime = '',
  tasks = [],
  habits = []
}: TaskFormModalProps) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [category, setCategory] = useState<string>('Personal');
  const [dueDate, setDueDate] = useState('');
  
  // Subtasks/Checklist
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  // Location/Time state
  const [isScheduled, setIsScheduled] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  // Recurrence
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFrequency>('daily');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]); // 0 = Sunday, 1 = Monday...

  const [itemType, setItemType] = useState<'task' | 'class'>('task');
  const [isInbox, setIsInbox] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Overlap resolution states
  const [showOverlapConfirm, setShowOverlapConfirm] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<any>(null);
  const [overlapDetails, setOverlapDetails] = useState<{ tasks: Task[], habits: Habit[] }>({ tasks: [], habits: [] });

  // Initialize fields on Edit mode
  useEffect(() => {
    const todayStr = defaultDate || new Date().toISOString().split('T')[0];
    
    console.log('[Aura Debug] TaskFormModal useEffect triggered:', {
      editTask: editTask ? { id: editTask.id, title: editTask.title, isScheduled: editTask.isScheduled, itemType: editTask.itemType } : null,
      defaultScheduled,
      defaultStartTime,
      defaultEndTime,
      defaultDate
    });

    if (editTask) {
      setTitle(editTask.title);
      setNotes(editTask.notes || '');
      setPriority(editTask.priority);
      setCategory(editTask.category);
      // If we are scheduling via a drag-and-drop event, use the target date; otherwise, preserve the task's existing due date to prevent it from resetting or disappearing
      const initialDueDate = (defaultScheduled && defaultDate) ? defaultDate : (editTask.dueDate || defaultDate || todayStr);
      setDueDate(initialDueDate);
      setSubtasks(editTask.subtasks || []);
      
      const nextScheduled = defaultScheduled !== undefined ? defaultScheduled : (editTask.isScheduled || false);
      setIsScheduled(nextScheduled);
      
      const resolvedItemType = defaultScheduled !== undefined 
        ? (defaultScheduled ? 'class' : 'task') 
        : (editTask.isScheduled ? 'class' : (editTask.itemType || 'task'));
      
      console.log('[Aura Debug] Resolved initialization values:', {
        nextScheduled,
        resolvedItemType,
        editTaskIsScheduled: editTask.isScheduled,
        editTaskItemType: editTask.itemType
      });

      setItemType(resolvedItemType);
      setStartTime(defaultStartTime || editTask.startTime || '');
      setEndTime(defaultEndTime || editTask.endTime || '');
      setIsRecurring(editTask.isRecurring || false);
      setIsInbox(editTask.isInbox !== undefined ? editTask.isInbox : false);
      if (editTask.recurrence) {
        setRecurrenceFreq(editTask.recurrence.frequency);
        setRecurrenceDays(editTask.recurrence.weekdays || []);
      }
    } else {
      setTitle('');
      setNotes('');
      setPriority('Medium');
      setCategory('Personal');
      setDueDate(todayStr);
      setSubtasks([]);
      setIsScheduled(defaultScheduled || false);
      setItemType(defaultScheduled ? 'class' : 'task');
      setStartTime(defaultStartTime);
      setEndTime(defaultEndTime);
      setIsRecurring(false);
      setIsInbox(!defaultScheduled); // default to task list/timeline if we drag onto schedule
    }
  }, [editTask, defaultDate, defaultScheduled, defaultStartTime, defaultEndTime]);

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    const sub: Subtask = {
      id: `sub_${Date.now()}`,
      title: newSubtaskTitle.trim(),
      completed: false
    };
    setSubtasks([...subtasks, sub]);
    setNewSubtaskTitle('');
  };

  const handleToggleSubtask = (id: string) => {
    setSubtasks(
      subtasks.map((sub) => sub.id === id ? { ...sub, completed: !sub.completed } : sub)
    );
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks(subtasks.filter((sub) => sub.id !== id));
  };

  const handleToggleDay = (day: number) => {
    if (recurrenceDays.includes(day)) {
      setRecurrenceDays(recurrenceDays.filter((d) => d !== day));
    } else {
      setRecurrenceDays([...recurrenceDays, day]);
    }
  };

  // Helper to calculate duration in minutes
  const calculateDuration = (start: string, end: string): number => {
    if (!start || !end) return 60; // default 1 hour
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const diffMins = (endH * 60 + endM) - (startH * 60 + startM);
    return diffMins > 0 ? diffMins : 60;
  };

  const executeSave = async (taskData: any) => {
    if (editTask) {
      const oldRescheduleCount = typeof editTask.rescheduleCount === 'number' ? editTask.rescheduleCount : 0;
      await updateTask(editTask.id, {
        ...taskData,
        rescheduleCount: editTask.dueDate !== taskData.dueDate ? oldRescheduleCount + 1 : oldRescheduleCount
      });
    } else {
      await createTask(userId, taskData);
    }
    onClose();
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    const shouldBeScheduled = itemType === 'class';

    if (shouldBeScheduled && (!startTime || !endTime)) {
      setError('Please specify start and end times for scheduled events');
      return;
    }

    if (shouldBeScheduled && startTime >= endTime) {
      setError('End time must be after start time');
      return;
    }

    const durationMinutes = shouldBeScheduled ? calculateDuration(startTime, endTime) : 0;
    const todayStr = dueDate || new Date().toISOString().split('T')[0];

    const taskData = {
      title: title.trim(),
      notes: notes.trim(),
      priority,
      category,
      dueDate: todayStr,
      subtasks,
      isCompleted: editTask ? editTask.isCompleted : false,
      completedDates: editTask ? (editTask.completedDates || []) : [],
      isInbox,
      isScheduled: shouldBeScheduled,
      startTime: shouldBeScheduled ? startTime : '',
      endTime: shouldBeScheduled ? endTime : '',
      durationMinutes,
      isRecurring,
      itemType,
      recurrence: isRecurring ? {
        frequency: recurrenceFreq,
        weekdays: recurrenceFreq === 'weekly' || recurrenceFreq === 'weekdays' ? recurrenceDays : []
      } : undefined,
      originalDueDate: editTask ? (editTask.originalDueDate || editTask.dueDate) : todayStr,
    };

    if (shouldBeScheduled) {
      const overlappingTasks = tasks.filter((t) => {
        if (!t.isScheduled || t.dueDate !== todayStr || t.id === editTask?.id || !t.startTime || !t.endTime) return false;
        return t.startTime < endTime && t.endTime > startTime;
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

        if (!h.isScheduled || !h.startTime || !h.endTime || !isHabitScheduledForDay(h, todayStr)) return false;
        return h.startTime < endTime && h.endTime > startTime;
      });

      if (overlappingTasks.length > 0 || overlappingHabits.length > 0) {
        setPendingSaveData(taskData);
        setOverlapDetails({ tasks: overlappingTasks, habits: overlappingHabits });
        setShowOverlapConfirm(true);
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      await executeSave(taskData);
    } catch (err: any) {
      console.error(err);
      setError('Could not save task. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-xs cursor-pointer"
      />
      {/* Content Wrapper */}
      <div 
        onClick={(e) => e.stopPropagation()}
        className="relative bg-dialogbg border border-natborder rounded-3xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh] z-10"
        id="task-form-modal"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-natborder bg-paper">
          <h2 className="text-xl font-serif font-semibold text-nattext italic">
            {editTask ? 'Edit Task' : 'Create Task'}
          </h2>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-clay/10 text-natmuted hover:text-clay transition-all cursor-pointer"
            id="close-modal-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2 p-3.5 rounded-xl bg-clay/10 border border-clay/20 text-clay text-xs" id="form-error">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-natmuted" htmlFor="task-title">Task Title *</label>
            <input
              id="task-title"
              type="text"
              placeholder="e.g. Study for Biology Exam"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 text-sm bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
              required
            />
          </div>

          {/* Custom Category Styles Helper */}
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
                  <label className="text-xs font-semibold uppercase tracking-wider text-natmuted">Category Color Theme</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {CATEGORIES.map((cat) => {
                      const styles = getCategoryStyles(cat);
                      const isSelected = category === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setCategory(cat)}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                            isSelected 
                              ? `${styles.bg} ${styles.border} ${styles.text} ring-2 ring-olive/20 shadow-2xs` 
                              : 'bg-paper border-natborder/60 text-natmuted hover:bg-paper/80'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${styles.dot}`} />
                          <span>{cat}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Priority Selector Row */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-natmuted" htmlFor="task-priority">Priority Level</label>
                  <div className="flex gap-1.5 bg-paper border border-natborder rounded-xl p-1.5" id="priority-toggle-group">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        className={`flex-1 text-center py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                          priority === p 
                            ? p === 'High' 
                              ? 'bg-clay text-white shadow-xs' 
                              : p === 'Medium'
                                ? 'bg-olive text-white shadow-xs'
                                : 'bg-natmuted text-white shadow-xs'
                            : 'text-natmuted hover:text-nattext'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Destination Location */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-natmuted">Planning Item Type</label>
              <div className="grid grid-cols-2 gap-2 bg-paper border border-natborder rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => { setItemType('task'); setIsScheduled(false); }}
                  className={`text-center py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    itemType === 'task' ? 'bg-olive text-white shadow-xs' : 'text-natmuted hover:text-nattext'
                  }`}
                >
                  📝 To-Do / Task
                </button>
                <button
                  type="button"
                  onClick={() => { setItemType('class'); setIsScheduled(true); }}
                  className={`text-center py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    itemType === 'class' ? 'bg-olive text-white shadow-xs' : 'text-natmuted hover:text-nattext'
                  }`}
                >
                  🎓 Class / Scheduled Event
                </button>
              </div>
            </div>

            {itemType === 'task' && (
              <div className="space-y-1.5 animate-slide-in">
                <label className="text-[10px] font-bold uppercase tracking-wider text-natmuted" htmlFor="task-destination">Task Destination</label>
                <div className="grid grid-cols-2 gap-2 bg-paper/50 border border-natborder/60 rounded-xl p-1" id="task-destination">
                  <button
                    type="button"
                    onClick={() => { setIsInbox(true); }}
                    className={`text-center py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      isInbox ? 'bg-clay text-white shadow-xs' : 'text-natmuted hover:text-nattext'
                    }`}
                  >
                    Inbox (Dump)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsInbox(false); }}
                    className={`text-center py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      !isInbox ? 'bg-clay text-white shadow-xs' : 'text-natmuted hover:text-nattext'
                    }`}
                  >
                    To-Do List View
                  </button>
                </div>
              </div>
            )}

            {itemType === 'class' && (
              <div className="space-y-1.5 animate-slide-in">
                <label className="text-[10px] font-bold uppercase tracking-wider text-natmuted" htmlFor="class-destination">Inbox Destination</label>
                <div className="grid grid-cols-2 gap-2 bg-paper/50 border border-natborder/60 rounded-xl p-1" id="class-destination">
                  <button
                    type="button"
                    onClick={() => { setIsInbox(true); }}
                    className={`text-center py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      isInbox ? 'bg-clay text-white shadow-xs' : 'text-natmuted hover:text-nattext'
                    }`}
                  >
                    Keep in Inbox
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsInbox(false); }}
                    className={`text-center py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      !isInbox ? 'bg-clay text-white shadow-xs' : 'text-natmuted hover:text-nattext'
                    }`}
                  >
                    Remove from Inbox
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Due Date & Times (Visible only if not raw Inbox item) */}
          <div className="space-y-4 pt-1 border-t border-natborder/60">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-natmuted flex items-center gap-1.5" htmlFor="task-due-date">
                  <Calendar className="w-3.5 h-3.5" />
                  Due Date
                </label>
                <input
                  id="task-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
                />
              </div>

              {itemType === 'class' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-natmuted flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Time Slots
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full px-2 py-2.5 text-xs bg-paper border border-natborder rounded-xl focus:outline-none text-center text-nattext"
                      title="Start Time"
                    />
                    <span className="text-natmuted text-xs">to</span>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full px-2 py-2.5 text-xs bg-paper border border-natborder rounded-xl focus:outline-none text-center text-nattext"
                      title="End Time"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Recurring Option */}
          <div className="space-y-3 pt-3 border-t border-natborder/60">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-nattext flex items-center gap-1.5" htmlFor="is-recurring">
                <Layers className="w-4 h-4 text-olive" />
                Make Recurring Event
              </label>
              <input
                id="is-recurring"
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="w-4 h-4 rounded border-natborder text-olive focus:ring-olive cursor-pointer"
              />
            </div>

            {isRecurring && (
              <div className="bg-paper p-4 rounded-2xl border border-natborder space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-natmuted uppercase">Frequency:</span>
                  <div className="flex gap-1.5">
                    {(['daily', 'weekly', 'weekdays', 'monthly'] as RecurrenceFrequency[]).map((freq) => (
                      <button
                        key={freq}
                        type="button"
                        onClick={() => setRecurrenceFreq(freq)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          recurrenceFreq === freq 
                            ? 'bg-olive text-white' 
                            : 'bg-cardbg border border-natborder text-natmuted hover:text-nattext'
                        }`}
                      >
                        {freq}
                      </button>
                    ))}
                  </div>
                </div>

                {(recurrenceFreq === 'weekly' || recurrenceFreq === 'weekdays') && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-natmuted uppercase block">Select Days:</span>
                    <div className="flex justify-between gap-1">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dayChar, idx) => {
                        // Weekdays only shows M-F by default
                        const isSelected = recurrenceDays.includes(idx);
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleToggleDay(idx)}
                            className={`w-8 h-8 rounded-full text-xs font-bold transition-all cursor-pointer ${
                              isSelected 
                                ? 'bg-clay text-white' 
                                : 'bg-cardbg border border-natborder text-natmuted hover:bg-clay/10'
                            }`}
                          >
                            {dayChar}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Checklist / Subtasks Section */}
          <div className="space-y-3 pt-3 border-t border-natborder/60">
            <label className="text-xs font-semibold uppercase tracking-wider text-natmuted">Subtasks Checklist</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add subtask item..."
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSubtask())}
                className="flex-1 px-3.5 py-2 text-sm bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-1 focus:ring-olive focus:border-olive text-nattext"
                title="New Subtask Title"
              />
              <button
                type="button"
                onClick={handleAddSubtask}
                className="p-2.5 rounded-xl bg-olive text-white hover:bg-olive/90 active:bg-olive transition-all cursor-pointer"
                title="Add Subtask"
              >
                <Plus className="w-4.5 h-4.5" />
              </button>
            </div>

            {subtasks.length > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 bg-paper/50 p-2 rounded-xl border border-natborder/60">
                {subtasks.map((sub) => (
                  <div key={sub.id} className="flex items-center justify-between gap-2 p-1.5 hover:bg-cardbg rounded-lg group transition-colors">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sub.completed}
                        onChange={() => handleToggleSubtask(sub.id)}
                        className="w-4 h-4 rounded text-olive border-natborder focus:ring-olive cursor-pointer"
                        title="Complete Subtask"
                      />
                      <span className={`text-xs font-sans ${sub.completed ? 'line-through text-natmuted' : 'text-nattext'}`}>
                        {sub.title}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSubtask(sub.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-clay hover:bg-clay/10 transition-all cursor-pointer"
                      title="Delete Subtask"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5 pt-1 border-t border-natborder/60">
            <label className="text-xs font-semibold uppercase tracking-wider text-natmuted" htmlFor="task-notes">Description / Notes</label>
            <textarea
              id="task-notes"
              placeholder="Add extra context or instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 text-sm bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all resize-none"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4.5 bg-paper border-t border-natborder flex justify-end items-center gap-3.5">
          {editTask && (
            <div className="mr-auto flex items-center gap-2">
              {!confirmDelete ? (
                <button
                  id="btn-delete-task-trigger"
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-xl bg-clay/10 hover:bg-clay hover:text-white border border-clay/30 text-clay text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Delete this task/class"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete</span>
                </button>
              ) : (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 animate-slide-in bg-paper border border-natborder/60 p-2.5 rounded-2xl shadow-2xs">
                  <span className="text-[10px] text-clay font-bold uppercase tracking-wider mr-1">Confirm Delete:</span>
                  {editTask.isRecurring ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        id="btn-delete-task-occurrence"
                        type="button"
                        onClick={async () => {
                          setSaving(true);
                          try {
                            const cancelledDates = editTask.cancelledDates ? [...editTask.cancelledDates] : [];
                            if (!cancelledDates.includes(dueDate)) {
                              cancelledDates.push(dueDate);
                            }
                            await updateTask(editTask.id, { cancelledDates });
                            onClose();
                          } catch (err) {
                            console.error("Failed to cancel occurrence:", err);
                            setError("Failed to delete occurrence. Please try again.");
                            setConfirmDelete(false);
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                        className="px-2.5 py-1.5 rounded-lg bg-clay text-white text-[10px] font-bold hover:bg-clay/90 transition-all cursor-pointer"
                        title={`Delete only the class occurrence on ${dueDate}`}
                      >
                        This Occurrence Only
                      </button>
                      <button
                        id="btn-delete-task-series"
                        type="button"
                        onClick={async () => {
                          setSaving(true);
                          try {
                            await deleteTask(editTask.id);
                            onClose();
                          } catch (err) {
                            console.error("Failed to delete task series:", err);
                            setError("Failed to delete series. Please try again.");
                            setConfirmDelete(false);
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-650 hover:bg-rose-700 text-white text-[10px] font-bold transition-all cursor-pointer"
                        title="Delete the entire recurring class/task series"
                      >
                        Entire Series
                      </button>
                    </div>
                  ) : (
                    <button
                      id="btn-delete-task-confirm"
                      type="button"
                      onClick={async () => {
                        setSaving(true);
                        try {
                          await deleteTask(editTask.id);
                          onClose();
                        } catch (err) {
                          console.error("Failed to delete task:", err);
                          setError("Failed to delete task. Please try again.");
                          setConfirmDelete(false);
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving}
                      className="px-3 py-1.5 rounded-lg bg-clay text-white text-[10px] font-bold hover:bg-clay/90 transition-all cursor-pointer"
                    >
                      Delete
                    </button>
                  )}
                  <button
                    id="btn-delete-task-cancel"
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg border border-natborder text-natmuted text-[10px] font-bold hover:bg-paper transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            id="btn-cancel"
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-natborder hover:bg-cardbg active:bg-paper text-natmuted hover:text-nattext text-xs font-semibold transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            id="btn-save-task"
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-olive text-white hover:bg-olive/90 active:bg-olive disabled:opacity-50 text-xs font-semibold shadow-md shadow-olive/10 transition-all cursor-pointer min-w-[90px] flex items-center justify-center gap-1.5"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Save Plan</span>
              </>
            )}
          </button>
        </div>
      </div>

      {showOverlapConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-dialogbg border border-natborder rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-4 text-left z-50 animate-scale-up">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h3 className="text-lg font-serif font-bold italic text-nattext">Time Block Overlap!</h3>
                <p className="text-xs text-natmuted mt-1">
                  The scheduled time <strong>{startTime} - {endTime}</strong> overlaps with other scheduled items:
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
                    setSaving(true);
                    setShowOverlapConfirm(false);
                    try {
                      await executeSave(pendingSaveData);
                    } catch (err) {
                      console.error(err);
                      setError('Could not save task.');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-paper border border-natborder hover:bg-paper/85 text-xs font-bold text-nattext transition-all cursor-pointer"
                >
                  Do Both
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setSaving(true);
                    setShowOverlapConfirm(false);
                    try {
                      for (const t of overlapDetails.tasks) {
                        await updateTask(t.id, { isScheduled: false, startTime: '', endTime: '' });
                      }
                      for (const h of overlapDetails.habits) {
                        await updateHabit(h.id, { isScheduled: false, startTime: '', endTime: '' });
                      }
                      await executeSave(pendingSaveData);
                    } catch (err) {
                      console.error(err);
                      setError('Could not replace old tasks.');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-olive hover:bg-olive/90 text-xs font-bold text-white shadow-xs transition-all cursor-pointer"
                >
                  Replace Old Task
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowOverlapConfirm(false);
                  setPendingSaveData(null);
                }}
                className="w-full py-2 text-xs font-semibold text-natmuted hover:text-nattext transition-all cursor-pointer"
              >
                Go Back & Adjust Time
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
