import React, { useState, useMemo } from 'react';
import { Task, Habit, HabitLog } from '../types';
import { isTaskScheduledForDay, parseDateLocal, isTaskCompletedOnDay } from '../lib/taskHelpers';
import { 
  Bell, X, Sunrise, Moon, Coffee, ShieldCheck, 
  Sparkles, Clock, CheckCircle2, Volume2, AlertCircle, Loader2
} from 'lucide-react';

interface AuraAssistantProps {
  tasks: Task[];
  habits: Habit[];
  habitLogs: HabitLog[];
  selectedDate: string;
  onClose: () => void;
}

export default function AuraAssistant({
  tasks,
  habits,
  habitLogs,
  selectedDate,
  onClose
}: AuraAssistantProps) {
  const [selectedReminderId, setSelectedReminderId] = useState<string>('');
  const [reminderMinutes, setReminderMinutes] = useState<number>(15);
  const [activeReminders, setActiveReminders] = useState<{ [id: string]: number }>({});
  const [simulatedAlert, setSimulatedAlert] = useState<{ title: string; category: string; text: string } | null>(null);

  // New real AI Coach states
  const [aiCoachResponse, setAiCoachResponse] = useState<{
    summary: string;
    actionTips: string[];
    focusPrompt: string;
  } | null>(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);

  // Filter tasks & habits scheduled for selected date
  const todaysTasks = useMemo(() => {
    return tasks.filter(t => isTaskScheduledForDay(t, selectedDate) && !isTaskCompletedOnDay(t, selectedDate));
  }, [tasks, selectedDate]);

  const todaysHabits = useMemo(() => {
    const isHabitScheduledForDay = (habit: Habit, dateStr: string) => {
      if (habit.startDate && dateStr < habit.startDate) return false;
      if (habit.endDate && dateStr > habit.endDate) return false;
      const date = parseDateLocal(dateStr);
      const dayOfWeek = date.getDay();
      if (habit.scheduleType === 'daily') return true;
      if (habit.scheduleType === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
      if (habit.scheduleType === 'specific_days') return habit.weekdays?.some(w => Number(w) === dayOfWeek);
      return true;
    };
    return habits.filter(h => isHabitScheduledForDay(h, selectedDate));
  }, [habits, selectedDate]);

  const fetchAiCoachingAdvice = async () => {
    setLoadingAdvice(true);
    setAdviceError(null);
    try {
      const res = await fetch('/api/gemini/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: todaysTasks.map(t => ({ title: t.title, priority: t.priority, category: t.category, startTime: t.startTime, endTime: t.endTime })),
          habits: todaysHabits.map(h => ({ name: h.name, category: h.category, scheduleType: h.scheduleType })),
          habitLogs: habitLogs.filter(l => l.date === selectedDate).map(l => ({ status: l.status })),
          selectedDate
        })
      });
      if (!res.ok) {
        throw new Error("Coaching request failed");
      }
      const data = await res.json();
      setAiCoachResponse(data);
    } catch (err: any) {
      console.error("Failed to generate AI advice:", err);
      setAdviceError("Mindful server is busy. Click below to try again.");
    } finally {
      setLoadingAdvice(false);
    }
  };

  // Handle reminder configuration
  const handleSetReminder = (id: string, mins: number) => {
    setActiveReminders(prev => ({
      ...prev,
      [id]: mins
    }));
    // Clear selection
    setSelectedReminderId('');
  };

  const handleSimulateReminder = (title: string, category: string, mins: number) => {
    // Generate a beautiful, mindful reminder message
    const reminderMessages = [
      `Gently prepare your focus. Take a deep breath. Your planned block starts in ${mins === 0 ? 'just a moment' : mins + ' minutes'}.`,
      `Transition mindfully. Clear your physical workspace and pause any distractions. Starting soon.`,
      `Time block checkpoint. Honor your scheduled intent. Your wellness is anchored in your structure.`
    ];
    const text = reminderMessages[Math.floor(Math.random() * reminderMessages.length)];

    setSimulatedAlert({
      title,
      category,
      text
    });
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-3xs" 
      id="aura-assistant-overlay"
    >
      {/* Simulation alert modal overlay */}
      {simulatedAlert && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in" 
          id="reminder-simulated-modal"
        >
          <div className="bg-cardbg border-2 border-olive rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 text-center">
            <div className="w-14 h-14 rounded-full bg-olive/10 text-olive flex items-center justify-center mx-auto">
              <Volume2 className="w-7 h-7 animate-bounce" />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-olive font-mono">
                🔔 Mindful Reminder • {simulatedAlert.category}
              </span>
              <h3 className="text-lg font-serif font-bold text-nattext italic">
                {simulatedAlert.title}
              </h3>
              <p className="text-xs text-natmuted leading-relaxed pt-2">
                "{simulatedAlert.text}"
              </p>
            </div>
            <button
              onClick={() => setSimulatedAlert(null)}
              className="w-full py-2.5 bg-olive hover:bg-olive/90 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Acknowledge & Begin
            </button>
          </div>
        </div>
      )}

      {/* Main Slide-out Panel */}
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-assistantbg border-l border-natborder w-full max-w-md h-full shadow-2xl flex flex-col animate-slide-in"
        id="aura-assistant-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-natborder bg-sand/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-olive text-white flex items-center justify-center">
              <Bell className="w-4.5 h-4.5" />
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-olive font-mono">Real-Time Assistant</span>
              <h2 className="text-base font-serif font-bold text-nattext italic">Crown Guidance & Notifications</h2>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-clay/10 text-natmuted hover:text-clay cursor-pointer transition-all"
            id="close-assistant-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Panel Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* 1. MORNING SUMMARY */}
          <div className="bg-sand/20 border border-olive/20 rounded-3xl p-5 space-y-4" id="morning-summary-card">
            <div className="flex items-center gap-2">
              <Sunrise className="w-5 h-5 text-olive shrink-0" />
              <h3 className="text-sm font-bold font-serif italic text-nattext">Your Morning Focus Summary</h3>
            </div>
            <p className="text-xs text-natmuted leading-relaxed">
              Good morning! Today, your schedule features <strong>{todaysTasks.length}</strong> scheduled time blocks and <strong>{todaysHabits.length}</strong> deck habits to fulfill.
            </p>
            
            {/* AI Advice Generator */}
            {!aiCoachResponse ? (
              <div className="space-y-3">
                <p className="text-xs text-natmuted">Get tailored, dynamic coaching advice for your schedule today from Gemini.</p>
                <button
                  onClick={fetchAiCoachingAdvice}
                  disabled={loadingAdvice}
                  className="w-full py-2.5 bg-olive text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
                >
                  {loadingAdvice ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Consulting AI Mentor...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Get Personalized AI Advice</span>
                    </>
                  )}
                </button>
                {adviceError && (
                  <p className="text-[10px] text-clay font-bold text-center">{adviceError}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3.5">
                <div className="bg-cardbg/80 rounded-2xl p-3.5 border border-natborder/60 text-xs text-nattext space-y-2">
                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-olive font-mono flex items-center gap-1 justify-between">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      Crown AI Guidance
                    </span>
                    <button 
                      onClick={fetchAiCoachingAdvice}
                      disabled={loadingAdvice}
                      className="text-[9px] underline cursor-pointer text-clay font-bold"
                      title="Recalculate advice"
                    >
                      {loadingAdvice ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </span>
                  <p className="italic leading-relaxed">"{aiCoachResponse.summary}"</p>
                </div>

                <div className="space-y-2">
                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-natmuted font-mono block">Actionable focus steps:</span>
                  <ul className="space-y-1.5">
                    {aiCoachResponse.actionTips.map((tip, idx) => (
                      <li key={idx} className="text-xs text-nattext flex items-start gap-1.5 leading-relaxed">
                        <span className="text-olive select-none pt-0.5">•</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-t border-natborder/30 pt-3">
                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-clay font-mono block mb-1">Today's Focus Intention:</span>
                  <p className="text-xs text-clay font-semibold italic">"{aiCoachResponse.focusPrompt}"</p>
                </div>
              </div>
            )}
          </div>

          {/* 2. TASK & HABIT REMINDERS SCHEDULER */}
          <div className="space-y-4" id="reminder-scheduler">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-natmuted flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-olive" />
                Custom Reminder Timings
              </h3>
              <p className="text-[11px] text-natmuted mt-0.5">Configure warning alerts before scheduled events start, and simulate real-time notifications.</p>
            </div>

            <div className="space-y-3">
              {/* Combine items */}
              {todaysTasks.length === 0 && todaysHabits.length === 0 ? (
                <p className="text-xs italic text-natmuted py-4 text-center">No scheduled items found for today to setup alerts.</p>
              ) : (
                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {/* Task reminders */}
                  {todaysTasks.map(task => {
                    const savedMin = activeReminders[task.id];
                    return (
                      <div key={task.id} className="p-3 bg-paper rounded-2xl border border-natborder flex flex-col gap-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[9px] font-bold text-olive uppercase font-mono tracking-wider">{task.category}</span>
                            <h4 className="text-xs font-bold text-nattext truncate max-w-[180px]">{task.title}</h4>
                            <span className="text-[10px] text-natmuted">Starts: {task.startTime}</span>
                          </div>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-olive/10 text-olive">
                            {savedMin !== undefined ? `Alert: ${savedMin}m prior` : 'No alert set'}
                          </span>
                        </div>

                        <div className="flex gap-2 mt-1">
                          <select
                            title="Reminder minutes before start"
                            value={savedMin ?? 15}
                            onChange={(e) => handleSetReminder(task.id, Number(e.target.value))}
                            className="text-[10px] bg-cardbg border border-natborder rounded-lg px-2 py-1 text-nattext cursor-pointer focus:outline-none"
                          >
                            <option value={0}>At start time</option>
                            <option value={5}>5m before</option>
                            <option value={10}>10m before</option>
                            <option value={15}>15m before</option>
                            <option value={30}>30m before</option>
                          </select>
                          <button
                            onClick={() => handleSimulateReminder(task.title, task.category, savedMin ?? 15)}
                            className="flex-1 py-1 px-2 border border-olive text-olive hover:bg-olive/10 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Volume2 className="w-3 h-3" />
                            <span>Simulate Alert</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Habit reminders */}
                  {todaysHabits.map(habit => {
                    const savedMin = activeReminders[habit.id];
                    return (
                      <div key={habit.id} className="p-3 bg-paper rounded-2xl border border-natborder flex flex-col gap-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[9px] font-bold text-emerald-600 uppercase font-mono tracking-wider">Habit</span>
                            <h4 className="text-xs font-bold text-nattext truncate max-w-[180px]">{habit.name}</h4>
                            <span className="text-[10px] text-natmuted">Type: {habit.scheduleType}</span>
                          </div>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                            {savedMin !== undefined ? `Alert: ${savedMin}m prior` : 'No alert set'}
                          </span>
                        </div>

                        <div className="flex gap-2 mt-1">
                          <select
                            title="Reminder minutes before start"
                            value={savedMin ?? 15}
                            onChange={(e) => handleSetReminder(habit.id, Number(e.target.value))}
                            className="text-[10px] bg-cardbg border border-natborder rounded-lg px-2 py-1 text-nattext cursor-pointer focus:outline-none"
                          >
                            <option value={0}>At start time</option>
                            <option value={5}>5m before</option>
                            <option value={10}>10m before</option>
                            <option value={15}>15m before</option>
                            <option value={30}>30m before</option>
                          </select>
                          <button
                            onClick={() => handleSimulateReminder(habit.name, 'Habit Tracker', savedMin ?? 15)}
                            className="flex-1 py-1 px-2 border border-emerald-600 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Volume2 className="w-3 h-3" />
                            <span>Simulate Alert</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>



        </div>

        {/* Footer */}
        <div className="p-4 border-t border-natborder bg-paper text-center">
          <span className="text-[10px] font-semibold text-natmuted flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-olive" />
            <span>Crown Workspace Assistant Synchronized</span>
          </span>
        </div>
      </div>
    </div>
  );
}
