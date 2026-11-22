import { useState, useEffect, useMemo } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import { subscribeTasks, subscribeHabits, subscribeHabitLogs, updateTask } from './lib/db';
import { isTaskActiveOnDay, calculateHabitStreaks, parseDateLocal, isTaskCompletedOnDay, isTaskScheduledForDay } from './lib/taskHelpers';
import { Task, Habit, HabitLog } from './types';
import { motion, AnimatePresence } from 'motion/react';

// Components
import Auth from './components/Auth';
import VisualTimeline from './components/VisualTimeline';
import InboxAndTodoList from './components/InboxAndTodoList';
import HabitsTracker from './components/HabitsTracker';
import TimetableParser from './components/TimetableParser';
import TaskFormModal from './components/TaskFormModal';
import AuraAssistant from './components/AuraAssistant';
import PageScrollAssistant from './components/PageScrollAssistant';

// Icons
import { 
  Sparkles, ListTodo, CalendarRange, BarChart2, LogOut, Loader2,
  Activity, Flame, Bell, Sun, Moon, Clock, ChevronDown, ChevronUp,
  HelpCircle, Info, BookOpen, X, Trophy, Award, Lock, CheckCircle,
  ChevronLeft, ChevronRight
} from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('aura-theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('aura-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);
  
  // Navigation
  const [activeTab, setActiveTab] = useState<'timeline' | 'tasks' | 'habits' | 'parser'>('timeline');
  const [showAssistant, setShowAssistant] = useState(false);
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('crown-hide-onboarding') !== 'true';
    }
    return true;
  });

  // Custom tab navigation event listener
  useEffect(() => {
    const handleNavigateTab = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        setActiveTab(customEvent.detail as any);
      }
    };
    window.addEventListener('aura-navigate-tab', handleNavigateTab);
    return () => window.removeEventListener('aura-navigate-tab', handleNavigateTab);
  }, []);
  
  // Create / Edit Modal States
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showMojoModal, setShowMojoModal] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [modalDefaults, setModalDefaults] = useState<{
    defaultScheduled?: boolean;
    defaultStartTime?: string;
    defaultEndTime?: string;
    defaultDate?: string;
  }>({});

  // Handle Auth changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      if (!firebaseUser) {
        setTasks([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // Handle Real-Time Subscriptions
  useEffect(() => {
    if (!user) return;

    const unsubTasks = subscribeTasks(user.uid, (data) => {
      setTasks(data);
    });

    const unsubHabits = subscribeHabits(user.uid, (data) => {
      setHabits(data);
    });

    const unsubLogs = subscribeHabitLogs(user.uid, (data) => {
      setHabitLogs(data);
    });

    return () => {
      unsubTasks();
      unsubHabits();
      unsubLogs();
    };
  }, [user]);

  // One-time database migration to ensure all tasks have proper itemType ('task' or 'class')
  useEffect(() => {
    if (!user || tasks.length === 0) return;

    const migrateTasks = async () => {
      const tasksToMigrate = tasks.filter(t => !t.itemType);
      if (tasksToMigrate.length === 0) return;

      console.log(`[Aura Migrate] Migrating ${tasksToMigrate.length} tasks without itemType...`);
      for (const t of tasksToMigrate) {
        const isClass = t.notes?.includes('Imported via Timetable Photo Parser') || 
                        t.notes?.includes('Roster Import') || 
                        t.notes?.includes('imported class') ||
                        (t.isScheduled && t.isRecurring && t.category === 'Study');
        
        const resolvedType = isClass ? 'class' : 'task';
        try {
          await updateTask(t.id, { itemType: resolvedType });
        } catch (err) {
          console.error(`[Aura Migrate] Failed to migrate task ${t.id}:`, err);
        }
      }
    };

    migrateTasks();
  }, [user, tasks]);

  // Compute Today's Productivity Metrics
  const stats = useMemo(() => {
    const todayTasks = tasks.filter(t => isTaskActiveOnDay(t, selectedDate) && t.itemType === 'task');
    const tasksDone = todayTasks.filter(t => isTaskCompletedOnDay(t, selectedDate)).length;
    const tasksTotal = todayTasks.length;

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

    const todayHabits = habits.filter(h => isHabitScheduledForDay(h, selectedDate));
    const habitsDone = todayHabits.filter(h => 
      habitLogs.some(l => l.habitId === h.id && l.date === selectedDate && (l.status === 'completed' || l.status === 'rest' || l.status === 'recovery'))
    ).length;
    const habitsTotal = todayHabits.length;

    let maxHabitStreak = 0;
    habits.forEach(h => {
      const { bestStreak } = calculateHabitStreaks(h, habitLogs);
      if (bestStreak > maxHabitStreak) {
        maxHabitStreak = bestStreak;
      }
    });

    return {
      tasksDone,
      tasksTotal,
      habitsDone,
      habitsTotal,
      maxHabitStreak
    };
  }, [tasks, habits, habitLogs, selectedDate]);

  // Consecutive Perfect Days Streak (all scheduled tasks completed)
  const perfectDaysStreak = useMemo(() => {
    // Generate dates for the last 90 days
    const today = new Date();
    let streak = 0;
    
    for (let i = 0; i < 90; i++) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const dayTasks = tasks.filter(t => isTaskActiveOnDay(t, dateStr) && t.itemType === 'task');
      if (dayTasks.length > 0) {
        const allDone = dayTasks.every(t => isTaskCompletedOnDay(t, dateStr));
        if (allDone) {
          streak++;
        } else {
          // If checking today and they haven't finished all tasks yet, don't break the streak immediately
          if (i === 0) {
            continue;
          }
          break;
        }
      } else {
        // No active tasks on this past day, keep streak alive but don't increment (passive bypass)
      }
    }
    return streak;
  }, [tasks]);

  // Advanced Focus Mojo Gamification & Achievements Engine (Hardened Thresholds)
  const earnedBadges = useMemo(() => {
    let completedTasksCount = 0;
    let subtasksDoneCount = 0;
    tasks.forEach(t => {
      if (t.isRecurring) {
        completedTasksCount += (t.completedDates?.length || 0);
      } else if (t.isCompleted) {
        completedTasksCount += 1;
      }
      if (t.subtasks) {
        subtasksDoneCount += t.subtasks.filter(s => s.completed).length;
      }
    });

    let completedHabitsCount = habitLogs.filter(l => l.status === 'completed').length;
    let healthyHabitRestCount = habitLogs.filter(l => l.status === 'skipped' || l.status === 'rest' || l.status === 'recovery').length;

    let maxStreak = 0;
    habits.forEach(h => {
      const { bestStreak } = calculateHabitStreaks(h, habitLogs);
      if (bestStreak > maxStreak) {
        maxStreak = bestStreak;
      }
    });

    // Today's specific XP (for the selected day)
    const todayXp = (stats.tasksDone * 10) + (stats.habitsDone * 15);

    // All-time XP calculation with overall Perfect Days Streak bonus multiplier
    const totalXp = (completedTasksCount * 10) + 
                    (completedHabitsCount * 15) + 
                    (healthyHabitRestCount * 5) + 
                    (subtasksDoneCount * 2) + 
                    (maxStreak * 25) + 
                    (perfectDaysStreak * 40);

    const list = [
      {
        id: 'spark',
        name: 'The Spark 🌱',
        description: 'Earn 100+ Focus Mojo XP through sustained daily routines.',
        unlocked: totalXp >= 100,
        icon: '🌱',
        requirement: 'Reach 100+ All-time XP',
        color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
      },
      {
        id: 'initiate',
        name: 'Productivity Initiate ⚔️',
        description: 'Establish consistent workflow by completing 15+ tasks.',
        unlocked: completedTasksCount >= 15,
        icon: '⚔️',
        requirement: 'Complete 15 Tasks',
        color: 'bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-300'
      },
      {
        id: 'perfect_streak_badge',
        name: 'Streak Legend ⚡',
        description: 'Achieve a 3+ day perfect streak where all scheduled tasks are cleared.',
        unlocked: perfectDaysStreak >= 3,
        icon: '⚡',
        requirement: '3-Day Perfect Task Streak',
        color: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-800 dark:text-indigo-300'
      },
      {
        id: 'conqueror',
        name: 'Task Conqueror 👑',
        description: 'Conquer long-term goals by completing 60+ tasks.',
        unlocked: completedTasksCount >= 60,
        icon: '👑',
        requirement: 'Complete 60 Tasks',
        color: 'bg-purple-500/10 border-purple-500/30 text-purple-800 dark:text-purple-300'
      },
      {
        id: 'hero',
        name: 'Habitual Hero 🧘',
        description: 'Solidify your core lifestyle with 40+ habit check-ins.',
        unlocked: completedHabitsCount >= 40,
        icon: '🧘',
        requirement: 'Check-in 40 Times',
        color: 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
      },
      {
        id: 'streak',
        name: 'Streak Fire 🔥',
        description: 'Build robust discipline with an active 14+ day habit streak.',
        unlocked: maxStreak >= 14,
        icon: '🔥',
        requirement: 'Achieve a 14-Day Streak',
        color: 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
      },
      {
        id: 'master',
        name: 'Zen Master Ascent 🏆',
        description: 'Unlock ultimate focus legacy with 1,500+ Total Focus Mojo XP.',
        unlocked: totalXp >= 1500,
        icon: '🏆',
        requirement: 'Earn 1,500+ Total XP',
        color: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-800 dark:text-yellow-300'
      }
    ];

    return { list, todayXp, totalXp, completedTasksCount, completedHabitsCount, subtasksDoneCount, maxStreak };
  }, [tasks, habits, habitLogs, stats, perfectDaysStreak]);

  const allTimeMojo = useMemo(() => {
    const xp = earnedBadges.totalXp;
    let level = 1;
    let levelName = "Focus Seedling 🌿";
    let levelColor = "text-emerald-800 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
    let xpForNext = 500;
    let xpPrev = 0;

    if (xp >= 6000) {
      level = 5;
      levelName = "Zen Grandmaster 👑";
      levelColor = "text-amber-800 dark:text-amber-300 bg-amber-500/10 border-amber-500/30";
      xpForNext = 6000; // Max reached
      xpPrev = 3500;
    } else if (xp >= 3500) {
      level = 4;
      levelName = "Productivity Machine 🚀";
      levelColor = "text-sky-800 dark:text-sky-300 bg-sky-500/10 border-sky-500/30";
      xpForNext = 6000;
      xpPrev = 3500;
    } else if (xp >= 1500) {
      level = 3;
      levelName = "Flow Disciple ⚡";
      levelColor = "text-purple-800 dark:text-purple-300 bg-purple-500/10 border-purple-500/30";
      xpForNext = 3500;
      xpPrev = 1500;
    } else if (xp >= 500) {
      level = 2;
      levelName = "Flow Sprout 🌱";
      levelColor = "text-olive dark:text-olive/80 bg-olive/10 border-olive/30";
      xpForNext = 1500;
      xpPrev = 500;
    }

    const pct = xp >= 6000 ? 100 : Math.round(((xp - xpPrev) / (xpForNext - xpPrev)) * 100);

    return { xp, level, levelName, levelColor, xpForNext, xpPrev, pct };
  }, [earnedBadges.totalXp]);

  // Date strip memo generating 9 days centered around selectedDate
  const dateStripDays = useMemo(() => {
    const list = [];
    const baseDate = parseDateLocal(selectedDate);
    for (let i = -4; i <= 4; i++) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() + i);
      const dayStr = d.toISOString().split('T')[0];
      const dayNameShort = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = d.getDate();
      list.push({ dayStr, dayNameShort, dayNum });
    }
    return list;
  }, [selectedDate]);

  const handleAdjustDate = (offset: number) => {
    const d = parseDateLocal(selectedDate);
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleOpenCreateModal = (dateStr: string, startTime?: string, endTime?: string) => {
    setEditTask(null);
    setModalDefaults({
      defaultScheduled: !!startTime,
      defaultStartTime: startTime || '',
      defaultEndTime: endTime || '',
      defaultDate: dateStr
    });
    setShowTaskModal(true);
  };

  const handleOpenEditModal = (task: Task, startOverride?: string, endOverride?: string, dateOverride?: string) => {
    setEditTask(task);
    setModalDefaults({
      defaultScheduled: startOverride !== undefined ? true : undefined,
      defaultStartTime: startOverride || '',
      defaultEndTime: endOverride || '',
      defaultDate: dateOverride || ''
    });
    setShowTaskModal(true);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-paper text-natmuted transition-colors">
        <Loader2 className="w-8 h-8 text-olive animate-spin mb-4" />
        <p className="text-sm font-sans tracking-wide">Syncing your Crownfi Planner space...</p>
      </div>
    );
  }

  // If not authenticated, show elegant organic login page
  if (!user) {
    return <Auth />;
  }

  return (
    <div className="crownfi-app min-h-screen bg-paper text-nattext flex flex-col pb-24 lg:pb-0 font-sans">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-40 bg-headerbg backdrop-blur-md border-b border-natborder transition-colors">
        <div className="w-full max-w-none px-4 lg:px-8 h-16 flex items-center justify-between">
          <button 
            onClick={() => setActiveTab('timeline')} 
            className="flex items-center gap-2.5 cursor-pointer bg-transparent border-0 text-left focus:outline-none focus:ring-0 p-1 rounded-xl" 
            id="header-brand"
          >
            <div className="w-8 h-8 rounded-full bg-olive text-white flex items-center justify-center">
              <Sparkles className="w-4.5 h-4.5" />
            </div>
            <h1 className="text-xl font-serif font-semibold tracking-tight text-nattext italic">
              Crownfi Planner
            </h1>
          </button>

          {/* PREMIUM ENLARGED DUAL WIDGET: FOCUS MOJO + PERFECT STREAK */}
          <div className="flex items-center gap-3.5 py-1" id="mojo-streak-dual-panel">
            {/* Gamified Focus Mojo XP level badge - Clean, refined, structured */}
            <button
              onClick={() => setShowMojoModal(true)}
              className="flex items-center gap-3 px-4 py-2 rounded-xl bg-cardbg hover:bg-paper/85 transition-all cursor-pointer border border-natborder/40 hover:border-olive/30 shadow-2xs hover:shadow-xs active:scale-[0.98] group shrink-0 outline-none focus:outline-none focus:ring-0"
              id="mojo-level-header"
              title="Your Focus Mojo Academy & Progression. Click to open!"
            >
              <div className="w-8 h-8 rounded-lg bg-olive/10 text-olive flex items-center justify-center shrink-0">
                <Trophy className="w-4.5 h-4.5 text-olive group-hover:scale-105 transition-transform duration-200" />
              </div>
              <div className="flex flex-col items-start text-left">
                <span className="text-[9px] font-bold text-olive uppercase tracking-widest font-mono leading-none mb-0.5">Focus Mojo</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black text-nattext font-mono tabular-nums leading-none">{allTimeMojo.xp} <span className="text-[9px] font-semibold text-natmuted">XP</span></span>
                  <span className={`text-[9px] font-bold font-sans px-1.5 py-0.5 rounded leading-none border border-natborder/10 ${allTimeMojo.levelColor}`}>
                    {allTimeMojo.levelName}
                  </span>
                  {earnedBadges.todayXp > 0 && (
                    <span className="text-[9px] font-black text-emerald-700 bg-emerald-50/80 dark:bg-emerald-950/20 px-1 py-0.5 rounded leading-none font-mono tabular-nums">
                      +{earnedBadges.todayXp}
                    </span>
                  )}
                </div>
              </div>
            </button>

            {/* Overall Task Completion Streak Widget (Perfect Days Streak) */}
            <div 
              className="flex items-center gap-3 px-4 py-2 rounded-xl bg-cardbg border border-natborder/40 hover:border-rose-500/20 transition-all shadow-2xs shrink-0"
              title="Maintain your Perfect Streak! Clear all scheduled tasks on any given day to increase your Perfect Day Streak."
              id="perfect-days-streak-widget"
            >
              <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0">
                <Flame className="w-4.5 h-4.5 text-rose-650 fill-rose-500/80" />
              </div>
              <div className="flex flex-col items-start text-left">
                <span className="text-[9px] font-bold text-rose-600 uppercase tracking-widest font-mono leading-none mb-0.5">Perfect Streak</span>
                <div className="flex items-center gap-1.5 leading-none">
                  <span className="text-xs font-black text-nattext font-mono tabular-nums leading-none">
                    {perfectDaysStreak} <span className="text-[9px] font-semibold text-natmuted">DAYS</span>
                  </span>
                  <span className="text-[9px] font-black text-rose-700 bg-rose-50/80 dark:bg-rose-950/20 px-1.5 py-0.5 rounded leading-none">
                    {perfectDaysStreak > 0 ? "Active" : "Ready"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* User Profile & Session controls */}
          <div className="flex items-center gap-3" id="header-profile-actions">
            <button
              onClick={() => setShowOnboarding(prev => !prev)}
              className={`p-2 rounded-xl hover:bg-olive/10 cursor-pointer transition-all ${showOnboarding ? 'text-olive bg-olive/5' : 'text-natmuted hover:text-olive'}`}
              title="Quick Onboarding & Features Guide"
              id="btn-onboarding-toggle"
            >
              <HelpCircle className="w-4.5 h-4.5" />
            </button>
            <div className="h-5 w-px bg-natborder mx-1" />

            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-xl hover:bg-olive/10 text-natmuted hover:text-olive cursor-pointer transition-all"
              title={darkMode ? "Switch to Default Light Theme" : "Switch to Midnight Dark Mode"}
              id="btn-theme-toggle"
            >
              {darkMode ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
            </button>
            <div className="h-5 w-px bg-natborder mx-1" />

            <button
              onClick={() => setShowAssistant(true)}
              className="p-2 rounded-xl hover:bg-olive/10 text-natmuted hover:text-olive cursor-pointer transition-all relative"
              title="Crown Assistant & Notifications"
              id="btn-notification-bell"
            >
              <Bell className="w-4.5 h-4.5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-olive rounded-full border-2 border-cardbg" />
            </button>
            <div className="h-5 w-px bg-natborder mx-1" />

            <div className="flex items-center gap-2.5" id="user-header-profile">
              <div className="w-8 h-8 rounded-full bg-clay text-white font-sans font-semibold text-xs flex items-center justify-center uppercase shadow-2xs select-none">
                {user.displayName ? user.displayName.charAt(0) : user.email?.charAt(0) || 'U'}
              </div>
              <span className="text-xs font-semibold text-natmuted max-w-[120px] truncate hidden sm:block">
                {user.displayName || user.email || 'User'}
              </span>
              <div className="h-5 w-px bg-natborder mx-1" />
              <button
                id="btn-logout"
                onClick={handleLogout}
                className="p-2 rounded-xl hover:bg-clay/10 text-natmuted hover:text-clay cursor-pointer transition-all"
                title="Log Out"
              >
                <LogOut className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Apple-inspired application shell */}
      <div className="crownfi-shell flex flex-1 min-h-0">
        <aside className="crownfi-sidebar hidden lg:flex" aria-label="Main navigation">
          <div className="crownfi-sidebar-brand">
            <div className="crownfi-brand-mark"><Sparkles className="w-4 h-4" /></div>
            <div><div className="crownfi-brand-title">Crownfi</div><div className="crownfi-brand-caption">PERSONAL WORKSPACE</div></div>
          </div>
          <div className="crownfi-nav-label">WORKSPACE</div>
          <nav className="crownfi-side-nav">
            <button onClick={() => setActiveTab('timeline')} className={`crownfi-side-link ${activeTab === 'timeline' ? 'active' : ''}`}><Clock /><span>Overview</span></button>
            <button onClick={() => setActiveTab('tasks')} className={`crownfi-side-link ${activeTab === 'tasks' ? 'active' : ''}`}><ListTodo /><span>My Tasks</span></button>
            <button onClick={() => setActiveTab('habits')} className={`crownfi-side-link ${activeTab === 'habits' ? 'active' : ''}`}><Activity /><span>Habits</span></button>
          </nav>
          <div className="crownfi-nav-label crownfi-tools-label">TOOLS</div>
          <nav className="crownfi-side-nav">
            <button onClick={() => setActiveTab('parser')} className={`crownfi-side-link ${activeTab === 'parser' ? 'active' : ''}`}><Sparkles /><span>Roster Import</span></button>
          </nav>
          <div className="crownfi-sidebar-spacer" />
          <div className="crownfi-sidebar-footer">
            <div className="crownfi-footer-avatar">{user.displayName ? user.displayName.charAt(0) : user.email?.charAt(0) || 'U'}</div>
            <div className="crownfi-footer-user"><strong>{user.displayName || 'Your workspace'}</strong><span>Signed in</span></div>
          </div>
        </aside>
        {/* Main Container */}
        <main className="flex-1 min-w-0 w-full max-w-none px-4 lg:px-8 py-4 lg:py-6 flex flex-col min-h-0">
        
        {/* Onboarding Guide Card */}
        <AnimatePresence>
          {showOnboarding && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className="overflow-hidden w-full shrink-0"
              id="onboarding-guide-section"
            >
              <div className="bg-cardbg border border-olive/20 rounded-3xl p-5 md:p-6 shadow-sm relative flex flex-col md:flex-row gap-6 bg-paper/50 backdrop-blur-xs">
                {/* Close Button */}
                <button
                  onClick={() => {
                    setShowOnboarding(false);
                    localStorage.setItem('crown-hide-onboarding', 'true');
                  }}
                  className="absolute top-4 right-4 p-1.5 text-natmuted hover:text-clay hover:bg-clay/10 rounded-xl transition-all cursor-pointer"
                  title="Hide guide (you can reopen anytime from the '?' icon in the header)"
                >
                  <X className="w-4.5 h-4.5" />
                </button>

                {/* Left Intro Panel */}
                <div className="md:w-1/3 flex flex-col justify-between pr-4 border-b md:border-b-0 md:border-r border-natborder/60 pb-5 md:pb-0">
                  <div>
                    <div className="w-10 h-10 rounded-2xl bg-olive/10 text-olive flex items-center justify-center mb-3">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-olive font-mono">Welcome to Crownfi Planner</span>
                    <h3 className="text-lg font-serif font-bold text-nattext italic mt-1">Your Mindful Control Center</h3>
                    <p className="text-[11px] text-natmuted mt-2 leading-relaxed">
                      Crownfi Planner is designed to bridge the gap between chaotic to-do lists and rigid time blocks. Focus on progress, cultivate your habits, and build daily consistency with zero friction.
                    </p>
                  </div>
                  <div className="mt-4 flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        setShowOnboarding(false);
                        localStorage.setItem('crown-hide-onboarding', 'true');
                      }}
                      className="px-3.5 py-1.5 bg-olive text-white rounded-xl text-[10px] font-bold shadow-3xs cursor-pointer hover:bg-olive/90 transition-all"
                    >
                      Got it, thanks!
                    </button>
                    <a
                      href="#dashboard-unified-board"
                      className="px-3 py-1.5 border border-natborder/80 hover:border-olive/30 rounded-xl text-[10px] font-bold text-natmuted hover:text-olive transition-all text-center flex items-center justify-center"
                    >
                      Start Workspace
                    </a>
                  </div>
                </div>

                {/* Right Features Grid */}
                <div className="md:w-2/3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Feature 1 */}
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-olive/10 text-olive shrink-0">
                      <CalendarRange className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-nattext">Two-Way Timeline Scheduling</h4>
                      <p className="text-[11px] text-natmuted mt-1 leading-relaxed">
                        Drag any task or habit from your checklist and drop it directly onto the hours timeline to block time. Drag blocks up/down to reschedule, or drag them left to unschedule!
                      </p>
                    </div>
                  </div>

                  {/* Feature 2 */}
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                      <Flame className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-nattext">Habits & Streak Protection</h4>
                      <p className="text-[11px] text-natmuted mt-1 leading-relaxed">
                        Check off habits as Completed, Rest Day, or Recovery Day. Utilizing rest/recovery days preserves your active momentum streaks so you never lose motivation!
                      </p>
                    </div>
                  </div>

                  {/* Feature 3 */}
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 shrink-0">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-nattext">Gamified Focus Mojo XP</h4>
                      <p className="text-[11px] text-natmuted mt-1 leading-relaxed">
                        Earn +10 XP for tasks and +15 XP for habits. Watch your header indicator advance from <strong>Focus Sprout</strong> to <strong>Zen Master</strong>, complete with tactile chimes and confetti bursts!
                      </p>
                    </div>
                  </div>

                  {/* Feature 4 */}
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-clay/10 text-clay shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-nattext">AI Aura Assistant & Parser</h4>
                      <p className="text-[11px] text-natmuted mt-1 leading-relaxed">
                        Get tailored guidance and advice from your Aura Assistant, or paste any plain-text timetable into the <strong>Table Parser</strong> to schedule your entire day in a single click!
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab === 'parser' ? 'parser' : activeTab === 'review' ? 'review' : 'dashboard'}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3 }}
            className="w-full"
          >
            {/* 1. TIMELINE, TASKS & HABITS ACTIVE WORKSPACE */}
            {['timeline', 'tasks', 'habits'].includes(activeTab) && (
              <div className="bg-cardbg border border-natborder rounded-3xl shadow-sm overflow-hidden" id="dashboard-unified-board">
                {/* Horizontal date-picker strip */}
                <div className="bg-cardbg border-b border-natborder px-4 py-2 flex items-center justify-between gap-3 overflow-x-auto scrollbar-none" id="horizontal-date-picker-strip">
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleAdjustDate(-1)}
                      className="p-1.5 rounded-xl hover:bg-olive/10 text-natmuted hover:text-olive transition-all cursor-pointer"
                      title="Previous Day"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const todayStr = new Date().toISOString().split('T')[0];
                        setSelectedDate(todayStr);
                      }}
                      className="px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider bg-olive/10 hover:bg-olive/20 text-olive transition-all cursor-pointer"
                      title="Jump to Today"
                    >
                      Today
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
                    {dateStripDays.map(({ dayStr, dayNameShort, dayNum }) => {
                      const isSelected = dayStr === selectedDate;
                      const isToday = dayStr === new Date().toISOString().split('T')[0];
                      
                      const hasItems = tasks.some(t => isTaskScheduledForDay(t, dayStr)) || 
                                       habits.some(h => h.isScheduled && h.startTime && h.endTime && (
                                         (h.startDate ? dayStr >= h.startDate : true) &&
                                         (h.endDate ? dayStr <= h.endDate : true) &&
                                         (h.scheduleType === 'daily' || 
                                          (h.scheduleType === 'weekdays' && [1,2,3,4,5].includes(parseDateLocal(dayStr).getDay())) ||
                                          (h.scheduleType === 'specific_days' && h.weekdays?.includes(parseDateLocal(dayStr).getDay())))
                                       ));

                      return (
                        <button
                          key={dayStr}
                          type="button"
                          onClick={() => setSelectedDate(dayStr)}
                          className={`flex flex-col items-center justify-center w-11 h-12 rounded-xl transition-all relative border outline-none focus:outline-none focus:ring-0 shrink-0 ${
                            isSelected
                              ? 'bg-olive text-white border-olive shadow-2xs'
                              : isToday
                                ? 'bg-olive/5 text-olive border-olive/20 hover:bg-olive/10'
                                : 'bg-paper/40 text-natmuted border-natborder/40 hover:bg-paper hover:border-olive/20'
                          }`}
                        >
                          <span className={`text-[8px] font-bold uppercase tracking-wider leading-none ${isSelected ? 'text-white/80' : 'text-natmuted/80'}`}>
                            {dayNameShort}
                          </span>
                          <span className="text-xs font-black font-mono leading-none mt-1">
                            {dayNum}
                          </span>
                          {hasItems && (
                            <span className={`absolute bottom-1 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-olive'}`} />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleAdjustDate(1)}
                      className="p-1.5 rounded-xl hover:bg-olive/10 text-natmuted hover:text-olive transition-all cursor-pointer"
                      title="Next Day"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Unified Board Header */}
                <div className="border-b border-natborder bg-subtlebg px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-olive font-mono">Daily Control Center</span>
                    <h2 className="text-xl font-serif font-bold text-nattext italic">Crown Unified Workspace</h2>
                    <p className="text-xs text-natmuted mt-0.5">Brain dump ideas or check off tasks on the left, then drag-and-drop them to schedule time blocks on the right.</p>
                  </div>
                  <div className="flex items-center gap-2 self-start md:self-auto">
                    <span className="px-3 py-1.5 rounded-full bg-olive/10 border border-olive/25 text-[10px] font-bold text-olive flex items-center gap-1.5 select-none shadow-3xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-olive animate-ping" />
                      Two-Way Drag Active
                    </span>
                  </div>
                </div>

                {/* UNLOCKED BADGES SECTION */}
                {earnedBadges.list.some(b => b.unlocked) && (
                  <div className="bg-cardbg border-b border-natborder px-6 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3 bg-olive/5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-natmuted font-mono flex items-center gap-1.5 shrink-0 select-none">
                      <Trophy className="w-4 h-4 text-amber-600 animate-bounce" />
                      Achievements Unlocked:
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {earnedBadges.list.filter(b => b.unlocked).map(badge => (
                        <button
                          key={badge.id}
                          type="button"
                          onClick={() => setShowMojoModal(true)}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-xl border text-[10px] font-extrabold transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-2xs text-left ${badge.color}`}
                          title={`${badge.name}: ${badge.description}. Click to open Focus Mojo Academy.`}
                        >
                          <span className="text-sm select-none">{badge.icon}</span>
                          <span>{badge.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bento Statistics Grid */}
                {(() => {
                  const taskPct = stats.tasksTotal > 0 ? Math.round((stats.tasksDone / stats.tasksTotal) * 100) : 0;
                  const habitPct = stats.habitsTotal > 0 ? Math.round((stats.habitsDone / stats.habitsTotal) * 100) : 0;
                  return (
                    <div className="bg-subtlebg border-b border-natborder px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4" id="dashboard-bento-stats">
                      {/* Today's Tasks Card */}
                      <div className="bg-cardbg border border-natborder/60 p-3.5 rounded-2xl flex items-center justify-between shadow-3xs hover:border-olive/35 transition-all duration-200">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-olive/10 text-olive">
                            <ListTodo className="w-4 h-4 text-olive" />
                          </div>
                          <div>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-natmuted font-mono leading-none">Today's Tasks</span>
                            <p className="text-base font-bold text-nattext font-mono tabular-nums leading-none mt-1">
                              {stats.tasksDone} / {stats.tasksTotal} <span className="text-[10px] font-semibold text-natmuted font-sans">Done</span>
                            </p>
                          </div>
                        </div>
                        {/* Animated Task Completion Circular Ring */}
                        <div className="relative w-11 h-11 flex items-center justify-center shrink-0" title={`${taskPct}% of tasks completed`}>
                          <svg className="w-11 h-11 transform -rotate-90">
                            <circle cx="22" cy="22" r="17" className="stroke-natborder/45" strokeWidth="3" fill="transparent" />
                            <motion.circle
                              cx="22" cy="22" r="17" className="stroke-olive" strokeWidth="3" fill="transparent"
                              strokeDasharray={2 * Math.PI * 17}
                              initial={{ strokeDashoffset: 2 * Math.PI * 17 }}
                              animate={{ strokeDashoffset: 2 * Math.PI * 17 * (1 - taskPct / 100) }}
                              transition={{ duration: 0.8, ease: 'easeOut' }}
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="absolute text-[10px] font-bold font-mono tabular-nums text-nattext">{taskPct}%</span>
                        </div>
                      </div>

                      {/* Today's Habits Card */}
                      <div className="bg-cardbg border border-natborder/60 p-3.5 rounded-2xl flex items-center justify-between shadow-3xs hover:border-emerald-500/30 transition-all duration-200">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-400">
                            <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          </div>
                          <div>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-natmuted font-mono leading-none">Today's Habits</span>
                            <p className="text-base font-bold text-nattext font-mono tabular-nums leading-none mt-1">
                              {stats.habitsDone} / {stats.habitsTotal} <span className="text-[10px] font-semibold text-natmuted font-sans">Done</span>
                            </p>
                          </div>
                        </div>
                        {/* Animated Habit Completion Circular Ring */}
                        <div className="relative w-11 h-11 flex items-center justify-center shrink-0" title={`${habitPct}% of habits completed`}>
                          <svg className="w-11 h-11 transform -rotate-90">
                            <circle cx="22" cy="22" r="17" className="stroke-natborder/45" strokeWidth="3" fill="transparent" />
                            <motion.circle
                              cx="22" cy="22" r="17" className="stroke-emerald-650 dark:stroke-emerald-500" strokeWidth="3" fill="transparent"
                              strokeDasharray={2 * Math.PI * 17}
                              initial={{ strokeDashoffset: 2 * Math.PI * 17 }}
                              animate={{ strokeDashoffset: 2 * Math.PI * 17 * (1 - habitPct / 100) }}
                              transition={{ duration: 0.8, ease: 'easeOut' }}
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="absolute text-[10px] font-bold font-mono tabular-nums text-nattext">{habitPct}%</span>
                        </div>
                      </div>

                      {/* Best Habit Streak Card */}
                      <div className="bg-cardbg border border-natborder/60 p-3.5 rounded-2xl flex items-center justify-between shadow-3xs hover:border-amber-500/30 transition-all duration-200">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/25 text-amber-700 dark:text-amber-400">
                            <Flame className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          </div>
                          <div>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-natmuted font-mono leading-none">Best Streak</span>
                            <p className="text-base font-bold text-nattext font-mono tabular-nums leading-none mt-1">
                              {stats.maxHabitStreak} <span className="text-[10px] font-semibold text-natmuted font-sans">Days</span>
                            </p>
                          </div>
                        </div>
                        <div className="text-amber-500 p-1" title="Keep the flame alive!">
                          🔥
                        </div>
                      </div>
                    </div>
                  );
                })()}
                
                <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-natborder/60">
                  {/* Left Column: Tasks Backlog (Inbox & Checklist) & Habits - visible on lg desktop OR mobile when respective tab is active */}
                  <div className={`lg:col-span-5 p-4 lg:p-6 space-y-6 bg-paper/10 lg:sticky lg:top-[80px] lg:max-h-[calc(100vh-110px)] lg:overflow-y-auto scrollbar-thin ${
                    activeTab === 'tasks' || activeTab === 'habits' ? 'block' : 'hidden lg:block'
                  }`}>
                     {/* Inbox & Todo List: show on desktop OR if activeTab === 'tasks' */}
                    <div id="tasks-section" className={activeTab === 'tasks' ? 'block' : 'hidden lg:block'}>
                      <InboxAndTodoList 
                        userId={user.uid}
                        tasks={tasks}
                        habits={habits}
                        selectedDate={selectedDate}
                        onEditTask={handleOpenEditModal}
                        onAddTask={(date, startTime, endTime) => handleOpenCreateModal(date, startTime, endTime)}
                      />
                    </div>

                    {/* Habits: show on desktop OR if activeTab === 'habits' */}
                    <div id="habits-section" className={activeTab === 'habits' ? 'block' : 'hidden lg:block'}>
                      <HabitsTracker 
                        userId={user.uid}
                        habits={habits}
                        habitLogs={habitLogs}
                        selectedDate={selectedDate}
                        tasks={tasks}
                      />
                    </div>
                  </div>

                  {/* Right Column: Visual Hourly Timetable - visible on lg desktop OR mobile when timeline tab is active */}
                  <div id="timeline-section" className={`lg:col-span-7 p-4 lg:p-6 bg-cardbg ${
                    activeTab === 'timeline' ? 'block' : 'hidden lg:block'
                  }`}>
                    <VisualTimeline 
                      tasks={tasks}
                      habits={habits}
                      habitLogs={habitLogs}
                      selectedDate={selectedDate}
                      setSelectedDate={setSelectedDate}
                      onAddTask={(date, startTime, endTime) => handleOpenCreateModal(date, startTime, endTime)}
                      onEditTask={handleOpenEditModal}
                      userId={user.uid}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 2. AI TIMETABLE PHOTO PARSER */}
            {activeTab === 'parser' && (
              <div className="max-w-3xl mx-auto">
                <TimetableParser 
                  userId={user.uid} 
                  tasks={tasks}
                  onImportComplete={() => setActiveTab('timeline')} 
                />
              </div>
            )}


          </motion.div>
        </AnimatePresence>
        </main>
      </div>

      {/* Mobile navigation; desktop uses the persistent sidebar. */}
      {/* Modern Floating Bottom Navigation Drawer */}
      <nav 
        id="app-navigation"
        className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-cardbg/95 border border-natborder rounded-2xl p-1.5 shadow-md backdrop-blur-lg flex items-center gap-1 w-[calc(100%-2rem)] max-w-[570px] transition-all duration-300 ${
          isNavCollapsed ? 'translate-y-24 opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
        }`}
      >
        {/* DESKTOP-ONLY WORKSPACE TAB */}
        <button
          onClick={() => setActiveTab('timeline')}
          className={`hidden lg:flex flex-1 items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            ['timeline', 'tasks', 'habits'].includes(activeTab)
              ? 'bg-olive text-white shadow-sm' 
              : 'text-natmuted hover:text-nattext hover:bg-sand/40'
          }`}
          id="nav-tab-desktop-workspace"
        >
          <ListTodo className="w-4 h-4 shrink-0" />
          <span>Timeline & Workspace</span>
        </button>

        {/* MOBILE-ONLY TABS */}
        <button
          onClick={() => setActiveTab('timeline')}
          className={`lg:hidden flex flex-col flex-1 items-center justify-center gap-1 py-1 px-1.5 rounded-xl text-[9px] font-bold transition-all cursor-pointer ${
            activeTab === 'timeline' 
              ? 'text-olive bg-olive/10' 
              : 'text-natmuted hover:text-nattext'
          }`}
          id="nav-tab-mobile-timeline"
        >
          <Clock className="w-4 h-4 shrink-0" />
          <span>Timeline</span>
        </button>

        <button
          onClick={() => setActiveTab('tasks')}
          className={`lg:hidden flex flex-col flex-1 items-center justify-center gap-1 py-1 px-1.5 rounded-xl text-[9px] font-bold transition-all cursor-pointer ${
            activeTab === 'tasks' 
              ? 'text-olive bg-olive/10' 
              : 'text-natmuted hover:text-nattext'
          }`}
          id="nav-tab-mobile-tasks"
        >
          <ListTodo className="w-4 h-4 shrink-0" />
          <span>Tasks</span>
        </button>

        <button
          onClick={() => setActiveTab('habits')}
          className={`lg:hidden flex flex-col flex-1 items-center justify-center gap-1 py-1 px-1.5 rounded-xl text-[9px] font-bold transition-all cursor-pointer ${
            activeTab === 'habits' 
              ? 'text-olive bg-olive/10' 
              : 'text-natmuted hover:text-nattext'
          }`}
          id="nav-tab-mobile-habits"
        >
          <Activity className="w-4 h-4 shrink-0" />
          <span>Habits</span>
        </button>

        {/* COMMON TABS */}
        <button
          onClick={() => setActiveTab('parser')}
          className={`flex flex-col lg:flex-row flex-1 items-center justify-center gap-1 lg:gap-2 py-1 lg:py-2.5 rounded-xl text-[9px] lg:text-xs font-bold lg:font-semibold transition-all cursor-pointer ${
            activeTab === 'parser' 
              ? 'bg-olive text-white shadow-sm lg:bg-olive lg:text-white' 
              : 'text-natmuted hover:text-nattext hover:bg-sand/40 lg:hover:bg-sand/40'
          }`}
          id="nav-tab-parser"
        >
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>Roster Import</span>
        </button>



        <div className="h-6 w-px bg-natborder/60 mx-1" />

        <button
          onClick={() => setIsNavCollapsed(true)}
          className="flex flex-col lg:flex-row items-center justify-center p-1.5 lg:px-2.5 lg:py-2.5 rounded-xl text-natmuted hover:text-clay hover:bg-clay/10 transition-all cursor-pointer"
          title="Minimize Navigation Menu"
          id="nav-tab-collapse"
        >
          <ChevronDown className="w-4 h-4 shrink-0 text-natmuted" />
        </button>
      </nav>

      {/* Floating Restore Nav Button */}
      {isNavCollapsed && (
        <button
          onClick={() => setIsNavCollapsed(false)}
          className="fixed bottom-4 right-4 z-40 p-3.5 bg-olive hover:bg-olive/90 text-white rounded-full shadow-lg active:scale-95 transition-all cursor-pointer flex items-center justify-center hover:shadow-xl hover:translate-y-[-2px]"
          title="Show Navigation Menu"
          id="nav-btn-restore"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
      )}

      {/* Task Creation & Editing Dialog Modal */}
      <AnimatePresence>
        {showTaskModal && (
          <TaskFormModal
            userId={user.uid}
            editTask={editTask}
            defaultDate={modalDefaults.defaultDate || selectedDate}
            defaultScheduled={modalDefaults.defaultScheduled}
            defaultStartTime={modalDefaults.defaultStartTime}
            defaultEndTime={modalDefaults.defaultEndTime}
            tasks={tasks}
            habits={habits}
            onClose={() => {
              setShowTaskModal(false);
              setEditTask(null);
              setModalDefaults({});
            }}
          />
        )}
      </AnimatePresence>

      {/* Focus Mojo Academy & Milestones Dialog Modal */}
      <AnimatePresence>
        {showMojoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-cardbg border border-natborder rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="border-b border-natborder bg-subtlebg px-6 py-5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-olive/10 text-olive">
                    <Trophy className="w-5 h-5 text-olive animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-lg text-nattext">Focus Mojo Academy 🔮</h3>
                    <p className="text-[11px] text-natmuted mt-0.5">Master your routines, complete challenges, and track active milestones.</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMojoModal(false)}
                  className="p-1.5 rounded-xl hover:bg-clay/10 text-natmuted hover:text-clay cursor-pointer transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1">
                {/* Level Progress Banner */}
                <div className="p-5 rounded-2xl border border-natborder bg-paper/40 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-3xs">
                  <div className="space-y-2 flex-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-natmuted font-mono block">Current Progression</span>
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl font-black text-nattext font-mono leading-none">{allTimeMojo.xp} XP</span>
                      <span className={`text-[10px] font-black px-2.5 py-1 rounded-xl border leading-none ${allTimeMojo.levelColor}`}>
                        Level {allTimeMojo.level}: {allTimeMojo.levelName}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1 pt-1.5">
                      <div className="w-full bg-natborder/30 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-olive h-full transition-all duration-500 rounded-full"
                          style={{ width: `${allTimeMojo.pct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-bold text-natmuted">
                        <span>{allTimeMojo.xpPrev} XP (Level Start)</span>
                        <span>{allTimeMojo.pct}% Progress</span>
                        <span>{allTimeMojo.xpForNext === allTimeMojo.xp ? 'Max Level!' : `${allTimeMojo.xpForNext} XP (Next Level)`}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-olive/10 border border-olive/20 p-3.5 rounded-xl text-center md:max-w-[200px] shrink-0">
                    <p className="text-xs font-serif font-bold text-olive">Level Formula</p>
                    <p className="text-[11px] text-natmuted mt-1 leading-relaxed">Levels unlock at 500, 1500, 3500, and 6000 XP. Climb from Seedling to Zen Grandmaster!</p>
                  </div>
                </div>

                {/* Points Criteria list */}
                <div className="space-y-3">
                  <h4 className="font-serif font-bold text-sm text-nattext flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-olive" />
                    Focus Mojo Points Criteria
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-blue-500/10 p-2 rounded-lg text-blue-700 font-bold leading-none shrink-0">⚔️</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Complete Any Task</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Tick off scheduled or inbox items.</p>
                        <p className="text-[10px] text-blue-700 font-black mt-1 font-mono">+10 XP each</p>
                      </div>
                    </div>

                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-emerald-500/10 p-2 rounded-lg text-emerald-700 font-bold leading-none shrink-0">🧘</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Check-in Daily Habit</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Log habits successfully as complete.</p>
                        <p className="text-[10px] text-emerald-700 font-black mt-1 font-mono">+15 XP each</p>
                      </div>
                    </div>

                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-amber-500/10 p-2 rounded-lg text-amber-700 font-bold leading-none shrink-0">🩹</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Healthy Skip / Rest Day</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Take designated recovery or rest days.</p>
                        <p className="text-[10px] text-amber-700 font-black mt-1 font-mono">+5 XP each</p>
                      </div>
                    </div>

                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-purple-500/10 p-2 rounded-lg text-purple-700 font-bold leading-none shrink-0">📋</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Check Off Subtasks</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Complete nested steps in task checklists.</p>
                        <p className="text-[10px] text-purple-700 font-black mt-1 font-mono">+2 XP each step</p>
                      </div>
                    </div>

                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-indigo-500/10 p-2 rounded-lg text-indigo-700 font-bold leading-none shrink-0">⚡</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Perfect Task Streak</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Complete all scheduled tasks on any given day.</p>
                        <p className="text-[10px] text-indigo-700 font-black mt-1 font-mono">+40 XP per active day</p>
                      </div>
                    </div>

                    <div className="border border-natborder/60 rounded-xl p-3 bg-cardbg flex items-start gap-3">
                      <div className="text-lg bg-rose-500/10 p-2 rounded-lg text-rose-700 font-bold leading-none shrink-0">🔥</div>
                      <div>
                        <p className="text-xs font-bold text-nattext">Habit Streak Multiplier</p>
                        <p className="text-[10px] text-natmuted mt-0.5">Keep habit streaks alive! Your best streak multiplies gains.</p>
                        <p className="text-[10px] text-rose-700 font-black mt-1 font-mono">+25 XP per streak day</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Achievements Milestones list */}
                <div className="space-y-3">
                  <h4 className="font-serif font-bold text-sm text-nattext flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-olive" />
                    Unlocked Achievements & Badges
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {earnedBadges.list.map(badge => (
                      <div
                        key={badge.id}
                        className={`border rounded-xl p-3.5 transition-all flex items-start gap-3.5 relative ${
                          badge.unlocked
                            ? `${badge.color} border-olive/30 shadow-3xs`
                            : 'bg-cardbg/40 border-natborder/40 opacity-55'
                        }`}
                      >
                        <div className="text-2xl select-none shrink-0 p-1.5 rounded-xl bg-cardbg border border-natborder/50">
                          {badge.unlocked ? badge.icon : '🔒'}
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-nattext flex items-center gap-1.5">
                            {badge.name}
                            {badge.unlocked && (
                              <span className="text-[9px] font-black uppercase text-emerald-700 bg-emerald-50 px-1 rounded-sm border border-emerald-200">Earned</span>
                            )}
                          </p>
                          <p className="text-[10px] text-natmuted leading-relaxed">{badge.description}</p>
                          <p className="text-[10px] text-natmuted pt-1">
                            <strong className="font-semibold">Requirement:</strong> {badge.requirement}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-natborder bg-subtlebg px-6 py-4 flex justify-end">
                <button
                  onClick={() => setShowMojoModal(false)}
                  className="px-5 py-2 rounded-xl bg-olive hover:bg-olive/90 text-white font-semibold text-xs transition-all cursor-pointer shadow-3xs"
                >
                  Awesome, keep focusing!
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Aura Real-Time Assistant Panel Overlay */}
      {showAssistant && (
        <AuraAssistant
          tasks={tasks}
          habits={habits}
          habitLogs={habitLogs}
          selectedDate={selectedDate}
          onClose={() => setShowAssistant(false)}
        />
      )}

      {/* Customizable Medium-Speed Smooth Scroller Compass */}
      <PageScrollAssistant />
    </div>
  );
}
