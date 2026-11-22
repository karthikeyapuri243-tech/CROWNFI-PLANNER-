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
      return false;
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
