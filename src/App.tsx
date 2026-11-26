import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { FileTransfer } from '@capacitor/file-transfer';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { KramInstaller } from './lib/kramInstaller';
import { LocalNotifications } from '@capacitor/local-notifications';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import Auth from './components/Auth';
import { createPlannerTask, createRecurringPlannerOccurrence, updatePlannerTask, deletePlannerTask, deletePlannerTaskSeries, subscribePlannerTasks, subscribeInternshipTasks, createInternshipTask, updateInternshipTask, deleteInternshipTask, createPlannerBlock, updatePlannerBlock, deletePlannerBlock, subscribePlannerBlocks, createPlannerHabit, updatePlannerHabit, deletePlannerHabit, subscribePlannerHabits, setPlannerHabitCheckin, subscribePlannerCheckins } from './lib/plannerDb';
import { Bell, CalendarDays, CalendarRange, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Flame, LayoutDashboard, ListTodo, Menu, Moon, Plus, Search, Sun, Target, Trash2, TrendingUp, X, Settings, BellRing, Palette, Smartphone, ShieldCheck, BriefcaseBusiness } from 'lucide-react';
// Load celebration effects only when needed, not during startup.
const celebrate = (options: import('canvas-confetti').Options) => {if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;void import('canvas-confetti').then(({default:confetti})=>confetti({...options,particleCount:Math.min(options.particleCount||35,32),ticks:120,disableForReducedMotion:true})).catch(()=>{});};
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

// Keep this bundled changelog current when shipping a new feature release.
const KRAM_UPDATE_REVISION = '2026-11-26.3';
const KRAM_UPDATE_NOTES = [
  'To-do and Someday lists, with optional scheduling.',
  'Compact entry forms and a smaller workspace switch.',
  'One in-app delete confirmation, including recurring tasks.',
  'Faster navigation and lighter animations.',
  'Read-only daily glance and improved laptop layout.',
  'Daily entry streak, synced across devices.',
  'Separate internship to-do list and deadlines, with a refined laptop layout.'
];
type ListKind = 'todo'|'someday';
type Task = { listKind?:ListKind; id:string; userId:string; title:string; notes?:string; dueDate:string; scheduledDate?:string; dueTime?:string; durationMinutes?:number; reminderMinutesBefore?:number; priority:'High'|'Medium'|'Low'; repeat?:'none'|'daily'|'weekdays'|'weekly'; lastGeneratedDate?:string; completed:boolean; createdAt:string };
type Habit = { id:string; userId:string; name:string; emoji:string; goalType?:'build'|'quit'; trackingType?:'check'|'measurable'; targetValue?:number; unit?:string; reminderTime?:string; reminderMinutesBefore?:number; allowedSkipsPerWeek?:number; createdAt:string };
type ScheduleBlock = { id:string; userId:string; title:string; startTime:string; endTime:string; repeat:'weekly'|'once'; days:number[]; date?:string; createdAt:string };
type Checkin = { id:string; userId:string; habitId:string; date:string; completed:boolean; skipped?:boolean; value?:number; timerStartedAt?:string; elapsedSeconds?:number };
type Tab = 'today'|'schedule'|'tasks'|'upcoming'|'habits'|'progress'|'internship'|'internship-todo'|'internship-deadlines'|'settings';

const dateKey = (d:Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const nextRepeatDate = (value:string,repeat:NonNullable<Task['repeat']>) => { const d=new Date(value+'T12:00:00'); if(repeat==='daily')d.setDate(d.getDate()+1); else if(repeat==='weekly')d.setDate(d.getDate()+7); else { do { d.setDate(d.getDate()+1); } while(d.getDay()===0||d.getDay()===6); } return dateKey(d); };
const todayKey = () => dateKey(new Date());
const entryDayBefore=(day:string)=>{const d=new Date(day+'T12:00:00');d.setDate(d.getDate()-1);return dateKey(d);};
function summarizeEntryStreak(days:string[],today:string){
  const valid=[...new Set(days.filter(d=>d<=today))].sort();
  const logged=new Set(valid);
  let current=0, cursor=logged.has(today)?today:entryDayBefore(today);
  while(logged.has(cursor)){current++;cursor=entryDayBefore(cursor);}
  let best=0,run=0,previous='';
  for(const d of valid){run=previous===entryDayBefore(d)?run+1:1;best=Math.max(best,run);previous=d;}
  const recent=Array.from({length:7},(_,i)=>{const d=new Date(today+'T12:00:00');d.setDate(d.getDate()-6+i);const key=dateKey(d);return {key,label:d.toLocaleDateString('en-IN',{weekday:'short'}),logged:logged.has(key)};});
  return {current,best,loggedToday:logged.has(today),recent};
}
const mondayWeekStart = (value:string) => { const d=new Date(value+'T12:00:00'); d.setDate(d.getDate()-((d.getDay()+6)%7)); return dateKey(d); };
const habitStreak = (habitId:string,records:Checkin[],referenceDate:string) => { let cursor=new Date(referenceDate+'T12:00:00'); if(!records.some(c=>c.habitId===habitId&&c.date===referenceDate&&(c.completed||c.skipped)))cursor.setDate(cursor.getDate()-1); let count=0; for(let i=0;i<3650;i++){const key=dateKey(cursor);if(!records.some(c=>c.habitId===habitId&&c.date===key&&(c.completed||c.skipped)))break;count++;cursor.setDate(cursor.getDate()-1);}return count; };
const prettyDate = (value:string, options:Intl.DateTimeFormatOptions = {weekday:'long',month:'long',day:'numeric'}) => new Date(value+'T12:00:00').toLocaleDateString('en-IN', options);
const gitaWisdom = [
  { verse:'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।', transliteration:'Karmanye vadhikaraste ma phaleshu kadachana.', meaning:'You have the right to work, but never to the fruits of your actions.', reference:'Bhagavad Gita 2.47' },
  { verse:'योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय।', transliteration:'Yogasthah kuru karmani sangam tyaktva dhananjaya.', meaning:'Stay balanced and do your duty without attachment.', reference:'Bhagavad Gita 2.48' },
  { verse:'उद्धरेदात्मनात्मानं नात्मानमवसादयेत्।', transliteration:'Uddhared atmanatmanam natmanam avasadayet.', meaning:'Lift yourself through your own efforts; do not let yourself fall.', reference:'Bhagavad Gita 6.5' },
  { verse:'समत्वं योग उच्यते।', transliteration:'Samatvam yoga uchyate.', meaning:'Equanimity and balance are called yoga.', reference:'Bhagavad Gita 2.48' },
  { verse:'श्रद्धावाँल्लभते ज्ञानम्।', transliteration:'Shraddhavan labhate jnanam.', meaning:'A sincere and dedicated person gains wisdom.', reference:'Bhagavad Gita 4.39' },
  { verse:'योगः कर्मसु कौशलम्।', transliteration:'Yogah karmasu kaushalam.', meaning:'Yoga is excellence and skill in action.', reference:'Bhagavad Gita 2.50' },
  { verse:'न हि ज्ञानेन सदृशं पवित्रमिह विद्यते।', transliteration:'Na hi jnanena sadrisham pavitram iha vidyate.', meaning:'Nothing in this world is as purifying as true knowledge.', reference:'Bhagavad Gita 4.38' }
];
const getTimeGreeting = (date:Date) => { const hour=date.getHours(); return hour>=5&&hour<12?'Good morning':hour>=12&&hour<17?'Good afternoon':hour>=17&&hour<21?'Good evening':'Good night'; };
const dailyGitaWisdom = (date:Date) => gitaWisdom[Math.floor(new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime()/86400000)%gitaWisdom.length];
const timeToMinutes = (value:string) => { const [h,m]=value.split(':').map(Number); return h*60+m; };
const minutesToTime = (value:number) => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
const displayTime = (value:string) => new Date(`2000-01-01T${value}:00`).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'});
const priorityRank = (value:Task['priority']) => value==='High'?0:value==='Medium'?1:2;
const playReminderAlert = (sound:boolean,vibration:boolean) => {
  if (vibration) {
    if (Capacitor.isNativePlatform()) void Haptics.vibrate({duration:360}).catch(error=>console.warn('KRAM native reminder haptic unavailable',error));
    else if (typeof navigator!=='undefined' && typeof navigator.vibrate==='function') navigator.vibrate([180,90,180]);
  }
  if (!sound) return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    [0,0.22].forEach(offset => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = offset ? 880 : 660;
      gain.gain.setValueAtTime(0.0001,ctx.currentTime+offset);
      gain.gain.exponentialRampToValueAtTime(0.12,ctx.currentTime+offset+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+offset+0.16);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(ctx.currentTime+offset);
      oscillator.stop(ctx.currentTime+offset+0.18);
    });
    window.setTimeout(()=>void ctx.close(),700);
  } catch(error) {
    console.warn('KRAM alert sound unavailable',error);
  }
};
const triggerKramHaptic = (enabled:boolean,kind:'light'|'success'|'warning'='light') => {
  if(!enabled)return;
  if(Capacitor.isNativePlatform()){
    const action=kind==='light'
      ? Haptics.impact({style:ImpactStyle.Light})
      : Haptics.notification({type:kind==='success'?NotificationType.Success:NotificationType.Warning});
    void action.catch(error=>console.warn('KRAM native haptic unavailable',error));
    return;
  }
  if(typeof navigator!=='undefined'&&typeof navigator.vibrate==='function'){
    const pattern=kind==='success'?[18,35,24]:kind==='warning'?[35,35,35]:12;
    navigator.vibrate(pattern);
  }
};
const notificationId = (value:string) => { let hash=0; for(let i=0;i<value.length;i++) hash=((hash<<5)-hash+value.charCodeAt(i))|0; return Math.abs(hash)||1; };
const reminderDate = (date:string,time:string,minutesBefore:number) => { const value=new Date(date+'T'+time+':00'); value.setMinutes(value.getMinutes()-minutesBefore); return value; };
const isTaskOverdue = (task:Task, referenceDate=todayKey(), now=new Date()) => {
  if(task.completed||task.listKind==='someday')return false;
  if(task.dueDate&&task.dueDate<referenceDate)return true;
  const planned=task.scheduledDate||task.dueDate;
  if(task.dueTime&&planned&&planned<referenceDate)return true;
  if(planned!==referenceDate||!task.dueTime||referenceDate!==todayKey())return false;
  return timeToMinutes(task.dueTime)+(task.durationMinutes||60)<=now.getHours()*60+now.getMinutes();
};

const hashBlockPassword = async (sequence:number[]) => { const bytes=new TextEncoder().encode(sequence.join('-')); const digest=await crypto.subtle.digest('SHA-256',bytes); return Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,'0')).join(''); };
const compareAppVersions = (left:string,right:string) => {
  const a=left.replace(/^v/i,'').split('.').map(part=>Number.parseInt(part,10)||0);
  const b=right.replace(/^v/i,'').split('.').map(part=>Number.parseInt(part,10)||0);
  for(let i=0;i<Math.max(a.length,b.length);i++){const difference=(a[i]||0)-(b[i]||0);if(difference!==0)return difference;}
  return 0;
};
const getLatestKramRelease = async () => {
  const response=await fetch('https://api.github.com/repos/karthikeyapuri243-tech/CROWNFI-PLANNER-/releases/latest',{headers:{Accept:'application/vnd.github+json'}});
  if(!response.ok)throw new Error('GitHub release check failed ('+response.status+').');
  const release=await response.json();
  const version=String(release.tag_name||'').replace(/^v/i,'');
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('The latest KRAM release has an invalid version.');
  const apk=Array.isArray(release.assets)?release.assets.find((asset:any)=>asset.name==='KRAM-'+version+'.apk'):null;
  if(!apk?.browser_download_url)throw new Error('The latest KRAM release does not contain its APK file.');
  const installed=await CapacitorApp.getInfo();
  return compareAppVersions(version,installed.version)>0?{version,url:apk.browser_download_url}:null;
};

export default function App() {
  const [deleteTarget,setDeleteTarget]=useState<{id:string;kind:'task'|'idea'|'internship'|'habit'|'commitment';title:string;recurring?:boolean}|null>(null);
  const [deleteScope,setDeleteScope]=useState<'one'|'series'>('one');
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteError,setDeleteError]=useState('');
  const deletingRef=useRef(false);
  const [user,setUser] = useState<User|null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [updateIdentity,setUpdateIdentity]=useState<string|null>(null);
  const [whatsNewOpen,setWhatsNewOpen]=useState(false);
  const [installedVersion,setInstalledVersion]=useState('');
  const [blockLockHash,setBlockLockHash] = useState(()=>localStorage.getItem('KRAM-block-lock')||'');
  const [blockLockSetup,setBlockLockSetup] = useState(false);
  const [blockLockStage,setBlockLockStage] = useState<'create'|'confirm'>('create');
  const [blockLockSequence,setBlockLockSequence] = useState<number[]>([]);
  const [blockLockFirst,setBlockLockFirst] = useState<number[]>([]);
  const [blockLockError,setBlockLockError] = useState('');
  const [unlockSequence,setUnlockSequence] = useState<number[]>([]);
  const [isLocked,setIsLocked] = useState(()=>!!localStorage.getItem('KRAM-block-lock'));
  const [tasks,setTasks] = useState<Task[]>([]);
  const [internshipTasks,setInternshipTasks] = useState<Task[]>([]);
  const [internshipFormOpen,setInternshipFormOpen] = useState(false);
  const [internshipSaving,setInternshipSaving] = useState(false);
  const [internshipError,setInternshipError] = useState('');
  const [internshipEditing,setInternshipEditing] = useState<Task|null>(null);
  const [internshipTitle,setInternshipTitle] = useState('');
  const [internshipNotes,setInternshipNotes] = useState('');
  const [internshipDeadline,setInternshipDeadline] = useState('');
  const [internshipPriority,setInternshipPriority] = useState<'High'|'Medium'|'Low'>('Medium');
  const [internshipFilter,setInternshipFilter] = useState<'All'|'Open'|'Overdue'|'Completed'>('Open');
  const [internshipSearch,setInternshipSearch] = useState('');
  const [workQuickTitle,setWorkQuickTitle]=useState('');
  const [workQuickBusy,setWorkQuickBusy]=useState(false);
  const [tasksLoaded,setTasksLoaded] = useState(false);
  const [syncError,setSyncError] = useState('');
  const [clockNow,setClockNow] = useState(()=>new Date());
  const [habits,setHabits] = useState<Habit[]>([]);
  const [habitsLoaded,setHabitsLoaded] = useState(false);
  const [checkins,setCheckins] = useState<Checkin[]>([]);
  const [entryLog,setEntryLog]=useState<{uid:string;days:string[];error?:boolean}>({uid:'',days:[]});
  const [blocks,setBlocks] = useState<ScheduleBlock[]>([]);
  const [blockOpen,setBlockOpen] = useState(false);
  const [editingBlock,setEditingBlock] = useState<ScheduleBlock|null>(null);
  const [blockTitle,setBlockTitle] = useState('');
  const [blockStart,setBlockStart] = useState('09:00');
  const [blockEnd,setBlockEnd] = useState('10:00');
  const [blockRepeat,setBlockRepeat] = useState<'weekly'|'once'>('weekly');
  const [blockDate,setBlockDate] = useState(todayKey());
  const [blockDays,setBlockDays] = useState<number[]>([1,2,3,4,5]);
  const [blockError,setBlockError] = useState('');
  const [dragTaskId,setDragTaskId] = useState('');
  const [tab,setTab] = useState<Tab>('today');
  const reducedMotion = useReducedMotion();
  const pageMotion = {initial:{opacity:0,y:reducedMotion?0:7},animate:{opacity:1,y:0},exit:{opacity:0,y:0,transition:{duration:reducedMotion?0:0.045}},transition:{duration:reducedMotion?0:0.15,ease:[0.22,1,0.36,1] as const}};
  const sheetBackdropMotion = {initial:{opacity:0},animate:{opacity:1},exit:{opacity:0},transition:{duration:reducedMotion?0:0.13}};
  const sheetMotion = {initial:{opacity:reducedMotion?1:0,y:reducedMotion?0:28,scale:reducedMotion?1:0.98},animate:{opacity:1,y:0,scale:1},exit:{opacity:0,y:reducedMotion?0:20,scale:reducedMotion?1:0.98},transition:{duration:reducedMotion?0:0.19,ease:[0.22,1,0.36,1] as const}};
  const [shlokaExpanded,setShlokaExpanded] = useState(false);
  const [workspaceMode,setWorkspaceMode] = useState<'personal'|'internship'>('personal');
  const [selectedDate,setSelectedDate] = useState(todayKey());
  const [dark,setDark] = useState(() => localStorage.getItem('KRAM-theme') === 'dark');
  const [taskOpen,setTaskOpen] = useState(false);
  const [taskStep,setTaskStep] = useState<1|2>(1);
  const [habitStep,setHabitStep] = useState<1|2>(1);
  const [workStep,setWorkStep] = useState<1|2>(1);
  const [reminderMinutesBefore,setReminderMinutesBefore] = useState(0);
  const [habitReminderTime,setHabitReminderTime] = useState('');
  const [habitReminderMinutesBefore,setHabitReminderMinutesBefore] = useState(10);
  const [alertsOpen,setAlertsOpen] = useState(false);
  const [updateAvailable,setUpdateAvailable] = useState<{version:string;url:string}|null>(null);
  const [updateChecking,setUpdateChecking] = useState(false);
  const [updateBusy,setUpdateBusy] = useState(false);
  const [updateProgress,setUpdateProgress] = useState(0);
  const [updateMessage,setUpdateMessage] = useState('');
  const [downloadedUpdatePath,setDownloadedUpdatePath] = useState('');
  const [notificationsEnabled,setNotificationsEnabled] = useState(()=>localStorage.getItem('KRAM-notifications')==='on');
  const [soundEnabled,setSoundEnabled] = useState(()=>localStorage.getItem('KRAM-sound')!=='off');
  const [vibrationEnabled,setVibrationEnabled] = useState(()=>localStorage.getItem('KRAM-vibration')!=='off');
  const [taskError,setTaskError] = useState('');
  const [savingTask,setSavingTask] = useState(false);
  const [quickTaskTitle,setQuickTaskTitle] = useState('');
  const [quickTaskSaving,setQuickTaskSaving] = useState(false);
  const [quickTaskError,setQuickTaskError] = useState('');
  const [habitOpen,setHabitOpen] = useState(false);
  const [editing,setEditing] = useState<Task|null>(null);
  const [title,setTitle] = useState('');
  const [notes,setNotes] = useState('');
  const [dueDate,setDueDate] = useState('');
  const [scheduleDate,setScheduleDate] = useState(todayKey());
  const [dueTime,setDueTime] = useState('');
  const [endTime,setEndTime] = useState('');
  const [durationMinutes,setDurationMinutes] = useState(60);
  const [scheduleStart,setScheduleStart] = useState(() => localStorage.getItem('KRAM-schedule-start') || '08:00');
  const [scheduleEnd,setScheduleEnd] = useState(() => localStorage.getItem('KRAM-schedule-end') || '21:00');
  const [scheduling,setScheduling] = useState(false);
  const [smartMessage,setSmartMessage] = useState('');
  const [momentumToast,setMomentumToast] = useState('');
  const [momentumToastKey,setMomentumToastKey] = useState(0);
  const showMomentumToast=(message:string)=>{setMomentumToast(message);setMomentumToastKey(key=>key+1);window.setTimeout(()=>setMomentumToast(current=>current===message?'':current),2800);};
  const [priority,setPriority] = useState<'High'|'Medium'|'Low'>('Medium');
  const [repeat,setRepeat] = useState<NonNullable<Task['repeat']>>('none');
  const [habitName,setHabitName] = useState('');
  const [habitGoalType,setHabitGoalType] = useState<'build'|'quit'>('build');
  const [habitEmoji,setHabitEmoji] = useState('✦');
  const [habitTrackingType,setHabitTrackingType] = useState<'check'|'measurable'>('check');
  const [habitTarget,setHabitTarget] = useState('');
  const [habitUnit,setHabitUnit] = useState('minutes');
  const [habitAllowedSkips,setHabitAllowedSkips] = useState(1);
  const [habitError,setHabitError] = useState('');
  const [mobileMenu,setMobileMenu] = useState(false);
  const [filter,setFilter] = useState<'All'|'Open'|'Completed'>('Open');
  const [listView,setListView] = useState<ListKind>('todo');
  const [taskListKind,setTaskListKind] = useState<ListKind>('todo');
  const [scheduleRequired,setScheduleRequired] = useState(false);
  const [listError,setListError] = useState('');
  const [movingTaskId,setMovingTaskId] = useState<string|null>(null);
  const [taskQuery,setTaskQuery] = useState('');
  const [priorityFilter,setPriorityFilter] = useState<'All'|'High'|'Medium'|'Low'>('All');
  const [taskSort,setTaskSort] = useState<'Date'|'Priority'|'Title'>('Date');

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); }),[]);
  useEffect(()=>{
    let active=true;
    const init=async()=>{
      let version='';
      if(Capacitor.isNativePlatform()){try{version=(await CapacitorApp.getInfo()).version;}catch(error){console.warn('KRAM version check failed',error);}}
      if(active){setInstalledVersion(version);setUpdateIdentity((version?'android:'+version:'web')+':'+KRAM_UPDATE_REVISION);}
    };
    void init();return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!user||isLocked||blockLockSetup||!updateIdentity)return;
    try{if(localStorage.getItem('KRAM-last-seen-update')!==updateIdentity)setWhatsNewOpen(true);}catch{setWhatsNewOpen(true);}
  },[user?.uid,isLocked,blockLockSetup,updateIdentity]);
  const closeWhatsNew=()=>{if(updateIdentity){try{localStorage.setItem('KRAM-last-seen-update',updateIdentity);}catch{}}setWhatsNewOpen(false);};
  useEffect(()=>{window.scrollTo({top:0,left:0,behavior:'instant'});setShlokaExpanded(false);},[tab,workspaceMode]);
  useEffect(()=>{
    if(!blockLockHash)return;
    const lock=()=>setIsLocked(true);
    const visibility=()=>{if(document.visibilityState==='hidden')lock();};
    document.addEventListener('visibilitychange',visibility);
    let listener:{remove:()=>Promise<void>}|null=null;
    if(Capacitor.isNativePlatform())void CapacitorApp.addListener('appStateChange',state=>{if(!state.isActive)lock();}).then(handle=>{listener=handle;});
    return()=>{document.removeEventListener('visibilitychange',visibility);if(listener)void listener.remove();};
  },[blockLockHash]);
  const startBlockLockSetup=()=>{setBlockLockSequence([]);setBlockLockFirst([]);setBlockLockStage('create');setBlockLockError('');setBlockLockSetup(true);};
  const tapLockBlock=(index:number,mode:'setup'|'unlock')=>{if(mode==='unlock'){setUnlockSequence(current=>[...current,index]);setBlockLockError('');return;}setBlockLockSequence(current=>[...current,index]);setBlockLockError('');};
  const finishBlockLockEntry=async()=>{
    if(blockLockSetup){
      if(blockLockSequence.length<2){setBlockLockError('Choose at least 2 taps. Repeating a block is allowed.');return;}
      if(blockLockStage==='create'){setBlockLockFirst(blockLockSequence);setBlockLockSequence([]);setBlockLockStage('confirm');setBlockLockError('Repeat the same taps to confirm.');return;}
      if(blockLockSequence.join(',')!==blockLockFirst.join(',')){setBlockLockSequence([]);setBlockLockError('That sequence does not match. Try again.');return;}
      try{const hash=await hashBlockPassword(blockLockSequence);localStorage.setItem('KRAM-block-lock',hash);setBlockLockHash(hash);setBlockLockSetup(false);setBlockLockSequence([]);setBlockLockFirst([]);setBlockLockError('');setIsLocked(false);}catch(error){console.error('KRAM block lock setup failed',error);setBlockLockError('Could not save the block lock on this device.');}
      return;
    }
    if(!blockLockHash||unlockSequence.length<2){setBlockLockError('Enter your block password first.');return;}
    try{const hash=await hashBlockPassword(unlockSequence);if(hash===blockLockHash){setIsLocked(false);setUnlockSequence([]);setBlockLockError('');}else{setUnlockSequence([]);setBlockLockError('Password is wrong. Try again.');}}catch(error){console.error('KRAM block unlock failed',error);setUnlockSequence([]);setBlockLockError('Could not check the password. Try again.');}
  };
  useEffect(()=>{
    if(!user||Capacitor.getPlatform()!=='android')return;
    let cancelled=false;
    const check=async()=>{try{const update=await getLatestKramRelease();if(!cancelled)setUpdateAvailable(update);}catch(error){console.warn('KRAM automatic update check failed',error);}};
    void check();
    return()=>{cancelled=true;};
  },[user]);

  const checkForKramUpdate = async () => {
    setUpdateChecking(true);setUpdateMessage('');
    try{const update=await getLatestKramRelease();setUpdateAvailable(update);setDownloadedUpdatePath('');setUpdateProgress(0);setUpdateMessage(update?'KRAM '+update.version+' is available.':'KRAM is already up to date.');}
    catch(error){console.warn('KRAM update check failed',error);setUpdateMessage('Could not check for updates. Please check your internet connection and try again.');}
    finally{setUpdateChecking(false);}
  };

  const sendTestNotification = async () => {
    try {
      if(Capacitor.isNativePlatform()){
        const permission=await LocalNotifications.checkPermissions();
        if(permission.display!=='granted'){setSmartMessage('Allow notifications in Android settings, then try again.');return;}
        await LocalNotifications.createChannel({id:'kram-reminders',name:'KRAM reminders',description:'Task and habit reminders',importance:5,sound:'default',vibrationPattern:[180,90,180]});
        await LocalNotifications.schedule({notifications:[{id:notificationId('test-'+Date.now()),title:'KRAM test reminder',body:'Notifications are working on this device.',schedule:{at:new Date(Date.now()+5000),allowWhileIdle:true},channelId:'kram-reminders',sound:'default'}]});
      }else{
        if(!('Notification' in window)||Notification.permission!=='granted'){setSmartMessage('Allow browser notifications first.');return;}
        new Notification('KRAM test reminder',{body:'Notifications are working on this device.',icon:'/kram-icon.svg'});
      }
      setSmartMessage('Test reminder set. It should appear in about 5 seconds.');
    }catch(error){console.error('KRAM test notification failed',error);setSmartMessage('The test reminder could not be sent. Check notification permission in your device settings.');}
  };
  const downloadAndInstallKramUpdate = async () => {
    if(!updateAvailable)return;
    setUpdateBusy(true);setUpdateMessage('');
    try{
      let apkPath=downloadedUpdatePath;
      if(!apkPath){
        setUpdateProgress(0);
        const file=await Filesystem.getUri({directory:Directory.Cache,path:'KRAM-'+updateAvailable.version+'.apk'});
        const progressListener=await FileTransfer.addListener('progress',event=>{if(event.contentLength>0)setUpdateProgress(Math.min(100,Math.round(event.bytes/event.contentLength*100)));});
        try{await FileTransfer.downloadFile({url:updateAvailable.url,path:file.uri,progress:true});}
        finally{await progressListener.remove();}
        apkPath=file.uri;setDownloadedUpdatePath(file.uri);setUpdateProgress(100);
      }
      const permission=await KramInstaller.canInstallUnknownApps();
      if(!permission.granted){await KramInstaller.openInstallUnknownAppsSettings();setUpdateMessage('Allow KRAM to install unknown apps in Android settings. Return here and tap Install update again.');return;}
      await KramInstaller.installApk({filePath:apkPath});
      setUpdateMessage('Android installer opened. Follow the on-screen prompts to update KRAM.');
    }catch(error){console.error('KRAM update installation failed',error);setUpdateMessage('The update could not be installed. Please try again or use the release page.');}
    finally{setUpdateBusy(false);}
  };

  useEffect(() => {const refresh=()=>{if(!document.hidden)setClockNow(new Date());};const timer=window.setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[]);
  useEffect(()=>{if(!Capacitor.isNativePlatform())return;let active=true;LocalNotifications.checkPermissions().then(permission=>{if(!active)return;const enabled=permission.display==='granted';setNotificationsEnabled(enabled);localStorage.setItem('KRAM-notifications',enabled?'on':'off');}).catch(error=>console.warn('KRAM notification permission check failed',error));return()=>{active=false;};},[]);
  useEffect(()=>{if(Capacitor.isNativePlatform()||!notificationsEnabled||!('Notification' in window)||Notification.permission!=='granted')return;const check=()=>{const now=new Date();const today=dateKey(now);const currentMinute=now.getHours()*60+now.getMinutes();const notify=(key:string,titleText:string,body:string)=>{if(localStorage.getItem(key)==='sent')return;localStorage.setItem(key,'sent');const options={body,icon:'/kram-icon.svg',tag:key};if('serviceWorker' in navigator){navigator.serviceWorker.ready.then(registration=>registration.showNotification(titleText,options)).catch(error=>{console.warn('KRAM service-worker notification failed',error);});}else{try{new Notification(titleText,options);}catch(error){console.warn('KRAM notification failed',error);}}playReminderAlert(soundEnabled,vibrationEnabled);};tasks.filter(t=>t.listKind!=='someday'&&!t.completed&&(t.scheduledDate||t.dueDate)===today&&!!t.dueTime&&t.reminderMinutesBefore!==null&&t.reminderMinutesBefore!==undefined).forEach(t=>{const at=timeToMinutes(t.dueTime!)-t.reminderMinutesBefore!;if(currentMinute===at)notify('KRAM-reminder-task-'+t.id+'-'+today,'Task reminder',t.title+' is coming up.');});habits.filter(h=>!!h.reminderTime).forEach(h=>{const at=timeToMinutes(h.reminderTime!)-(h.reminderMinutesBefore??10);if(currentMinute===at)notify('KRAM-reminder-habit-'+h.id+'-'+today,'Habit reminder','Time to work on '+h.name+'.');});};check();const timer=window.setInterval(check,15000);return()=>window.clearInterval(timer);},[notificationsEnabled,soundEnabled,vibrationEnabled,tasks,habits]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !notificationsEnabled || !user || !tasksLoaded || !habitsLoaded) return;
    let cancelled = false;
    const syncNativeReminders = async () => {
      try {
        const permission = await LocalNotifications.checkPermissions();
        if (permission.display !== 'granted' || cancelled) return;
        await LocalNotifications.createChannel({ id:'kram-reminders', name:'KRAM reminders', description:'Task and habit reminders', importance:5, sound:'default', vibrationPattern:[180,90,180] });
        const now = new Date();
        const upcoming: Array<{id:number;title:string;body:string;schedule:{at:Date;allowWhileIdle:boolean};channelId:string;sound:string}> = [];
        tasks.filter(task=>task.listKind!=='someday'&&!task.completed && !!task.dueTime && !!(task.scheduledDate||task.dueDate) && task.reminderMinutesBefore!==null && task.reminderMinutesBefore!==undefined).forEach(task=>{
          const at=reminderDate(task.scheduledDate||task.dueDate,task.dueTime!,task.reminderMinutesBefore);
          if(at>now) upcoming.push({id:notificationId('task-'+task.id+'-'+task.dueDate),title:'Task reminder',body:task.title+' is coming up.',schedule:{at,allowWhileIdle:true},channelId:'kram-reminders',sound:'default'});
        });
        habits.filter(habit=>!!habit.reminderTime).forEach(habit=>{
          for(let offset=0;offset<30;offset++){
            const day=new Date(now); day.setHours(0,0,0,0); day.setDate(day.getDate()+offset);
            const date=dateKey(day);
            const at=reminderDate(date,habit.reminderTime!,habit.reminderMinutesBefore??0);
            if(at>now) upcoming.push({id:notificationId('habit-'+habit.id+'-'+date),title:'Habit reminder',body:'Time to work on '+habit.name+'.',schedule:{at},channelId:'kram-reminders',sound:'default'});
          }
        });
        if(cancelled) return;
        const pending=(await LocalNotifications.getPending()).notifications;
        if(pending.length) await LocalNotifications.cancel({notifications:pending.map(item=>({id:item.id}))});
        if(upcoming.length) await LocalNotifications.schedule({notifications:upcoming});
      } catch(error) {
        console.warn('KRAM native reminder scheduling failed',error);
      }
    };
    void syncNativeReminders();
    return ()=>{cancelled=true;};
  },[notificationsEnabled,user,tasks,habits,tasksLoaded,habitsLoaded]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark',dark);
    localStorage.setItem('KRAM-theme',dark?'dark':'light');
  },[dark]);
  useEffect(() => { localStorage.setItem('KRAM-schedule-start',scheduleStart); localStorage.setItem('KRAM-schedule-end',scheduleEnd); },[scheduleStart,scheduleEnd]);
  useEffect(() => {
    if(!user) return;
    const a=subscribePlannerTasks(user.uid,items=>{setTasks(items);setTasksLoaded(true);setSyncError('');},()=>{setTasksLoaded(true);setSyncError('Tasks could not sync. Check your internet connection and refresh the planner.');});
    const b=subscribePlannerHabits(user.uid,items=>{setHabits(items);setHabitsLoaded(true);});
    const c=subscribePlannerCheckins(user.uid,setCheckins,days=>setEntryLog({uid:user.uid,days}),()=>setEntryLog({uid:user.uid,days:[],error:true}));
    const d=subscribePlannerBlocks(user.uid,setBlocks);
    const work=subscribeInternshipTasks(user.uid,items=>{setInternshipTasks(items);setInternshipError('');},()=>setInternshipError('Work could not sync. Check your internet connection.'));
    return () => {a();b();c();d();work();};
  },[user]);

  const todaysTasks = useMemo(() => tasks.filter(t=>t.listKind!=='someday'&&(t.scheduledDate||t.dueDate)===selectedDate).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||'')),[tasks,selectedDate]);
  const entryToday=dateKey(clockNow);
  const entryReady=!!user&&entryLog.uid===user.uid&&!entryLog.error;
  const entryStreak=useMemo(()=>summarizeEntryStreak(entryReady?entryLog.days:[],entryToday),[entryReady,entryLog.days,entryToday]);
  const doneCount = todaysTasks.filter(t=>t.completed).length;
  const completion = todaysTasks.length ? Math.round(doneCount/todaysTasks.length*100) : 0;
  const todayCheckins = habits.filter(h=>checkins.some(c=>c.habitId===h.id&&c.date===selectedDate&&c.completed)).length;
  const week = useMemo(()=>Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const key=dateKey(d);const day=tasks.filter(t=>t.listKind!=='someday'&&(t.scheduledDate||t.dueDate)===key);return {key,label:d.toLocaleDateString('en-IN',{weekday:'short'}),total:day.length,done:day.filter(t=>t.completed).length};}),[tasks]);

  const openNewTask = (date='',kind:ListKind='todo') => {setTaskListKind(kind);setScheduleRequired(false);setTaskStep(1);setEditing(null);setTitle('');setNotes('');setDueDate('');setScheduleDate(date||selectedDate);setDueTime('');setEndTime('');setDurationMinutes(30);setReminderMinutesBefore(-1);setPriority('Medium');setRepeat('none');setTaskError('');setTaskOpen(true);};
  const openEditTask = (t:Task) => {setTaskListKind(t.listKind||'todo');setScheduleRequired(false);setTaskStep(1);setEditing(t);setTitle(t.title);setNotes(t.notes||'');setDueDate(t.dueDate||'');setScheduleDate(t.scheduledDate||(t.dueTime?t.dueDate:selectedDate)||selectedDate);setDueTime(t.dueTime||'');setEndTime(t.dueTime?minutesToTime(timeToMinutes(t.dueTime)+(t.durationMinutes||60)):'');setDurationMinutes(t.durationMinutes||60);setReminderMinutesBefore(t.reminderMinutesBefore??0);setPriority(t.priority);setRepeat(t.repeat||'none');setTaskError('');setTaskOpen(true);};
  const openTaskSchedule = (t:Task) => {if(t.completed||t.listKind==='someday')return;openEditTask(t);setScheduleDate(t.scheduledDate||selectedDate);setScheduleRequired(true);setTaskStep(2);};
  const moveToTodo = async(t:Task)=>{if(movingTaskId||t.listKind!=='someday'||t.completed)return;setMovingTaskId(t.id);setListError('');try{await updatePlannerTask(t.id,{listKind:'todo',dueDate:'',scheduledDate:'',dueTime:'',reminderMinutesBefore:null,repeat:'none'});setListView('todo');setFilter('Open');setTaskQuery('');setPriorityFilter('All');showMomentumToast('Moved to your to-do list');}catch(error){console.error(error);setListError('Could not move this item. Please try again.');}finally{setMovingTaskId(null);}};
  const saveTask = async (e:FormEvent) => {
    e.preventDefault();
    if (savingTask) return;
    if (!user) { setTaskError('You are signed out. Please sign in again.'); return; }
    if (!title.trim()) { setTaskError('Please enter a name.'); return; }
    if(taskListKind==='someday'){
      setSavingTask(true);setTaskError('');
      try{const payload={title:title.trim(),notes:notes.trim(),listKind:'someday',dueDate:'',scheduledDate:'',dueTime:'',reminderMinutesBefore:null,priority:'Medium',repeat:'none',completed:editing?.completed||false};if(editing)await updatePlannerTask(editing.id,payload);else await createPlannerTask(user.uid,payload);setListView('someday');setFilter(editing?.completed?'All':'Open');setTaskQuery('');setPriorityFilter('All');setTab('tasks');setTaskOpen(false);}catch(error){console.error(error);setTaskError('Could not save this idea. Please try again.');}finally{setSavingTask(false);}return;
    }
    if(scheduleRequired&&!dueTime){setTaskError('Choose a start and end time to schedule this to-do.');return;}
    if (repeat!=='none'&&!dueDate) { setTaskError('Choose a start date for a repeating task.'); return; }
    if (!!dueTime !== !!endTime) { setTaskError('Enter both a start time and an end time.'); return; }
    const calculatedDuration=dueTime&&endTime?timeToMinutes(endTime)-timeToMinutes(dueTime):0;
    if (dueTime && calculatedDuration<=0) { setTaskError('End time must be later than start time.'); return; }
    const plannedDate=dueTime?(scheduleDate||selectedDate):'';
    if (dueTime && !plannedDate) { setTaskError('Choose the day for this task.'); return; }
    if (dueTime) {
      const start = timeToMinutes(dueTime);
      const finish = start + calculatedDuration;
      const matchingBlocks = blocks.filter(b =>
        b.repeat === 'weekly'
          ? b.days.includes(new Date(plannedDate + 'T12:00:00').getDay())
          : b.date === plannedDate
      );
      const overlapsClass = matchingBlocks.some(b =>
        start < timeToMinutes(b.endTime) && finish > timeToMinutes(b.startTime)
      );
      const overlapsTask = tasks.some(t =>
        t.id !== editing?.id &&
        t.listKind!=='someday' &&
        !t.completed &&
        (t.scheduledDate||t.dueDate) === plannedDate &&
        !!t.dueTime &&
        start < timeToMinutes(t.dueTime) + (t.durationMinutes || 60) &&
        finish > timeToMinutes(t.dueTime)
      );
      if (overlapsClass || overlapsTask) {
        setTaskError(overlapsClass
          ? 'This time overlaps a class or commitment. Choose a free time.'
          : 'This time overlaps another task. Choose a free time.');
        return;
      }
    }
    setSavingTask(true);
    setTaskError('');
    try {
      const payload={listKind:'todo',title:title.trim(),notes:notes.trim(),dueDate:dueDate||'',scheduledDate:plannedDate,dueTime:dueTime||'',...(dueTime?{durationMinutes:calculatedDuration}:{}),reminderMinutesBefore:dueTime&&reminderMinutesBefore>=0?reminderMinutesBefore:null,priority,repeat,completed:editing?.completed||false};
      if(editing) await updatePlannerTask(editing.id,payload);
      else await createPlannerTask(user.uid,payload);
      if(tab==='tasks'){setListView('todo');setFilter(editing?.completed?'All':'Open');setTaskQuery('');setPriorityFilter('All');}
      if(scheduleRequired)showMomentumToast('Added to your planner');
      setTaskOpen(false);
    } catch (err) {
      console.error('KRAM task save failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      setTaskError(message.includes('permission')?'Could not save this task. Check your account access.':'Could not save this task. Check your connection and try again.');
    } finally {
      setSavingTask(false);
    }
  };
  const toggleTask = async (t:Task) => {
    const nextCompleted=!t.completed;
    setTasks(current=>current.map(item=>item.id===t.id?{...item,completed:nextCompleted}:item));
    try {
      await updatePlannerTask(t.id,{completed:nextCompleted});
    } catch(error) {
      setTasks(current=>current.map(item=>item.id===t.id?{...item,completed:t.completed}:item));
      console.error('KRAM task completion update failed:',error);
      setSmartMessage('Could not update this task. Please check your connection and try again.');
      return;
    }
    if(nextCompleted){
      celebrate({particleCount:55,spread:62,origin:{y:0.72},scalar:0.8});
      triggerKramHaptic(vibrationEnabled,'success');
      showMomentumToast('Task complete · one more step forward');
    }
    if(nextCompleted&&t.listKind!=='someday'&&t.repeat&&t.repeat!=='none'&&t.dueDate) {
      const nextDate=nextRepeatDate(t.dueDate,t.repeat);
      if(t.lastGeneratedDate!==nextDate) {
        try {
          const created=await createRecurringPlannerOccurrence(t.id,t.userId,nextDate,{title:t.title,notes:t.notes||'',dueDate:nextDate,dueTime:t.dueTime||'',durationMinutes:t.durationMinutes||60,priority:t.priority,repeat:t.repeat,completed:false});
          setSmartMessage(created?'Task completed. Next '+t.repeat+' task added for '+prettyDate(nextDate,{month:'short',day:'numeric'})+'.':'Task completed. The next occurrence already exists, so no duplicate was added.');
        } catch(error) {
          console.error('KRAM recurring task creation failed:',error);
          setSmartMessage('Task completed, but the next recurring task could not be created. Please try again.');
        }
      }
    }
  };
  const saveQuickTask = async (e:FormEvent) => {
    e.preventDefault();
    if (!user || !quickTaskTitle.trim() || quickTaskSaving) return;
    setQuickTaskSaving(true);
    setQuickTaskError('');
    try {
      await createPlannerTask(user.uid,{listKind:tab==='tasks'?listView:'todo',title:quickTaskTitle.trim(),notes:'',dueDate:'',scheduledDate:'',dueTime:'',priority:'Medium',completed:false});
      if(tab==='tasks'){setFilter('Open');setTaskQuery('');setPriorityFilter('All');}
      setQuickTaskTitle('');
    } catch (err) {
      console.error('KRAM quick task save failed:',err);
      setQuickTaskError('Could not add task. Please try again.');
    } finally {
      setQuickTaskSaving(false);
    }
  };

  const activeBlocks = useMemo(()=>blocks.filter(b=>b.repeat==='weekly'?b.days.includes(new Date(selectedDate+'T12:00:00').getDay()):b.date===selectedDate),[blocks,selectedDate]);
  const saveBlock = async (e:FormEvent) => {
    e.preventDefault();setBlockError('');
    if(!user||!blockTitle.trim()){setBlockError('Enter a name for this commitment.');return;}
    if(timeToMinutes(blockEnd)<=timeToMinutes(blockStart)){setBlockError('End time must be later than start time.');return;}
    if(blockRepeat==='weekly'&&!blockDays.length){setBlockError('Choose at least one day.');return;}
    const newStart=timeToMinutes(blockStart),newEnd=timeToMinutes(blockEnd);
    const overlapsExisting=blocks.some(existing=>{
      if(existing.id===editingBlock?.id)return false;
      const existingStart=timeToMinutes(existing.startTime),existingEnd=timeToMinutes(existing.endTime);
      if(newStart>=existingEnd||newEnd<=existingStart)return false;
      if(blockRepeat==='once'&&existing.repeat==='once')return blockDate===existing.date;
      if(blockRepeat==='weekly'&&existing.repeat==='weekly')return blockDays.some(day=>existing.days.includes(day));
      if(blockRepeat==='once'&&existing.repeat==='weekly')return existing.days.includes(new Date(blockDate+'T12:00:00').getDay());
      if(blockRepeat==='weekly'&&existing.repeat==='once')return blockDays.includes(new Date((existing.date||'')+'T12:00:00').getDay());
      return false;
    });
    if(overlapsExisting){setBlockError('This time overlaps another commitment. Choose a different time or day.');return;}
    try{const payload={title:blockTitle.trim(),startTime:blockStart,endTime:blockEnd,repeat:blockRepeat,days:blockRepeat==='weekly'?blockDays:[],date:blockRepeat==='once'?blockDate:''};if(editingBlock) await updatePlannerBlock(editingBlock.id,payload);else await createPlannerBlock(user.uid,payload);setBlockOpen(false);setBlockTitle('');setEditingBlock(null);}
    catch(error){console.error(error);setBlockError('Could not save. Check your connection and Firebase permissions.');}
  };
  const openBlockForm=()=>{setEditingBlock(null);setBlockTitle('');setBlockStart('09:00');setBlockEnd('10:00');setBlockRepeat('weekly');setBlockDate(selectedDate);setBlockDays([1,2,3,4,5]);setBlockError('');setBlockOpen(true);};
  const openEditBlock=(block:ScheduleBlock)=>{setEditingBlock(block);setBlockTitle(block.title);setBlockStart(block.startTime);setBlockEnd(block.endTime);setBlockRepeat(block.repeat);setBlockDate(block.date||selectedDate);setBlockDays(block.days||[]);setBlockError('');setBlockOpen(true);};
  const requestDelete=(target:NonNullable<typeof deleteTarget>)=>{if(deletingRef.current)return;setDeleteScope('one');setDeleteError('');setDeleteTarget(target);};
  const closeDelete=()=>{if(!deletingRef.current)setDeleteTarget(null);};
  const handleDeleteTask=(id:string)=>{const task=tasks.find(t=>t.id===id);if(!task)return;requestDelete({id,kind:task.listKind==='someday'?'idea':'task',title:task.title,recurring:!!task.repeat&&task.repeat!=='none'});};
  const confirmDelete=async()=>{
    if(!deleteTarget||!user||deletingRef.current)return;
    const target=deleteTarget;deletingRef.current=true;setDeleteBusy(true);setDeleteError('');
    try{
      if(target.kind==='habit')await deletePlannerHabit(target.id);
      else if(target.kind==='commitment')await deletePlannerBlock(target.id);
      else if(target.kind==='internship')await deleteInternshipTask(target.id);
      else if(target.recurring&&deleteScope==='series'){
        const task=tasks.find(t=>t.id===target.id);
        const root=tasks.filter(t=>target.id.startsWith(t.id+'_')&&t.repeat&&t.repeat!=='none').sort((a,b)=>a.id.length-b.id.length)[0]||task;
        const rootId=(root?.id||target.id).replace(/(?:_\d{4}-\d{2}-\d{2})+$/,'');
        await deletePlannerTaskSeries(user.uid,rootId);
      }else await deletePlannerTask(target.id);
      setDeleteTarget(null);triggerKramHaptic(vibrationEnabled,'success');showMomentumToast('Deleted');
    }catch(error){console.error('KRAM delete failed',error);setDeleteError('Could not delete this item. Please try again.');}
    finally{deletingRef.current=false;setDeleteBusy(false);}
  };
  const openInternshipForm=(task?:Task)=>{setWorkStep(1);setInternshipError('');setInternshipEditing(task||null);setInternshipTitle(task?.title||'');setInternshipNotes(task?.notes||'');setInternshipDeadline(task?.dueDate||'');setInternshipPriority(task?.priority||'Medium');setInternshipFormOpen(true);};
  const saveQuickWork=async(e:FormEvent)=>{e.preventDefault();if(!user||!workQuickTitle.trim()||workQuickBusy)return;setWorkQuickBusy(true);setInternshipError('');try{await createInternshipTask(user.uid,{title:workQuickTitle.trim(),notes:'',dueDate:'',priority:'Medium',completed:false});setWorkQuickTitle('');setInternshipSearch('');setInternshipFilter('Open');}catch(error){console.error(error);setInternshipError('Could not add work. Please try again.');}finally{setWorkQuickBusy(false);}};
  const saveInternshipTask=async(e:FormEvent)=>{e.preventDefault();if(!user||!internshipTitle.trim()||internshipSaving)return;setInternshipSaving(true);setInternshipError('');const payload={title:internshipTitle.trim(),notes:internshipNotes.trim(),dueDate:internshipDeadline||'',priority:internshipPriority,completed:internshipEditing?.completed||false};try{if(internshipEditing)await updateInternshipTask(internshipEditing.id,payload);else await createInternshipTask(user.uid,payload);setInternshipSearch('');setInternshipFilter(internshipEditing?.completed?'All':'Open');setInternshipFormOpen(false);if(!internshipEditing&&tab==='internship')setTab('internship-todo');if(!internshipEditing&&tab==='internship-deadlines'&&!internshipDeadline)setTab('internship-todo');}catch(error){console.error('KRAM internship task save failed',error);setInternshipError('Could not save work. Check your connection and try again.');}finally{setInternshipSaving(false);}};
  const toggleInternshipTask=async(task:Task)=>{try{await updateInternshipTask(task.id,{completed:!task.completed});if(!task.completed){celebrate({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');}}catch(error){console.error(error);setInternshipError('Could not update this internship task. Please try again.');}};
  const removeInternshipTask=(task:Task)=>requestDelete({id:task.id,kind:'internship',title:task.title});
  const handleDeleteHabit=(id:string)=>{const habit=habits.find(h=>h.id===id);if(habit)requestDelete({id,kind:'habit',title:habit.name});};
  const handleDeleteBlock=(id:string)=>{const block=blocks.find(b=>b.id===id);if(block)requestDelete({id,kind:'commitment',title:block.title});};
  const toggleBlockDay=(day:number)=>setBlockDays(current=>current.includes(day)?current.filter(d=>d!==day):[...current,day].sort());
  const openNewTaskAt=(time:string)=>{openNewTask(selectedDate);setDueTime(time);setEndTime(minutesToTime(Math.min(1439,timeToMinutes(time)+30)));};
  const placeTaskAt=async(taskId:string,time:string)=>{
    const task=tasks.find(t=>t.id===taskId);if(!task||task.completed||task.listKind==='someday')return;
    const start=timeToMinutes(time),finish=start+(task.durationMinutes||30);
    const blocked=activeBlocks.some(x=>start<timeToMinutes(x.endTime)&&finish>timeToMinutes(x.startTime));
    const occupied=todaysTasks.some(x=>!x.completed&&x.id!==taskId&&!!x.dueTime&&start<timeToMinutes(x.dueTime)+(x.durationMinutes||60)&&finish>timeToMinutes(x.dueTime));
    if(finish>1440){setSmartMessage('This task would finish after midnight. Choose an earlier time.');setDragTaskId('');return;}
    if(blocked||occupied){setSmartMessage('That slot overlaps another commitment. Choose another hour.');setDragTaskId('');return;}
    try{await updatePlannerTask(taskId,{scheduledDate:selectedDate,dueTime:time,durationMinutes:task.durationMinutes||30});setSmartMessage('Task placed on your timetable.');}
    catch(error){console.error(error);setSmartMessage('Could not move this task. Please try again.');}
    setDragTaskId('');
  };
  const scheduleTasks=async()=>{
    if(!user||scheduling)return;
    const pending=tasks.filter(t=>t.listKind!=='someday'&&!t.completed&&!t.dueTime&&(!t.scheduledDate)&&(!t.dueDate||t.dueDate>=selectedDate)).sort((x,y)=>priorityRank(x.priority)-priorityRank(y.priority)||x.createdAt.localeCompare(y.createdAt));
    if(!pending.length){setSmartMessage('No unscheduled tasks for this date. Add a task without a start time first.');return;}
    const dayStart=timeToMinutes(scheduleStart);
    const dayEnd=timeToMinutes(scheduleEnd);
    if(dayEnd<=dayStart){setSmartMessage('Your scheduling end time must be later than the start time.');return;}
    const occupied=[
      ...activeBlocks.map(x=>({start:timeToMinutes(x.startTime),end:timeToMinutes(x.endTime)})),
      ...todaysTasks.filter(t=>!t.completed&&!!t.dueTime).map(t=>({start:timeToMinutes(t.dueTime!),end:timeToMinutes(t.dueTime!)+(t.durationMinutes||60)}))
    ].sort((a,b)=>a.start-b.start);
    const planned:{task:Task;start:number}[]=[];
    for(const task of pending){
      const duration=task.durationMinutes||30;
      let candidate=dayStart;
      const busy=[...occupied,...planned.map(p=>({start:p.start,end:p.start+(p.task.durationMinutes||60)}))].sort((a,b)=>a.start-b.start);
      for(const slot of busy){
        if(candidate+duration<=slot.start)break;
        if(candidate<slot.end&&candidate+duration>slot.start)candidate=slot.end;
      }
      if(candidate+duration<=dayEnd)planned.push({task,start:candidate});
    }
    if(!planned.length){setSmartMessage('No free time available between '+displayTime(scheduleStart)+' and '+displayTime(scheduleEnd)+'.');return;}
    setScheduling(true);setSmartMessage('');
    try{
      for(const item of planned)await updatePlannerTask(item.task.id,{scheduledDate:selectedDate,dueTime:minutesToTime(item.start),durationMinutes:item.task.durationMinutes||30});
      const remaining=pending.length-planned.length;
      setSmartMessage(planned.length+' task(s) scheduled'+(remaining?'. '+remaining+' task(s) did not fit in your available time.':' successfully.'));
    }catch(error){console.error(error);setSmartMessage('Some tasks could not be saved. Please check your connection and try again.');}
    finally{setScheduling(false);}
  };
  const scheduledTasks=useMemo(()=>todaysTasks.filter(t=>!t.completed&&!!t.dueTime),[todaysTasks]);
  const overdueTasks=useMemo(()=>tab==='schedule'?tasks.filter(t=>isTaskOverdue(t,selectedDate,clockNow)).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||'')||(a.dueTime||'').localeCompare(b.dueTime||'')):[],[tasks,selectedDate,clockNow,tab]);
  const overdueTaskIds=useMemo(()=>new Set(overdueTasks.map(t=>t.id)),[overdueTasks]);
  const unscheduledTasks=useMemo(()=>tab==='schedule'?tasks.filter(t=>t.listKind!=='someday'&&!t.completed&&!t.dueTime&&!t.scheduledDate&&(!t.dueDate||t.dueDate>=selectedDate)&&!overdueTaskIds.has(t.id)):[],[tasks,selectedDate,overdueTaskIds,tab]);
  const scheduleConflicts=useMemo(()=>{if(tab!=='schedule')return [];let maxEnd=-1;return scheduledTasks.filter(task=>{const start=timeToMinutes(task.dueTime!);const conflict=start<maxEnd;maxEnd=Math.max(maxEnd,start+(task.durationMinutes||60));return conflict;});},[scheduledTasks,tab]);
  const addHabit = async (e:React.FormEvent) => {
    e.preventDefault();
    if(!user||!habitName.trim())return;
    if(habitTrackingType==='measurable'&&(!Number.isFinite(Number(habitTarget))||Number(habitTarget)<=0)){setHabitError('Enter a target greater than zero.');return;}
    setHabitError('');
    try {
      await createPlannerHabit(user.uid,habitName.trim(),{emoji:habitEmoji,goalType:habitGoalType,trackingType:habitTrackingType,targetValue:habitTrackingType==='measurable'?Number(habitTarget):0,unit:habitTrackingType==='measurable'?habitUnit:'',reminderTime:habitReminderTime||null,reminderMinutesBefore:habitReminderTime?habitReminderMinutesBefore:null,allowedSkipsPerWeek:habitAllowedSkips});
      setHabitName('');setHabitEmoji('✦');setHabitGoalType('build');setHabitTarget('');setHabitTrackingType('check');setHabitUnit('minutes');setHabitReminderTime('');setHabitReminderMinutesBefore(10);setHabitAllowedSkips(1);setHabitOpen(false);
    } catch(error) {console.error('KRAM habit save failed:',error);setHabitError('Could not save this habit. Please try again.');}
  };
  const toggleHabit = async (h:Habit) => {const existing=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate);try{await setPlannerHabitCheckin(user!.uid,h.id,selectedDate,!existing?.completed,existing?.value,{skipped:false});if(!existing?.completed){celebrate({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');const streak=habitStreak(h.id,checkins,selectedDate)+1;showMomentumToast(streak===7?'7-day streak · wonderful consistency!':streak===30?'30-day streak · incredible commitment!':streak===3?'3-day streak · keep it steady!':'Habit complete · consistency grows');}}catch(error){console.error('KRAM habit check-in failed:',error);setHabitError('Could not save your check-in. Please try again.');}};
  const skipHabit = async (h:Habit) => { if(!user)return; const existing=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate); if(existing?.completed){setHabitError('A completed habit cannot be skipped.');return;} const weekStart=mondayWeekStart(selectedDate); const used=checkins.filter(c=>c.habitId===h.id&&c.skipped&&c.date>=weekStart&&c.date<=selectedDate).length; const limit=Math.max(0,Math.min(7,h.allowedSkipsPerWeek??1)); if(existing?.skipped){try{await setPlannerHabitCheckin(user.uid,h.id,selectedDate,false,existing.value,{skipped:false});setHabitError('Skip removed.');}catch(error){console.error(error);setHabitError('Could not undo this skip. Please try again.');}return;} if(used>=limit){setHabitError('You have used all '+limit+' allowed skip'+(limit===1?'':'s')+' for this week. Your allowance resets on Monday.');return;} try{await setPlannerHabitCheckin(user.uid,h.id,selectedDate,false,existing?.value,{skipped:true,timerStartedAt:null});setHabitError('Skip used. Your streak is protected; no XP was earned.');}catch(error){console.error(error);setHabitError('Could not save this skip. Please try again.');} };
  const changeHabitSkipLimit = async (h:Habit,value:number) => { try { await updatePlannerHabit(h.id,{allowedSkipsPerWeek:value}); } catch(error) { console.error(error); setHabitError('Could not update the weekly skip allowance.'); } };
  const recordHabitValue = async (h:Habit,value:number) => {if(!user||!Number.isFinite(value)||value<0)return;try{const completed=value>=(h.targetValue||0);await setPlannerHabitCheckin(user.uid,h.id,selectedDate,completed,value,{skipped:false});if(completed){celebrate({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');showMomentumToast('Daily target reached · nicely done');}}catch(error){console.error('KRAM measurable habit update failed:',error);setHabitError('Could not save this progress. Please try again.');}};
  const startHabitTimer = async (h:Habit) => {if(!user||selectedDate!==todayKey())return;const running=checkins.find(c=>!!c.timerStartedAt&&c.date===todayKey());if(running&&running.habitId!==h.id){setHabitError('Stop the active habit timer before starting another.');return;}const entry=checkins.find(c=>c.habitId===h.id&&c.date===todayKey());try{await setPlannerHabitCheckin(user.uid,h.id,todayKey(),entry?.completed||false,entry?.value,{timerStartedAt:new Date().toISOString(),elapsedSeconds:entry?.elapsedSeconds||0,skipped:false});setHabitError('');}catch(error){console.error(error);setHabitError('Could not start the timer. Please try again.');}};
  const stopHabitTimer = async (h:Habit) => {if(!user)return;const entry=checkins.find(c=>c.habitId===h.id&&c.date===todayKey());if(!entry?.timerStartedAt)return;const seconds=Math.max(0,(entry.elapsedSeconds||0)+Math.floor((Date.now()-new Date(entry.timerStartedAt).getTime())/1000));const rawValue=h.unit==='hours'?seconds/3600:seconds/60;const value=Number(rawValue.toFixed(2));const completed=h.trackingType==='measurable'?value>=(h.targetValue||0):seconds>0;try{await setPlannerHabitCheckin(user.uid,h.id,todayKey(),completed,value,{timerStartedAt:null,elapsedSeconds:seconds,skipped:false});if(completed){celebrate({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');}setHabitError('');}catch(error){console.error(error);setHabitError('Could not save the timer. Please try again.');}};



  const personalNavItems:[Tab,string,any][]=[['today','Today',LayoutDashboard],['schedule','Planner',CalendarDays],['tasks','To-do',ListTodo],['habits','Habits',Target],['progress','Progress',TrendingUp],['settings','Settings',Settings]];
  const internshipNavItems:[Tab,string,any][]=[['internship','Overview',BriefcaseBusiness],['internship-todo','To-do',ListTodo],['internship-deadlines','Deadlines',CalendarDays],['settings','Settings',Settings]];
  const navItems=workspaceMode==='internship'?internshipNavItems:personalNavItems;
  const workToday=dateKey(clockNow);
  const workOpen=internshipTasks.filter(t=>!t.completed);
  const workOverdue=workOpen.filter(t=>!!t.dueDate&&t.dueDate<workToday);
  const workDated=workOpen.filter(t=>!!t.dueDate).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const workBase=tab==='internship-deadlines'?internshipTasks.filter(t=>!!t.dueDate):internshipTasks;
  const workVisible=useMemo(()=>workBase.filter(t=>(internshipFilter==='All'||(internshipFilter==='Open'?!t.completed:internshipFilter==='Completed'?t.completed:!t.completed&&!!t.dueDate&&t.dueDate<workToday))&&(!internshipSearch.trim()||t.title.toLowerCase().includes(internshipSearch.trim().toLowerCase())||(t.notes||'').toLowerCase().includes(internshipSearch.trim().toLowerCase()))).sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||priorityRank(a.priority)-priorityRank(b.priority)||a.title.localeCompare(b.title)),[workBase,internshipFilter,internshipSearch,workToday]);
  const visibleTasks = useMemo(()=>tab!=='tasks'?[]:tasks.filter(t=>(t.listKind||'todo')===listView)
    .filter(t=>(filter==='All'||(filter==='Open'?!t.completed:t.completed))
      && (priorityFilter==='All'||t.priority===priorityFilter)
      && (!taskQuery.trim()||t.title.toLowerCase().includes(taskQuery.trim().toLowerCase())||(t.notes||'').toLowerCase().includes(taskQuery.trim().toLowerCase())))
    .sort((a,b)=>taskSort==='Priority'?priorityRank(a.priority)-priorityRank(b.priority)||((a.dueDate||'9999').localeCompare(b.dueDate||'9999')):taskSort==='Title'?a.title.localeCompare(b.title):(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||(a.dueTime||'').localeCompare(b.dueTime||'')),[tab,tasks,listView,filter,priorityFilter,taskQuery,taskSort]);
  const upcomingDays=useMemo(()=>tab!=='upcoming'?[]:Array.from({length:14},(_,i)=>{const d=new Date(todayKey()+'T12:00:00');d.setDate(d.getDate()+i);const key=dateKey(d);return {key,label:i===0?'Today':i===1?'Tomorrow':prettyDate(key,{weekday:'long',month:'short',day:'numeric'}),items:tasks.filter(t=>t.listKind!=='someday'&&t.dueDate===key&&!t.completed).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||''))};}).filter(day=>day.items.length>0),[tab,tasks,dateKey(clockNow)]);
  const historyDay=dateKey(clockNow);
  const habitHistory90=useMemo(()=>{
    if(tab!=='progress')return [];
    const activeIds=new Set(habits.map(h=>h.id));
    const totals=new Map<string,{completed:number;skipped:number}>();
    for(const c of checkins){if(!activeIds.has(c.habitId))continue;const day=totals.get(c.date)||{completed:0,skipped:0};if(c.completed)day.completed++;if(c.skipped)day.skipped++;totals.set(c.date,day);}
    return Array.from({length:90},(_,i)=>{const d=new Date(historyDay+'T12:00:00');d.setDate(d.getDate()-(89-i));const key=dateKey(d);const {completed,skipped}=totals.get(key)||{completed:0,skipped:0};const total=habits.filter(h=>!h.createdAt||h.createdAt.slice(0,10)<=key).length;return {key,completed,skipped,total,percent:total?Math.round(completed/total*100):0};});
  },[tab,habits,checkins,historyDay]);
  const history90Completed=habitHistory90.reduce((sum,d)=>sum+d.completed,0);
  const history90Skips=habitHistory90.reduce((sum,d)=>sum+d.skipped,0);
  const history90Possible=habitHistory90.reduce((sum,d)=>sum+d.total,0);

  if(authLoading) return <div className="loading-screen"><div className="loader-mark">K</div><p>Opening your planner…</p></div>;
  if(!user) return <Auth/>;

  return <div className={'app-shell'+(workspaceMode==='internship'?' internship-mode':'')} onClickCapture={e=>{if((e.target as HTMLElement).closest('button,summary,[role=button]'))triggerKramHaptic(vibrationEnabled,'light');}}>
    <aside className="sidebar">
      <div className="brand"><img className="brand-icon" src="/kram-icon.svg" alt="KRAM"/><div><strong>{workspaceMode==='internship'?'KRAM WORK':'KRAM'}</strong><span>{workspaceMode==='internship'?'INTERNSHIP DESK':'PERSONAL PLANNER'}</span></div></div>
      <div className="workspace-label">{workspaceMode==='internship'?'WORK HUB':'PERSONAL SPACE'}</div>
      <nav>{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'nav-item active':'nav-item'} onClick={()=>{setTab(id);if(id==='internship-todo'||id==='internship-deadlines'){setInternshipFilter('Open');setInternshipSearch('');}}}><Icon size={19}/><span>{label}</span>{id==='tasks'&&<small>{tasks.filter(t=>t.listKind!=='someday'&&!t.completed).length}</small>}{id==='internship-todo'&&<small>{workOpen.length}</small>}{id==='internship-deadlines'&&workOverdue.length>0&&<small>{workOverdue.length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{(user.displayName||user.email||'U').charAt(0).toUpperCase()}</div><div className="user-details"><strong>{user.displayName||'My planner'}</strong><span>{user.email}</span></div></div></div>
    </aside>
    {momentumToast&&<div key={momentumToastKey} className="momentum-toast" role="status"><span className="momentum-toast-icon"><Check size={16}/></span><span>{momentumToast}</span><span className="momentum-toast-sparkle">✦</span></div>}
   <main className="main-area">
      <header className="topbar"><button className="mobile-brand" aria-label="Open navigation menu" aria-expanded={mobileMenu} onClick={()=>setMobileMenu(!mobileMenu)}><b>kram.</b></button><div className="breadcrumb">{workspaceMode==='internship'?'Internship desk':'My workspace'} <span>/</span> <strong>{navItems.find(n=>n[0]===tab)?.[1]}</strong></div><div className="top-actions"><details className="workspace-picker" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false;}}><summary aria-label="Switch workspace">{workspaceMode==='personal'?<LayoutDashboard size={15}/>:<BriefcaseBusiness size={15}/>}<span>{workspaceMode==='personal'?'Personal':'Internship'}</span><ChevronRight className="workspace-caret" size={13}/></summary><div className="workspace-picker-menu" role="group" aria-label="Choose workspace"><button type="button" className={workspaceMode==='personal'?'selected':''} aria-pressed={workspaceMode==='personal'} onClick={e=>{const picker=e.currentTarget.closest('details');if(picker){picker.open=false;picker.querySelector('summary')?.focus();}if(workspaceMode!=='personal'){setWorkspaceMode('personal');setTab('today');setSelectedDate(todayKey());}}}><LayoutDashboard size={16}/> Personal {workspaceMode==='personal'&&<Check size={15}/>}</button><button type="button" className={workspaceMode==='internship'?'selected':''} aria-pressed={workspaceMode==='internship'} onClick={e=>{const picker=e.currentTarget.closest('details');if(picker){picker.open=false;picker.querySelector('summary')?.focus();}if(workspaceMode!=='internship'){setWorkspaceMode('internship');setTab('internship');}}}><BriefcaseBusiness size={16}/> Internship {workspaceMode==='internship'&&<Check size={15}/>}</button></div></details><span className={syncError?"sync-label sync-error":"sync-label"}><span className="sync-dot"/>{syncError?"Sync issue":"Synced"}</span><button className="icon-button" aria-label="Reminder settings" onClick={()=>setAlertsOpen(true)} title="Reminder settings"><Bell size={18}/></button><button className="icon-button theme-button" aria-label={dark?'Switch to light theme':'Switch to dark theme'} onClick={()=>setDark(!dark)} title="Toggle theme">{dark?<Sun size={18}/>:<Moon size={18}/>}</button><button type="button" className="mobile-profile" aria-label="Open settings" onClick={()=>{setTab('settings');setMobileMenu(false);}}>{(user.displayName||user.email||'K').slice(0,1).toUpperCase()}</button></div></header>
      {syncError&&<div className="sync-error-banner" role="alert">{syncError}</div>}{mobileMenu&&<div className="mobile-menu-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setMobileMenu(false)}}><aside className="mobile-menu-drawer"><div className="mobile-menu-heading"><div><strong>KRAM</strong><span>YOUR WORKSPACE</span></div><button className="icon-button" onClick={()=>setMobileMenu(false)} aria-label="Close menu"><X size={20}/></button></div>{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'mobile-menu-item active':'mobile-menu-item'} onClick={()=>{setTab(id);setMobileMenu(false)}}><Icon size={19}/>{label}{id==='tasks'&&<small>{tasks.filter(t=>t.listKind!=='someday'&&!t.completed).length}</small>}</button>)}<div className="mobile-menu-footer"><span>Signed in as</span><strong>{user.email}</strong></div></aside></div>}
      <AnimatePresence mode="wait" initial={false}><motion.div className={'page-content kram-motion-page page-'+tab} key={workspaceMode+'-'+tab} {...pageMotion}>
        {tab==='today'&&<><section className={'gita-wisdom-card gita-compact'+(shlokaExpanded?' is-expanded':'')}><button type="button" className="gita-toggle" aria-expanded={shlokaExpanded} aria-controls="daily-shloka-content" onClick={()=>setShlokaExpanded(v=>!v)}><span className="gita-wisdom-mark" aria-hidden="true">ॐ</span><span className="gita-preview"><span className="gita-preview-title">Daily shloka <small>{dailyGitaWisdom(clockNow).reference}</small></span><span className="gita-preview-verse">{dailyGitaWisdom(clockNow).meaning}</span></span><ChevronRight size={18} className="gita-chevron"/></button><div className="gita-expand" id="daily-shloka-content" inert={!shlokaExpanded}><div className="gita-expand-inner"><p className="gita-wisdom-verse" lang="sa-Latn">{dailyGitaWisdom(clockNow).transliteration}</p><p className="gita-wisdom-meaning">“{dailyGitaWisdom(clockNow).meaning}”</p><span className="gita-wisdom-reference">{dailyGitaWisdom(clockNow).reference}</span></div></div></section><div className="page-heading"><div><h1>{selectedDate===todayKey()?'Your day.':prettyDate(selectedDate,{weekday:'long'})+'.'}</h1><p>{prettyDate(selectedDate)}</p></div><div className={'entry-streak-badge'+(entryReady&&entryStreak.loggedToday?' is-logged':'')} role="status" aria-label={entryReady?entryStreak.current+' day daily entry streak':entryLog.error?'Daily entry streak unavailable':'Daily entry streak syncing'} title={entryReady?(entryStreak.loggedToday?'Entry recorded today':'Daily entry streak · save an entry today'):'Daily entry streak'}><Flame size={21} aria-hidden="true"/><strong>{entryReady?entryStreak.current:'—'}</strong></div></div>
          <div className="date-switch"><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-1);setSelectedDate(dateKey(d));}}><ChevronLeft size={18}/></button><button className="date-current" onClick={()=>setSelectedDate(todayKey())}><CalendarDays size={16}/>{selectedDate===todayKey()?'Today':prettyDate(selectedDate,{month:'short',day:'numeric',year:'numeric'})}</button><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+1);setSelectedDate(dateKey(d));}}><ChevronRight size={18}/></button></div>
          <section className="daily-mosaic daily-counts" aria-label="Daily summary"><div className="mosaic-tile mosaic-schedule"><CalendarDays size={19}/><strong>{activeBlocks.length+todaysTasks.filter(t=>!!t.dueTime&&!t.completed).length}</strong><small>Planned today</small></div><div className="mosaic-tile mosaic-habits"><Flame size={19}/><strong>{todayCheckins}<small>/{habits.length}</small></strong><small>Habits done</small></div></section>
          
          <div className="glance-grid">
            <section className="today-agenda glance-panel"><div className="section-heading"><h2>Today's schedule</h2><span className="glance-count">{activeBlocks.length+todaysTasks.filter(t=>!!t.dueTime&&!t.completed).length}</span></div>
              {[...activeBlocks.map(b=>({id:b.id,title:b.title,time:b.startTime,kind:'Commitment'})),...todaysTasks.filter(t=>!!t.dueTime&&!t.completed).map(t=>({id:t.id,title:t.title,time:t.dueTime!,kind:'Task'}))].sort((a,b)=>a.time.localeCompare(b.time)).slice(0,5).map(item=><div className="glance-row" key={item.kind+item.id}><span className={'glance-symbol '+(item.kind==='Commitment'?'glance-lavender':'glance-peach')}>{item.kind==='Commitment'?<CalendarDays size={17}/>:<ListTodo size={17}/>}</span><span className="glance-name">{item.title}</span><time>{displayTime(item.time)}</time></div>)}
              {!activeBlocks.length&&!todaysTasks.some(t=>t.dueTime&&!t.completed)&&<div className="glance-empty"><CalendarDays size={18}/> Nothing scheduled</div>}
              {activeBlocks.length+todaysTasks.filter(t=>!!t.dueTime&&!t.completed).length>5&&<div className="glance-more">+{activeBlocks.length+todaysTasks.filter(t=>!!t.dueTime&&!t.completed).length-5} more</div>}
            </section>
            <section className="glance-panel glance-tasks"><div className="section-heading"><h2>Today's tasks</h2><span className="glance-count">{doneCount}/{todaysTasks.length}</span></div>
              {[...todaysTasks].sort((a,b)=>Number(a.completed)-Number(b.completed)).slice(0,5).map(t=><div className={'glance-row '+(t.completed?'glance-completed':'')} key={t.id}><span className="glance-symbol glance-neutral">{t.completed?<CheckCircle2 size={17}/>:<Circle size={17}/>}</span><span className="glance-name">{t.title}</span>{t.completed?<small>Done</small>:isTaskOverdue(t,selectedDate,clockNow)?<small className="glance-overdue">Overdue</small>:null}</div>)}
              {!todaysTasks.length&&<div className="glance-empty"><CheckCircle2 size={18}/> No tasks today</div>}
              {todaysTasks.length>5&&<div className="glance-more">+{todaysTasks.length-5} more</div>}
            </section>
            <section className="glance-panel glance-habits"><div className="section-heading"><h2>Habits</h2><span className="glance-count">{todayCheckins}/{habits.length}</span></div>
              {habits.slice(0,5).map(h=>{const entry=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate);return <div className="glance-row" key={h.id}><span className="glance-symbol glance-lavender">{h.emoji||'✦'}</span><span className="glance-name">{h.name}</span>{entry?.completed?<CheckCircle2 size={17} aria-label="Completed"/>:entry?.skipped?<small>Skipped</small>:h.trackingType==='measurable'?<small>{entry?.value||0}/{h.targetValue||0} {h.unit||''}</small>:<Circle size={16} aria-label="Not completed"/>}</div>})}
              {!habits.length&&<div className="glance-empty"><Target size={18}/> No habits yet</div>}
              {habits.length>5&&<div className="glance-more">+{habits.length-5} more</div>}
            </section>
          </div>
          <section className="daily-mosaic momentum-only" aria-label="Daily momentum"><div className="mosaic-progress"><div className="mosaic-label"><span>Daily momentum</span><TrendingUp size={19}/></div><strong>{completion}<small>%</small></strong><div className="mosaic-bars" aria-label="Task completion over the last seven days">{week.map((d,i)=><div key={d.key}><span className="mosaic-bar-track"><i style={{height:(d.total?Math.max(5,d.done/d.total*100):4)+'%'}} className={i===week.length-1?'current':''}/></span><small>{d.label.slice(0,1)}</small></div>)}</div><div className="mosaic-foot">{doneCount} of {todaysTasks.length} tasks done</div></div></section>
        </>}
        {tab==='schedule'&&<><div className="page-heading"><div><h1>Planner</h1></div><button className="primary-button" onClick={openBlockForm}><Plus size={18}/> Add commitment</button></div>
          <div className="schedule-date-row"><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-1);setSelectedDate(dateKey(d));setSmartMessage('');}}><ChevronLeft size={18}/></button><strong>{prettyDate(selectedDate,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</strong><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+1);setSelectedDate(dateKey(d));setSmartMessage('');}}><ChevronRight size={18}/></button><button className="text-button" onClick={()=>setSelectedDate(todayKey())}>Today</button></div>
          <div className="timetable-week-strip">{Array.from({length:7},(_,i)=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-d.getDay()+i);const key=dateKey(d);return <button key={key} className={key===selectedDate?'timetable-day selected':'timetable-day'} onClick={()=>setSelectedDate(key)}><span>{d.toLocaleDateString('en-IN',{weekday:'short'})}</span><strong>{d.getDate()}</strong></button>})}</div>
          <div className="desktop-planner-grid"><div className="desktop-planner-tools"><section className="schedule-planner-card timetable-tools"><div className="schedule-card-heading"><div><h2>Fill my free time</h2></div><div className="schedule-spark">✦</div></div><button className="primary-button smart-plan-button" onClick={scheduleTasks} disabled={scheduling}>{scheduling?'Finding free time…':'✦  Auto-schedule tasks'}</button>{smartMessage&&<p className="schedule-message" role="status">{smartMessage}</p>}</section>
          {overdueTasks.length>0&&<section className="content-section overdue-panel"><div className="section-heading"><div><h2><span className="overdue-heading-dot"/> Overdue <span className="task-count overdue-count">{overdueTasks.length}</span></h2><p>Reschedule unfinished tasks.</p></div></div><div className="task-list">{overdueTasks.map(t=><div className="task-row overdue-task-row" key={t.id}><button type="button" className={"task-check schedule-task-check"+(t.completed?" is-checked":"")} title={t.completed?"Mark incomplete":"Mark complete"} aria-label={t.completed?"Mark incomplete":"Mark complete"} aria-pressed={t.completed} onClick={()=>toggleTask(t)}><span className="schedule-checkbox-mark">{t.completed?<Check size={15}/>:null}</span></button><button className="task-main" onClick={()=>openEditTask(t)}><strong>{t.title}</strong><small><span className="overdue-label">OVERDUE</span>{t.dueDate||t.scheduledDate?prettyDate(t.dueDate||t.scheduledDate!,{month:'short',day:'numeric'}):'Past scheduled time'}{t.dueTime?' · '+displayTime(t.dueTime):''} · {t.durationMinutes||60} min</small></button><div className="task-row-actions"><button className="secondary-button" onClick={()=>{openEditTask(t);setScheduleDate(selectedDate);setDueTime('');setEndTime('');}}>Reschedule</button><button className="icon-button delete-button" title="Delete task" onClick={()=>handleDeleteTask(t.id)}><Trash2 size={16}/></button></div></div>)}</div></section>}
          <section className="content-section unscheduled-panel"><div className="section-heading"><div><h2>To-dos to schedule <span className="task-count">{unscheduledTasks.length}</span></h2></div></div>{unscheduledTasks.length===0?<div className="schedule-message">No tasks waiting for a time. Add a task without a start time, or leave its date blank, and it will appear here.</div>:<div className="task-list">{unscheduledTasks.map(t=><div className="task-row" key={t.id} draggable onDragStart={()=>setDragTaskId(t.id)} onDragEnd={()=>setDragTaskId('')}><button type="button" className={"task-check schedule-task-check"+(t.completed?" is-checked":"")} title={t.completed?"Mark incomplete":"Mark complete"} aria-label={t.completed?"Mark incomplete":"Mark complete"} aria-pressed={t.completed} onClick={()=>toggleTask(t)}><span className="schedule-checkbox-mark">{t.completed?<Check size={15}/>:null}</span></button><button className="task-main" onClick={()=>openEditTask(t)}><strong>{t.title}</strong><small><i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority} priority · {t.durationMinutes||60} min</small></button><div className="task-row-actions">{!t.completed&&<button className="secondary-button" onClick={()=>openTaskSchedule(t)}>Schedule</button>}<button className="icon-button delete-button" title="Delete task" onClick={()=>handleDeleteTask(t.id)}><Trash2 size={16}/></button></div></div>)}</div>}</section>
          </div><section className="content-section schedule-section"><div className="section-heading"><div><h2>24-hour timeline</h2></div></div><div className="timeline-legend"><span><i className="legend-class"/> Classes & commitments</span><span><i className="legend-task"/> Tasks</span><span><i className="legend-overdue"/> Overdue</span></div><div className="full-day-timeline">{Array.from({length:24},(_,hour)=>{const hourStart=hour*60;const label=hour===0?'12 AM':hour<12?hour+' AM':hour===12?'12 PM':(hour-12)+' PM';return <div className="timetable-hour" key={hour} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragTaskId)placeTaskAt(dragTaskId,minutesToTime(hourStart));}}><div className="timetable-hour-label">{label}</div><div className="timetable-hour-content"><button className="timetable-open-slot" onClick={()=>openNewTaskAt(minutesToTime(hourStart))}>＋ Add at {label}</button></div></div>})}{todaysTasks.filter(t=>!t.completed&&!!t.dueTime&&!isTaskOverdue(t,selectedDate,clockNow)).map(t=>{const start=timeToMinutes(t.dueTime!);const duration=t.durationMinutes||30;return <div className={duration<=15?"timetable-event task-event task-event-span task-event-compact":"timetable-event task-event task-event-span"} key={t.id} draggable onDragStart={()=>setDragTaskId(t.id)} onDragEnd={()=>setDragTaskId('')} style={{top:`calc(var(--hour-height) * ${start/60} + 7px)`,height:`max(30px, calc(var(--hour-height) * ${duration/60} - 4px))`}}><button className="timetable-complete" title="Mark complete" aria-label="Mark complete" onClick={()=>toggleTask(t)}><Circle size={17}/></button><button className="timetable-event-main" onClick={()=>openEditTask(t)}><span className="timeline-type-tag task-type-tag">{t.priority.toUpperCase()} PRIORITY TASK</span><strong>{t.title}</strong><span>{displayTime(t.dueTime!)} · {duration} min</span></button><div className="timetable-event-actions"><button title="Edit task" aria-label="Edit task" onClick={()=>openEditTask(t)}><Clock3 size={14}/></button><button title="Remove from schedule" aria-label="Remove from schedule" onClick={async()=>{try{await updatePlannerTask(t.id,{scheduledDate:'',dueTime:''});setSmartMessage('Task removed from the timetable and kept in your task list.');}catch(error){console.error(error);setSmartMessage('Could not remove this task from the timetable. Please try again.');}}}><CalendarDays size={15}/></button></div></div>})}{activeBlocks.map(x=>{const start=timeToMinutes(x.startTime);const duration=timeToMinutes(x.endTime)-start;return <div className="timetable-event fixed-event fixed-event-span" key={x.id} style={{top:`calc(var(--hour-height) * ${start/60} + 7px)`,height:`calc(var(--hour-height) * ${duration/60} - 14px)`}}><div><span className="timeline-type-tag class-type-tag">{x.repeat==='weekly'?'RECURRING COMMITMENT':'ONE-TIME COMMITMENT'}</span><strong>{x.title}</strong><span>{displayTime(x.startTime)}–{displayTime(x.endTime)} · {x.repeat==='weekly'?'Weekly':'One-time'}</span></div><div className="timetable-event-actions"><button title="Edit commitment" aria-label="Edit commitment" onClick={()=>openEditBlock(x)}><Clock3 size={14}/></button><button title="Delete commitment" aria-label="Delete commitment" onClick={()=>handleDeleteBlock(x.id)}><Trash2 size={15}/></button></div></div>})}</div></section></div>

        </>}
        {tab==='tasks'&&<><div className="page-heading"><div><h1>To-do list</h1></div><button className="primary-button" onClick={()=>openNewTask(selectedDate,listView)}><Plus size={18}/> {listView==='someday'?'Add idea':'Add to-do'}</button></div>
          <div className="todo-switch" role="group" aria-label="Choose a list"><button type="button" className={listView==='todo'?'selected':''} aria-pressed={listView==='todo'} onClick={()=>{setListView('todo');setFilter('Open');setTaskQuery('');setPriorityFilter('All');setQuickTaskTitle('');setListError('');}}><ListTodo size={18}/> To-do <span>{tasks.filter(t=>t.listKind!=='someday'&&!t.completed).length}</span></button><button type="button" className={listView==='someday'?'selected':''} aria-pressed={listView==='someday'} onClick={()=>{setListView('someday');setFilter('Open');setTaskQuery('');setPriorityFilter('All');setQuickTaskTitle('');setListError('');}}><Target size={18}/> Someday <span>{tasks.filter(t=>t.listKind==='someday'&&!t.completed).length}</span></button></div>
          
          <form className="quick-add-task list-quick-add" onSubmit={saveQuickTask}><Plus size={18}/><input aria-label={listView==='someday'?'Add an idea':'Add a to-do'} maxLength={120} placeholder={listView==='someday'?'What do you want to do someday?':'What do you want to do?'} value={quickTaskTitle} onChange={e=>setQuickTaskTitle(e.target.value)}/><button className="quick-add-submit" type="submit" disabled={!quickTaskTitle.trim()||quickTaskSaving}>{quickTaskSaving?'Adding…':'Add'}</button></form>
          {quickTaskError&&<p className="quick-add-error" role="alert">{quickTaskError}</p>}
          <div className="task-tools"><label className="task-search"><Search size={17}/><input aria-label="Search list" placeholder={listView==='someday'?'Search ideas…':'Search to-dos…'} value={taskQuery} onChange={e=>setTaskQuery(e.target.value)}/>{taskQuery&&<button type="button" onClick={()=>setTaskQuery('')} aria-label="Clear search"><X size={15}/></button>}</label><label className="task-tool-select"><span>Priority</span><select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value as 'All'|'High'|'Medium'|'Low')}><option>All</option><option>High</option><option>Medium</option><option>Low</option></select></label><label className="task-tool-select"><span>Sort</span><select value={taskSort} onChange={e=>setTaskSort(e.target.value as 'Date'|'Priority'|'Title')}><option>Date</option><option>Priority</option><option>Title</option></select></label></div>
          <div className="filter-row">{(['Open','Completed','All'] as const).map(f=><button type="button" key={f} className={filter===f?'filter-pill selected':'filter-pill'} onClick={()=>setFilter(f)}>{f}</button>)}</div>
          {listError&&<p className="quick-add-error" role="alert">{listError}</p>}
          <AnimatePresence mode="wait" initial={false}><motion.div key={listView} {...pageMotion}><TaskList tasks={visibleTasks} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} showDate={listView==='todo'} emptyAction={()=>openNewTask(selectedDate,listView)} someday={listView==='someday'} onSchedule={listView==='todo'?openTaskSchedule:undefined} onPromote={listView==='someday'?moveToTodo:undefined} movingId={movingTaskId}/></motion.div></AnimatePresence></>}
        {tab==='internship'&&<><div className="page-heading"><div><h1>Internship desk</h1></div><button className="primary-button" onClick={()=>openInternshipForm()}><Plus size={18}/> Add work</button></div>
          <section className="internship-summary"><div><span>Open work</span><strong>{workOpen.length}</strong></div><div><span>Overdue</span><strong>{workOverdue.length}</strong></div><div><span>Completed</span><strong>{internshipTasks.length-workOpen.length}</strong></div></section>
          {internshipError&&!internshipFormOpen&&<p className="quick-add-error" role="alert">{internshipError}</p>}
          <div className="work-overview-grid"><section className="glance-panel work-glance"><div className="section-heading"><h2>Next deadlines</h2><span className="glance-count">{workDated.length}</span></div>{workDated.slice(0,5).map(t=><div className="glance-row" key={t.id}><span className="glance-symbol glance-peach"><CalendarDays size={17}/></span><span className="glance-name">{t.title}</span><small className={t.dueDate<workToday?'glance-overdue':''}>{t.dueDate<workToday?'Overdue · ':''}{prettyDate(t.dueDate,{month:'short',day:'numeric'})}</small></div>)}{!workDated.length&&<div className="glance-empty"><CalendarDays size={18}/> No upcoming deadlines</div>}{workDated.length>5&&<div className="glance-more">+{workDated.length-5} more</div>}</section>
          <section className="glance-panel work-glance"><div className="section-heading"><h2>To-do</h2><span className="glance-count">{workOpen.length}</span></div>{[...workOpen].sort((a,b)=>priorityRank(a.priority)-priorityRank(b.priority)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,5).map(t=><div className="glance-row" key={t.id}><span className="glance-symbol glance-neutral"><Circle size={16}/></span><span className="glance-name">{t.title}</span><small>{t.priority}</small></div>)}{!workOpen.length&&<div className="glance-empty"><CheckCircle2 size={18}/> No open work</div>}{workOpen.length>5&&<div className="glance-more">+{workOpen.length-5} more</div>}</section></div></>}
        {(tab==='internship-todo'||tab==='internship-deadlines')&&<><div className="page-heading"><div><h1>{tab==='internship-todo'?'Work to-do':'Deadlines'}</h1></div><button className="primary-button" onClick={()=>openInternshipForm()}><Plus size={18}/> Add work</button></div>
          {tab==='internship-todo'&&<form className="quick-add-task work-quick-add" onSubmit={saveQuickWork}><Plus size={18}/><input aria-label="Quick add internship task" maxLength={120} placeholder="What do you need to work on?" value={workQuickTitle} onChange={e=>setWorkQuickTitle(e.target.value)}/><button className="quick-add-submit" type="submit" disabled={!workQuickTitle.trim()||workQuickBusy}>{workQuickBusy?'Adding…':'Add'}</button></form>}
          <div className="work-list-tools"><label className="task-search internship-search"><Search size={17}/><input aria-label="Search internship work" placeholder="Search work…" value={internshipSearch} onChange={e=>setInternshipSearch(e.target.value)}/>{internshipSearch&&<button type="button" onClick={()=>setInternshipSearch('')} aria-label="Clear search"><X size={15}/></button>}</label><div className="filter-row">{(['Open','Overdue','Completed','All'] as const).map(f=><button key={f} className={internshipFilter===f?'filter-pill selected':'filter-pill'} onClick={()=>setInternshipFilter(f)}>{f}<span>{workBase.filter(t=>f==='All'||(f==='Open'?!t.completed:f==='Completed'?t.completed:!t.completed&&!!t.dueDate&&t.dueDate<workToday)).length}</span></button>)}</div></div>{internshipError&&!internshipFormOpen&&<p className="quick-add-error" role="alert">{internshipError}</p>}
          <div className="internship-work-list">{workVisible.map(task=><article className={'internship-work-card'+(task.completed?' completed':'')} key={task.id}><button className="task-check" type="button" aria-label={task.completed?'Mark incomplete':'Mark complete'} onClick={()=>toggleInternshipTask(task)}>{task.completed?<Check size={15}/>:<Circle size={19}/>}</button><button className="internship-work-main" type="button" onClick={()=>openInternshipForm(task)}><strong>{task.title}</strong>{task.notes&&<span>{task.notes}</span>}<small>{task.dueDate?<><CalendarDays size={13}/>{prettyDate(task.dueDate,{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</>:<><CalendarDays size={13}/>No deadline set</>}{!task.completed&&!!task.dueDate&&task.dueDate<todayKey()&&<em>OVERDUE</em>}<i className={'priority-dot '+task.priority.toLowerCase()}/>{task.priority} priority</small></button><button type="button" className="icon-button delete-button" aria-label="Delete internship work" onClick={()=>removeInternshipTask(task)}><Trash2 size={16}/></button></article>)}}{!workVisible.length&&<div className="empty-state"><div className="empty-icon"><BriefcaseBusiness size={23}/></div><strong>{tab==='internship-deadlines'?'No matching deadlines':'No matching work'}</strong><button className="secondary-button" onClick={()=>openInternshipForm()}><Plus size={16}/> Add work</button></div>}</div></>}
        {tab==='upcoming'&&<><div className="page-heading"><div><h1>Upcoming</h1><p>Next 14 days</p></div><button className="primary-button" onClick={()=>openNewTask(todayKey())}><Plus size={18}/> Add task</button></div>{upcomingDays.length===0?<div className="empty-state"><div className="empty-icon"><CalendarRange size={23}/></div><strong>Nothing coming up</strong><button className="secondary-button" onClick={()=>openNewTask(todayKey())}><Plus size={16}/> Add a task</button></div>:upcomingDays.map(day=><section className="content-section" key={day.key}><div className="section-heading"><div><h2>{day.label}</h2><p>{day.items.length} task{day.items.length===1?'':'s'} planned</p></div></div><TaskList tasks={day.items} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} showDate emptyAction={()=>openNewTask(day.key)}/></section>)}</>}
        {tab==='habits'&&<><div className="page-heading"><div><h1>Your habits</h1></div><button className="primary-button" onClick={()=>{setHabitReminderTime('');setHabitReminderMinutesBefore(10);setHabitStep(1);setHabitOpen(true);}}><Plus size={18}/> Add habit</button></div><div className="habit-date-note"><CalendarDays size={17}/> Check in for <strong>{prettyDate(selectedDate)}</strong><button className="text-button" onClick={()=>setSelectedDate(todayKey())}>Go to today</button></div><div className="timetable-week-strip habit-week-strip">{Array.from({length:7},(_,i)=>{const d=new Date(mondayWeekStart(selectedDate)+"T12:00:00");d.setDate(d.getDate()+i);const key=dateKey(d);return <button type="button" key={key} className={key===selectedDate?"timetable-day selected":"timetable-day"} onClick={()=>setSelectedDate(key)}><span>{d.toLocaleDateString("en-IN",{weekday:"short"})}</span><strong>{d.getDate()}</strong></button>})}</div>{habitError&&<div className="habit-error-banner" role="alert">{habitError}</div>}<HabitList habits={habits} checkins={checkins} date={selectedDate} now={clockNow} onToggle={toggleHabit} onSkip={skipHabit} onSkipLimitChange={changeHabitSkipLimit} onRecord={recordHabitValue} onTimerStart={startHabitTimer} onTimerStop={stopHabitTimer} onDelete={handleDeleteHabit}/></>}
        {tab==='progress'&&<><div className="page-heading"><div><h1>Your progress</h1></div></div><section className="overview-grid progress-overview"><div className="overview-card"><div className="card-topline"><span>TOTAL TASKS DONE</span><CheckCircle2 size={17}/></div><strong className="stat-number">{tasks.filter(t=>t.listKind!=='someday'&&t.completed).length}</strong></div><div className="overview-card"><div className="card-topline"><span>ACTIVE HABITS</span><Target size={17}/></div><strong className="stat-number">{habits.length}</strong></div><div className="overview-card"><div className="card-topline"><span>HABIT CHECK-INS</span><Flame size={17}/></div><strong className="stat-number">{checkins.filter(c=>c.completed).length}</strong></div></section><section className="content-section entry-streak-progress"><div className="section-heading"><h2>Daily entry streak</h2></div><div className="entry-streak-totals"><div><span>Current streak</span><strong>{entryReady?entryStreak.current:'—'} <small>days</small></strong></div><div><span>Longest streak</span><strong>{entryReady?entryStreak.best:'—'} <small>days</small></strong></div></div><div className="entry-streak-history"><section className="entry-streak-card" aria-label="Daily entry streak"><div className="entry-streak-main"><span className="entry-streak-icon"><Flame size={21}/></span><div><span className="entry-streak-label">Daily entry streak</span><strong>{entryReady?entryStreak.current:'—'} <small>{entryStreak.current===1?'day':'days'}</small></strong></div></div><div className="entry-streak-meta"><div className="entry-streak-days" aria-label="Last seven days">{entryStreak.recent.map(d=><span className={'entry-day'+(d.logged&&entryReady?' logged':'')+(d.key===entryToday?' current':'')} key={d.key} title={d.label+(d.logged&&entryReady?' · Entry recorded':' · No entry')}><span>{d.logged&&entryReady?<Check size={13}/>:<span className="entry-day-dot"/>}</span><small>{d.label.slice(0,1)}</small></span>)}</div><small className="entry-streak-status">{entryLog.error&&entryLog.uid===user?.uid?'Streak sync unavailable':!entryReady?'Syncing…':entryStreak.loggedToday?'Entry recorded today':'Add or update an entry today'}</small></div></section></div><p className="entry-streak-explanation">One day counts when you save or update a task, habit, commitment or internship entry. Missing a full day resets the current streak.</p></section><section className="content-section"><div className="section-heading"><div><h2>Habit rewards</h2></div></div><div className="overview-grid progress-overview"><div className="overview-card"><span className="habit-summary-label">TOTAL XP</span><strong className="stat-number">{checkins.filter(c=>c.completed).reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0)}</strong><p className="stat-caption">10 XP for check-ins · 15 XP for measurable targets.</p></div><div className="overview-card"><span className="habit-summary-label">CURRENT STREAK</span><strong className="stat-number">{(()=>{let n=0;const d=new Date();const today=dateKey(d);const completedDays=new Set(checkins.filter(c=>c.completed).map(c=>c.date));if(!completedDays.has(today)){d.setDate(d.getDate()-1);}while(completedDays.has(dateKey(d))){n++;d.setDate(d.getDate()-1);}return n;})()}</strong><p className="stat-caption">Days in a row with a check-in</p></div><div className="overview-card"><span className="habit-summary-label">LEVEL</span><strong className="stat-number">{Math.floor(checkins.filter(c=>c.completed).reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0)/100)+1}</strong><p className="stat-caption">100 XP per level</p></div></div><div className="habit-list"><div className="habit-row"><div className="habit-emoji">🏅</div><div className="habit-info"><strong>First win</strong><span>{checkins.some(c=>c.completed)?'Unlocked':'Complete one habit'}</span></div></div><div className="habit-row"><div className="habit-emoji">🔥</div><div className="habit-info"><strong>7 active days</strong><span>{(()=>{const days=new Set(checkins.filter(c=>c.completed).map(c=>c.date));return [...days].length>=7?'Unlocked':'Complete habits on 7 days';})()}</span></div></div><div className="habit-row"><div className="habit-emoji">⭐</div><div className="habit-info"><strong>500 XP milestone</strong><span>{checkins.filter(c=>c.completed).reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0)>=500?'Unlocked':'Reach 500 XP'}</span></div></div></div></section><section className="content-section chart-section"><div className="section-heading"><div><h2>Last 7 days</h2><p>Tasks completed each day.</p></div></div><div className="weekly-chart">{week.map(d=><div className="chart-column" key={d.key}><div className="chart-value">{d.done}/{d.total}</div><div className="chart-bar-area"><div className="chart-bar" style={{height:(d.total?Math.max(6,d.done/d.total*100):0)+'%'}}/></div><span>{d.label}</span></div>)}</div></section><section className="content-section chart-section"><div className="section-heading"><div><h2>Habit history · Last 90 days</h2></div></div><div className="overview-grid progress-overview"><div className="overview-card"><span className="habit-summary-label">COMPLETION RATE</span><strong className="stat-number">{history90Possible?Math.round(history90Completed/history90Possible*100):0}%</strong><p className="stat-caption">{history90Completed} completed out of {history90Possible} habit-days.</p></div><div className="overview-card"><span className="habit-summary-label">SKIPS USED</span><strong className="stat-number">{history90Skips}</strong><p className="stat-caption">Skips protect streaks but do not earn XP.</p></div></div><div style={{display:'grid',gridTemplateColumns:'repeat(15,minmax(0,1fr))',gap:5,marginTop:16}}>{habitHistory90.map(day=><div key={day.key} title={day.key+': '+day.completed+' completed, '+day.skipped+' skipped, '+Math.max(0,day.total-day.completed-day.skipped)+' missed'} style={{aspectRatio:'1',minWidth:0,borderRadius:4,background:day.total===0?'var(--surface-muted, #e8e8e8)':day.skipped>0&&day.completed===0?'#d6ad55':day.percent>=100?'#397c59':day.percent>=50?'#83b997':day.percent>0?'#c3dfcb':'var(--surface-muted, #e8e8e8)'}} aria-label={day.key+' habit progress'} />)}</div><div style={{display:'flex',gap:14,flexWrap:'wrap',fontSize:12,marginTop:12,color:'var(--text-muted, #777)'}}><span>■ Completed</span><span style={{color:'#d6ad55'}}>■ Skip used</span><span>■ No completion</span></div></section></>}
        {tab==='settings'&&<><div className="page-heading"><div><h1>Settings</h1></div></div><section className="content-section settings-section"><div className="section-heading"><div><h2>Appearance</h2></div></div><div className="settings-list"><div className="settings-row"><div className="settings-icon"><Palette size={19}/></div><div className="settings-copy"><strong>Theme</strong><span>{dark?'Dark appearance':'Light appearance'}</span></div><button type="button" className="secondary-button" onClick={()=>setDark(!dark)}>{dark?<Sun size={16}/>:<Moon size={16}/>} Switch to {dark?'light':'dark'}</button></div></div></section><section className="content-section settings-section"><div className="section-heading"><div><h2>Privacy & lock</h2></div></div><div className="settings-list"><div className="settings-row"><div className="settings-icon"><ShieldCheck size={19}/></div><div className="settings-copy"><strong>{blockLockHash?'Four-block lock is on':'Four-block app lock'}</strong><span>{blockLockHash?'Lock on reopen':'Choose a tap sequence'}</span></div><button type="button" className="secondary-button" onClick={startBlockLockSetup}>{blockLockHash?'Change lock':'Set up lock'}</button></div></div></section><section className="content-section settings-section"><div className="section-heading"><div><h2>Notifications & updates</h2></div></div><div className="settings-list"><button type="button" className="settings-row settings-action" onClick={()=>{setWhatsNewOpen(true);}}><div className="settings-icon"><TrendingUp size={19}/></div><div className="settings-copy"><strong>What’s new</strong></div><ChevronRight size={18}/></button><button type="button" className="settings-row settings-action" onClick={()=>setAlertsOpen(true)}><div className="settings-icon"><BellRing size={19}/></div><div className="settings-copy"><strong>Reminder settings</strong><span>{notificationsEnabled?'Notifications enabled':'Notifications not enabled'} · Sound and vibration</span></div><ChevronRight size={18}/></button><button type="button" className="settings-row settings-action" onClick={()=>setAlertsOpen(true)}><div className="settings-icon"><Smartphone size={19}/></div><div className="settings-copy"><strong>App updates</strong><span>Check for and install the latest KRAM version</span></div><ChevronRight size={18}/></button></div></section><section className="content-section settings-section"><div className="section-heading"><div><h2>Account</h2></div></div><div className="settings-list"><div className="settings-row"><div className="settings-icon"><ShieldCheck size={19}/></div><div className="settings-copy"><strong>{user.displayName||'My planner'}</strong><span>{user.email}</span></div><button type="button" className="secondary-button sign-out-button" onClick={()=>{if(window.confirm('Sign out of KRAM? Your synced planner data will remain in your account.'))void signOut(auth);}}>Sign out</button></div></div></section></>}
      </motion.div></AnimatePresence>
    </main>
     {(blockLockSetup||isLocked)&&<div className="block-lock-screen"><div className="block-lock-glow"/><div className="block-lock-panel"><div className="block-lock-mark"><img src="/kram-icon.svg" alt="KRAM"/></div><h2>{blockLockSetup?(blockLockStage==='create'?'Create your block lock':'Confirm your block lock'):'KRAM is locked'}</h2><p>{blockLockSetup?(blockLockStage==='create'?'Tap any sequence. Repeats allowed.':'Repeat your sequence.'):'Enter your sequence.'}</p><div className="block-lock-grid" role="group" aria-label="Four block password">{[0,1,2,3].map(index=><button key={index} type="button" aria-label={['Top left block','Top right block','Bottom left block','Bottom right block'][index]} className={((blockLockSetup?blockLockSequence:unlockSequence).includes(index)?'selected':'')} onClick={()=>tapLockBlock(index,blockLockSetup?'setup':'unlock')}/>)}</div><div className="block-lock-dots" aria-label={(blockLockSetup?blockLockSequence:unlockSequence).length+' taps entered'}>{Array.from({length:Math.max(4,(blockLockSetup?blockLockSequence:unlockSequence).length)},(_,i)=><span key={i} className={i<(blockLockSetup?blockLockSequence:unlockSequence).length?'filled':''}/>)}</div>{blockLockError&&<p className="block-lock-error" role="alert">{blockLockError}</p>}<div className="block-lock-actions"><button type="button" className="secondary-button" onClick={()=>{if(blockLockSetup){if(blockLockStage==='confirm'){setBlockLockStage('create');setBlockLockFirst([]);}setBlockLockSequence([]);setBlockLockError('');}else{setUnlockSequence([]);setBlockLockError('');}}}>Clear</button><button type="button" className="primary-button" onClick={()=>void finishBlockLockEntry()}>{blockLockSetup?(blockLockStage==='create'?'Continue':'Save lock'):'Unlock'}</button></div>{blockLockSetup&&<button type="button" className="text-button block-lock-cancel" onClick={()=>setBlockLockSetup(false)}>Cancel</button>}</div></div>}
    <AnimatePresence>{alertsOpen&&<motion.div key="alertsOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)setAlertsOpen(false)}}><motion.section {...sheetMotion} className="modal-card kram-motion-sheet"><div className="modal-heading"><div><h2>Notification settings</h2></div><button type="button" className="icon-button" aria-label="Close notification settings" onClick={()=>setAlertsOpen(false)}><X size={19}/></button></div><p className="alert-settings-copy">Enable reminders for your tasks and habits.</p><button type="button" className="primary-button alert-enable" onClick={async()=>{let enabled=false;if(Capacitor.isNativePlatform()){const permission=await LocalNotifications.requestPermissions();enabled=permission.display==='granted';if(enabled){const exact=await LocalNotifications.checkExactNotificationSetting();if(exact.exact_alarm!=='granted'){const updated=await LocalNotifications.changeExactNotificationSetting();if(updated.exact_alarm!=='granted')setSmartMessage('Please allow KRAM under Android Settings → Alarms & reminders so reminders can run on time.');}}}else{if(!('Notification' in window)){setSmartMessage('This browser does not support notifications.');return;}enabled=(await Notification.requestPermission())==='granted';}setNotificationsEnabled(enabled);localStorage.setItem('KRAM-notifications',enabled?'on':'off');setSmartMessage(enabled?'Notifications enabled.':'Notification permission was not granted.');}}>{notificationsEnabled?'✓ ':''}{Capacitor.isNativePlatform()?'Enable Android notifications':'Enable browser notifications'}</button>{notificationsEnabled&&<button type="button" className="secondary-button alert-enable" onClick={sendTestNotification}>Send test notification</button>}<p className="alert-settings-note" role="status">{smartMessage}</p><label className="alert-toggle"><span><strong>Alert sound</strong><small>Reminder sound</small></span><input type="checkbox" checked={soundEnabled} onChange={e=>{setSoundEnabled(e.target.checked);localStorage.setItem('KRAM-sound',e.target.checked?'on':'off');}}/></label><label className="alert-toggle"><span><strong>Touch haptics & reminders</strong><small>Tap and reminder vibration</small></span><input type="checkbox" checked={vibrationEnabled} onChange={e=>{setVibrationEnabled(e.target.checked);localStorage.setItem('KRAM-vibration',e.target.checked?'on':'off');}}/></label><p className="alert-settings-note">Android: allow notifications in Settings. Browser reminders may pause when closed.</p>{Capacitor.getPlatform()==='android'&&<section className="app-update-panel"><div><strong>App updates</strong><p>{updateAvailable?'KRAM '+updateAvailable.version+' is ready to install.':'Check whether a newer version of KRAM is available.'}</p></div>{updateAvailable?<button type="button" className="primary-button" onClick={downloadAndInstallKramUpdate} disabled={updateBusy}>{updateBusy?(updateProgress>0&&updateProgress<100?'Downloading '+updateProgress+'%…':'Preparing update…'):downloadedUpdatePath?'Install update':'Download & install'}</button>:<button type="button" className="secondary-button" onClick={checkForKramUpdate} disabled={updateChecking}>{updateChecking?'Checking…':'Check for updates'}</button>}{updateMessage&&<p className="app-update-message" role="status">{updateMessage}</p>}{updateAvailable&&<button type="button" className="text-button" onClick={checkForKramUpdate} disabled={updateChecking}>Check again</button>}</section>}<div className="modal-actions"><button type="button" className="primary-button" onClick={()=>setAlertsOpen(false)}>Done</button></div></motion.section></motion.div>}</AnimatePresence>
    <AnimatePresence>{taskOpen&&<motion.div key="taskOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)setTaskOpen(false)}}><motion.form {...sheetMotion} className="modal-card kram-motion-sheet task-form-card entry-sheet" onSubmit={e=>{if(taskListKind==='someday')void saveTask(e);else if(taskStep===1){e.preventDefault();if(title.trim()){setTaskError('');setTaskStep(2);}else setTaskError('Enter a to-do name.');}else void saveTask(e);}}><div className="modal-heading"><div><h2>{editing?'Edit entry':'New entry'}</h2></div><button type="button" className="icon-button" aria-label="Close task form" onClick={()=>setTaskOpen(false)}><X size={19}/></button></div>{taskListKind!=='someday'&&<div className="sheet-steps" aria-label={'Step '+taskStep+' of 2'}><span className={taskStep===1?'current':'done'}/><span className={taskStep===2?'current':''}/><small>{taskStep} / 2</small></div>}<div className="sheet-step-content" hidden={taskStep!==1}><div className={'entry-hero '+(taskListKind==='someday'?'entry-hero-someday':'')}><span className="entry-hero-icon">{taskListKind==='someday'?<Target size={21}/>:<ListTodo size={21}/>}</span><label className="entry-title-label"><span>{taskListKind==='someday'?'Someday':'To-do'}</span><input aria-label={taskListKind==='someday'?'Idea':'To-do name'} required={taskStep===1} maxLength={120} placeholder={taskListKind==='someday'?'What do you want to do someday?':'What do you want to do?'} value={title} onChange={e=>setTitle(e.target.value)}/></label></div>{!editing&&!scheduleRequired&&!dueTime&&tab!=='schedule'&&<div className="entry-segments" role="group" aria-label="Entry type"><button type="button" className={taskListKind==='todo'?'selected':''} aria-pressed={taskListKind==='todo'} onClick={()=>setTaskListKind('todo')}>To-do</button><button type="button" className={taskListKind==='someday'?'selected':''} aria-pressed={taskListKind==='someday'} onClick={()=>setTaskListKind('someday')}>Someday</button></div>}<details className="entry-note" open={notes?true:undefined}><summary>Add note</summary><textarea aria-label="Notes" rows={2} placeholder="Notes" value={notes} onChange={e=>setNotes(e.target.value)}/></details></div><div className="sheet-step-content" hidden={taskStep!==2}><div className="entry-hero entry-hero-summary"><span className="entry-hero-icon"><ListTodo size={19}/></span><div><small>To-do</small><strong>{title}</strong></div></div><div className="entry-date-chips" role="group" aria-label="Plan date"><button type="button" className={scheduleDate===todayKey()?'selected':''} onClick={()=>setScheduleDate(todayKey())}>Today</button><button type="button" className={scheduleDate===dateKey(new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()+1))?'selected':''} onClick={()=>{const d=new Date();d.setDate(d.getDate()+1);setScheduleDate(dateKey(d));}}>Tomorrow</button></div><label>Date <input type="date" value={scheduleDate} onChange={e=>setScheduleDate(e.target.value)}/></label><div className="form-two"><label>Start<input type="time" value={dueTime} onChange={e=>{setDueTime(e.target.value);if(e.target.value&&!scheduleDate)setScheduleDate(selectedDate);if(!e.target.value)setEndTime('');else if(!endTime||timeToMinutes(endTime)<=timeToMinutes(e.target.value))setEndTime(minutesToTime(Math.min(1439,timeToMinutes(e.target.value)+30)));}}/></label><label>End<input type="time" value={endTime} min={taskStep===2?dueTime||undefined:undefined} disabled={!dueTime} required={taskStep===2&&!!dueTime} onChange={e=>setEndTime(e.target.value)}/></label></div><details className="entry-note entry-options" open={taskError||dueDate||repeat!=='none'||priority!=='Medium'||reminderMinutesBefore>=0?true:undefined}><summary>More options</summary><div className="entry-options-fields"><label>Deadline <span className="optional">Optional</span><input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label><label>Reminder<select value={reminderMinutesBefore} onChange={e=>setReminderMinutesBefore(Number(e.target.value))}><option value={-1}>No reminder</option><option value={0}>At task time</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option></select>{!dueTime&&reminderMinutesBefore!==-1&&<span className="optional">Set a start time above for this reminder to work.</span>}</label><label>Priority<select value={priority} onChange={e=>setPriority(e.target.value as 'High'|'Medium'|'Low')}><option>Low</option><option>Medium</option><option>High</option></select></label><label>Repeat<select value={repeat} onChange={e=>setRepeat(e.target.value as NonNullable<Task['repeat']>)}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option><option value="weekly">Every week</option></select></label></div></details></div>{taskError&&<div className="auth-error" role="alert">{taskError}</div>}<div className="modal-actions entry-actions">{taskStep===2&&<button type="button" className="secondary-button" onClick={()=>{setTaskStep(1);setTaskError('');}} disabled={savingTask}>Back</button>}{taskListKind==='todo'&&taskStep===1&&!editing&&!dueTime&&!scheduleRequired&&tab!=='schedule'&&<button type="button" className="secondary-button" disabled={savingTask} onClick={e=>void saveTask(e)}>Save to list</button>}<button className="primary-button" type="submit" disabled={savingTask}>{savingTask?'Saving…':taskListKind==='someday'?(editing?'Save changes':'Save idea'):taskStep===1?'Continue':scheduleRequired?'Save schedule':editing?'Save changes':'Add to-do'}</button></div></motion.form></motion.div>}</AnimatePresence>
    <AnimatePresence>{internshipFormOpen&&<motion.div key="internshipFormOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)setInternshipFormOpen(false)}}><motion.form {...sheetMotion} className="modal-card kram-motion-sheet internship-form-card entry-sheet" onSubmit={e=>{if(workStep===1){e.preventDefault();if(internshipTitle.trim()){setInternshipError('');setWorkStep(2);}else setInternshipError('Enter a name for your work.');}else void saveInternshipTask(e);}}><div className="modal-heading"><div><h2>{internshipEditing?'Edit work':'Add internship work'}</h2></div><button type="button" className="icon-button" aria-label="Close form" onClick={()=>setInternshipFormOpen(false)}><X size={19}/></button></div><div className="sheet-steps" aria-label={'Step '+workStep+' of 2'}><span className={workStep===1?'current':'done'}/><span className={workStep===2?'current':''}/><small>{workStep} / 2</small></div><div className="sheet-step-content" hidden={workStep!==1}><div className="entry-hero entry-hero-work"><span className="entry-hero-icon"><BriefcaseBusiness size={21}/></span><label className="entry-title-label"><span>Work</span><input aria-label="Work name" required={workStep===1} maxLength={120} placeholder="What are you working on?" value={internshipTitle} onChange={e=>setInternshipTitle(e.target.value)}/></label></div><details className="entry-note" open={internshipNotes?true:undefined}><summary>Add note</summary><textarea aria-label="Work details" rows={2} placeholder="Notes" value={internshipNotes} onChange={e=>setInternshipNotes(e.target.value)}/></details></div><div className="sheet-step-content" hidden={workStep!==2}><div className="entry-hero entry-hero-summary entry-hero-work"><span className="entry-hero-icon"><BriefcaseBusiness size={19}/></span><div><small>Internship</small><strong>{internshipTitle}</strong></div></div><div className="form-two"><label>Deadline<input type="date" value={internshipDeadline} onChange={e=>setInternshipDeadline(e.target.value)}/></label><label>Priority<select value={internshipPriority} onChange={e=>setInternshipPriority(e.target.value as 'High'|'Medium'|'Low')}><option>Low</option><option>Medium</option><option>High</option></select></label></div></div>{internshipError&&<p className="quick-add-error" role="alert">{internshipError}</p>}<div className="modal-actions"><button type="button" disabled={internshipSaving} className="secondary-button" onClick={()=>workStep===2?(setWorkStep(1),setInternshipError('')):setInternshipFormOpen(false)}>{workStep===2?'Back':'Cancel'}</button>{workStep===1&&!internshipEditing&&<button type="button" className="secondary-button" disabled={internshipSaving||!internshipTitle.trim()} onClick={e=>void saveInternshipTask(e)}>Save</button>}<button type="submit" disabled={internshipSaving} className="primary-button">{workStep===1?'Continue':internshipSaving?'Saving…':internshipEditing?'Save changes':'Add work'}</button></div></motion.form></motion.div>}</AnimatePresence>
    <AnimatePresence>{blockOpen&&<motion.div key="blockOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)setBlockOpen(false)}}><motion.form {...sheetMotion} className="modal-card kram-motion-sheet compact-commitment" onSubmit={saveBlock}><div className="modal-heading"><div><h2>{editingBlock?'Edit commitment':'New commitment'}</h2></div><button type="button" className="icon-button" onClick={()=>setBlockOpen(false)}><X size={19}/></button></div><label>Name<input required maxLength={100} placeholder="Name your commitment" value={blockTitle} onChange={e=>setBlockTitle(e.target.value)}/></label><div className="form-two"><label>Start<input type="time" required value={blockStart} onChange={e=>setBlockStart(e.target.value)}/></label><label>End<input type="time" required value={blockEnd} onChange={e=>setBlockEnd(e.target.value)}/></label></div><label>Repeat<select value={blockRepeat} onChange={e=>setBlockRepeat(e.target.value as 'weekly'|'once')}><option value="weekly">Every week</option><option value="once">Specific date only</option></select></label>{blockRepeat==='weekly'?<div className="block-day-picker"><span>Repeat on</span><div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=><button type="button" key={day} className={blockDays.includes(i)?'block-day active':'block-day'} onClick={()=>toggleBlockDay(i)}>{day}</button>)}</div></div>:<label>Date<input type="date" required value={blockDate} onChange={e=>setBlockDate(e.target.value)}/></label>}{blockError&&<div className="auth-error" role="alert">{blockError}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setBlockOpen(false)}>Cancel</button><button className="primary-button" type="submit">{editingBlock?'Save changes':'Save commitment'}</button></div></motion.form></motion.div>}</AnimatePresence>
    <AnimatePresence>{habitOpen&&<motion.div key="habitOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)setHabitOpen(false)}}><motion.form {...sheetMotion} className="modal-card kram-motion-sheet habit-form-card entry-sheet" onSubmit={e=>{if(habitStep===1){e.preventDefault();if(habitName.trim()){setHabitError('');setHabitStep(2);}else setHabitError('Enter a habit name.');}else void addHabit(e);}}><div className="modal-heading"><div><h2>Add a habit</h2></div><button type="button" className="icon-button" aria-label="Close add habit" onClick={()=>setHabitOpen(false)}><X size={19}/></button></div><div className="sheet-steps" aria-label={'Step '+habitStep+' of 2'}><span className={habitStep===1?'current':'done'}/><span className={habitStep===2?'current':''}/><small>{habitStep} / 2</small></div><div className="sheet-step-content" hidden={habitStep!==1}><div className="entry-hero entry-hero-habit"><span className="entry-hero-icon">{habitEmoji}</span><label className="entry-title-label"><span>{habitGoalType==='build'?'Build a routine':'Let go of a habit'}</span><input aria-label="Habit name" required={habitStep===1} maxLength={80} placeholder={habitGoalType==='build'?'What habit do you want to build?':'What habit do you want to quit?'} value={habitName} onChange={e=>setHabitName(e.target.value)}/></label></div><div className="entry-segments" role="group" aria-label="Habit goal"><button type="button" className={habitGoalType==='build'?'selected':''} aria-pressed={habitGoalType==='build'} onClick={()=>setHabitGoalType('build')}>Build</button><button type="button" className={habitGoalType==='quit'?'selected':''} aria-pressed={habitGoalType==='quit'} onClick={()=>setHabitGoalType('quit')}>Quit</button></div><div className="emoji-picker" role="group" aria-label="Choose a habit icon">{['✦','📚','💧','🏃','🧘','💪','🌱','🙏'].map(emoji=><button type="button" key={emoji} className={habitEmoji===emoji?'emoji-choice selected':'emoji-choice'} aria-pressed={habitEmoji===emoji} aria-label={'Choose '+emoji+' icon'} onClick={()=>setHabitEmoji(emoji)}>{emoji}</button>)}</div><div className="entry-segments" role="group" aria-label="Tracking type"><button type="button" className={habitTrackingType==='check'?'selected':''} aria-pressed={habitTrackingType==='check'} onClick={()=>setHabitTrackingType('check')}>Check-in</button><button type="button" className={habitTrackingType==='measurable'?'selected':''} aria-pressed={habitTrackingType==='measurable'} onClick={()=>setHabitTrackingType('measurable')}>Measurable</button></div></div><div className="sheet-step-content" hidden={habitStep!==2}><div className="entry-hero entry-hero-summary entry-hero-habit"><span className="entry-hero-icon">{habitEmoji}</span><div><small>{habitGoalType==='build'?'Build a habit':'Quit a habit'}</small><strong>{habitName}</strong></div></div>{habitTrackingType==="measurable"&&<><div className="form-section-label">Daily target</div><div className="form-two"><label>Target value<input required={habitStep===2} type="number" min={habitStep===2?"0.01":undefined} step="any" value={habitTarget} onChange={e=>setHabitTarget(e.target.value)} placeholder="e.g. 30"/></label><label>Unit<select value={habitUnit} onChange={e=>setHabitUnit(e.target.value)}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="litres">Litres</option><option value="pages">Pages</option><option value="steps">Steps</option><option value="sessions">Sessions</option><option value="reps">Reps</option></select></label></div></>}<details className="entry-note entry-options" open={habitReminderTime||habitAllowedSkips!==1?true:undefined}><summary>Reminders & skips</summary><div className="entry-options-fields"><div className="form-two"><label>Weekly skips<select value={habitAllowedSkips} onChange={e=>setHabitAllowedSkips(Number(e.target.value))}>{Array.from({length:8},(_,i)=><option key={i} value={i}>{i} {i===1?'skip':'skips'}</option>)}</select></label><label>Reminder time<input type="time" value={habitReminderTime} onChange={e=>setHabitReminderTime(e.target.value)}/></label><label>Notify<select value={habitReminderMinutesBefore} onChange={e=>setHabitReminderMinutesBefore(Number(e.target.value))} disabled={!habitReminderTime}><option value={0}>At reminder time</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option></select></label></div></div></details></div>{habitError&&<p className="quick-add-error" role="alert">{habitError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>habitStep===2?(setHabitStep(1),setHabitError('')):setHabitOpen(false)}>{habitStep===2?'Back':'Cancel'}</button>{habitStep===1&&habitTrackingType==='check'&&<button type="button" className="secondary-button" disabled={!habitName.trim()} onClick={e=>void addHabit(e)}>Save</button>}<button className="primary-button" type="submit">{habitStep===1?'Continue':'Add habit'}</button></div></motion.form></motion.div>}</AnimatePresence>
    <AnimatePresence>{deleteTarget&&<motion.div key="delete-confirmation" className="modal-backdrop kram-motion-backdrop delete-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)closeDelete();}}><motion.section {...sheetMotion} className="modal-card kram-motion-sheet delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-heading" aria-describedby="delete-description" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();closeDelete();}}}><div className="delete-symbol"><Trash2 size={23}/></div><h2 id="delete-heading">Delete {deleteTarget.kind==='internship'?'work':deleteTarget.kind==='task'?'to-do':deleteTarget.kind}?</h2><p id="delete-description"><strong>{deleteTarget.title}</strong><br/>{deleteTarget.recurring?'Choose which occurrences you want to delete.':deleteTarget.kind==='habit'?'This habit will no longer appear in your routines. This cannot be undone.':'This will permanently remove the item. This cannot be undone.'}</p>{deleteTarget.recurring&&<fieldset className="delete-options"><legend>Delete</legend><label className={deleteScope==='one'?'selected':''}><input type="radio" name="delete-scope" checked={deleteScope==='one'} disabled={deleteBusy} onChange={()=>setDeleteScope('one')}/><span><strong>Only this occurrence</strong><small>Keep the rest of the series.</small></span></label><label className={deleteScope==='series'?'selected':''}><input type="radio" name="delete-scope" checked={deleteScope==='series'} disabled={deleteBusy} onChange={()=>setDeleteScope('series')}/><span><strong>Entire series</strong><small>Remove all saved occurrences.</small></span></label></fieldset>}{deleteError&&<p className="quick-add-error" role="alert">{deleteError}</p>}<div className="modal-actions delete-actions"><button type="button" className="secondary-button" autoFocus onClick={closeDelete} disabled={deleteBusy}>Cancel</button><button type="button" className="delete-confirm-button" onClick={()=>void confirmDelete()} disabled={deleteBusy}>{deleteBusy?'Deleting…':deleteTarget.recurring&&deleteScope==='series'?'Delete series':'Delete'}</button></div></motion.section></motion.div>}</AnimatePresence>
    <AnimatePresence>{whatsNewOpen&&!isLocked&&!blockLockSetup&&<motion.div key="whats-new" className="modal-backdrop kram-motion-backdrop whats-new-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)closeWhatsNew();}}><motion.section {...sheetMotion} className="modal-card kram-motion-sheet whats-new-card" role="dialog" aria-modal="true" aria-labelledby="whats-new-title"><div className="modal-heading"><div><h2 id="whats-new-title">What's new{installedVersion?' · v'+installedVersion:''}</h2></div><button type="button" className="icon-button" aria-label="Close what's new" onClick={closeWhatsNew}><X size={19}/></button></div><div className="whats-new-list">{KRAM_UPDATE_NOTES.map(note=><div key={note}><Check size={16}/><span>{note}</span></div>)}</div><div className="modal-actions"><button type="button" className="primary-button" autoFocus onClick={closeWhatsNew}>Continue</button></div></motion.section></motion.div>}</AnimatePresence>
    <div className="floating-dock"><nav className="bottom-nav" aria-label="Main navigation">{navItems.filter(([id])=>id!=='settings').map(([id,label,Icon])=><button key={id} className={tab===id?'bottom-item active':'bottom-item'} onClick={()=>{setTab(id);if(id==='internship-todo'||id==='internship-deadlines'){setInternshipFilter('Open');setInternshipSearch('');}}} aria-current={tab===id?'page':undefined}>{tab===id&&<motion.span aria-hidden="true" className="dock-selection" layoutId={'dock-selection-'+workspaceMode} transition={reducedMotion?{duration:0}:{type:'spring',stiffness:380,damping:34}}/>}<Icon size={21}/><span>{label}</span></button>)}</nav><button type="button" className="floating-add" aria-label={workspaceMode==='internship'?'Add internship work':tab==='habits'?'Add habit':tab==='schedule'?'Add task to schedule':tab==='tasks'&&listView==='someday'?'Add idea':'Add to-do'} onClick={()=>{if(workspaceMode==='internship')openInternshipForm();else if(tab==='habits'){setHabitReminderTime('');setHabitReminderMinutesBefore(10);setHabitStep(1);setHabitOpen(true);}else openNewTask(selectedDate,tab==='tasks'?listView:'todo');}}><Plus size={27}/></button></div>
  </div>;
}

function TaskList({tasks,onToggle,onEdit,onDelete,showDate=false,emptyAction,someday=false,onSchedule,onPromote,movingId}:{tasks:Task[];onToggle:(t:Task)=>void;onEdit:(t:Task)=>void;onDelete:(id:string)=>void;showDate?:boolean;emptyAction:()=>void;someday?:boolean;onSchedule?:(t:Task)=>void;onPromote?:(t:Task)=>void;movingId?:string|null}) {
 const reduce = useReducedMotion();
 return <div className="task-list"><AnimatePresence initial={false}>{tasks.length===0?<motion.div key="empty" className="empty-state" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduce?0:0.16}}><div className="empty-icon">{someday?<Target size={23}/>:<CheckCircle2 size={23}/>}</div><strong>{someday?'Room for future ideas':'Nothing on your list'}</strong><p>{someday?'Save something you would love to do one day.':'Add a to-do or change your filters.'}</p><button className="secondary-button" onClick={emptyAction}><Plus size={16}/> {someday?'Add an idea':'Add a to-do'}</button></motion.div>:tasks.map(t=><motion.div layout={reduce||tasks.length>25?false:'position'} initial={{opacity:0,y:reduce?0:9}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduce?0:-6}} transition={{duration:reduce?0:0.13}} className={(t.completed?'task-row completed':'task-row')+(onSchedule||onPromote?' todo-list-row':'')} key={t.id}><button className="task-check" onClick={()=>onToggle(t)} aria-label={t.completed?'Mark incomplete':'Mark complete'}>{t.completed?<Check size={15}/>:<Circle size={19}/>}</button><button className="task-main" onClick={()=>onEdit(t)}><strong>{t.title}</strong>{t.notes&&<span>{t.notes}</span>}<small>{someday?'No date needed':<>{showDate&&t.dueDate&&<><CalendarDays size={12}/> Due {prettyDate(t.dueDate,{month:'short',day:'numeric'})} · </>}{isTaskOverdue(t)&&<span className="overdue-label">OVERDUE</span>}{t.dueTime&&<><Clock3 size={12}/>{(t.scheduledDate||t.dueDate)?prettyDate(t.scheduledDate||t.dueDate,{month:'short',day:'numeric'})+' · ':''}{displayTime(t.dueTime)}–{displayTime(minutesToTime(Math.min(1439,timeToMinutes(t.dueTime)+(t.durationMinutes||60))))} · </>}<i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority} priority</>}</small></button><button className="icon-button delete-button" title={someday?'Delete idea':'Delete to-do'} aria-label={someday?'Delete idea':'Delete to-do'} onClick={()=>onDelete(t.id)}><Trash2 size={16}/></button>{!t.completed&&(onSchedule||onPromote)&&<div className="todo-row-actions">{onSchedule&&<button type="button" className="todo-schedule-button" onClick={()=>onSchedule(t)}><CalendarDays size={15}/>{t.dueTime?'Reschedule':'Schedule'}</button>}{onPromote&&<button type="button" className="todo-schedule-button" disabled={!!movingId} onClick={()=>onPromote(t)}><ListTodo size={15}/>{movingId===t.id?'Moving…':'Move to to-do'}</button>}</div>}</motion.div>)}</AnimatePresence></div>;
}
function HabitList({habits,checkins,date,now,onToggle,onSkip,onSkipLimitChange,onRecord,onTimerStart,onTimerStop,onDelete}:{habits:Habit[];checkins:Checkin[];date:string;now:Date;onToggle:(h:Habit)=>void;onSkip:(h:Habit)=>void;onSkipLimitChange:(h:Habit,value:number)=>void;onRecord:(h:Habit,value:number)=>void;onTimerStart:(h:Habit)=>void;onTimerStop:(h:Habit)=>void;onDelete?:(id:string)=>void}) {
 const [values,setValues]=useState<Record<string,string>>({});
 const [expandedHabitId,setExpandedHabitId]=useState<string|null>(null);
 const active=habits;
 const done=active.filter(h=>checkins.some(c=>c.habitId===h.id&&c.date===date&&c.completed)).length;
 const activeTimer=checkins.find(c=>!!c.timerStartedAt&&c.date===todayKey());
 return <><div className="habit-list">{active.length===0?<div className="empty-state"><div className="empty-icon"><Target size={23}/></div><strong>No habits yet</strong></div>:active.map(h=>{const entry=checkins.find(c=>c.habitId===h.id&&c.date===date);const isDone=!!entry?.completed;const isSkipped=!!entry?.skipped;const weekStart=mondayWeekStart(date);const usedSkips=checkins.filter(c=>c.habitId===h.id&&c.skipped&&c.date>=weekStart&&c.date<=date).length;const skipLimit=Math.max(0,Math.min(7,h.allowedSkipsPerWeek??1));const streak=habitStreak(h.id,checkins,date);const measurable=h.trackingType==="measurable";const timerEligible=!measurable||h.unit==="minutes"||h.unit==="hours";const running=!!entry?.timerStartedAt;const elapsed=(entry?.elapsedSeconds||0)+(running?Math.max(0,Math.floor((now.getTime()-new Date(entry!.timerStartedAt!).getTime())/1000)):0);const expanded=expandedHabitId===h.id;const status=isDone?"Completed":isSkipped?"Skipped":entry?.timerStartedAt?"In progress":"Not started";return <div className="habit-row habit-row-expanded" key={h.id} style={{flexWrap:"wrap"}}><button type="button" className="habit-emoji" aria-label={expanded?"Hide habit details":"Show habit details"} onClick={()=>setExpandedHabitId(expanded?null:h.id)}>{h.emoji||"✦"}</button><button type="button" className="habit-info" onClick={()=>setExpandedHabitId(expanded?null:h.id)} style={{textAlign:"left",background:"transparent",border:0,padding:0,cursor:"pointer",minWidth:0}}><strong>{h.name}</strong><span>{h.goalType==='quit'?'Quit habit · ': 'Build habit · '}{status} · {measurable?"Target: "+(h.targetValue||0)+" "+(h.unit||"units"):"Daily check-in"}</span></button><button type="button" className="text-button" onClick={()=>setExpandedHabitId(expanded?null:h.id)}>{expanded?"Hide details":"Details"} <span aria-hidden="true">{expanded?"−":"+"}</span></button>{expanded&&<div style={{flexBasis:"100%",padding:"8px 4px 4px 44px",display:"grid",gap:12}}><div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:13}}><span>🔥 {streak} day streak</span><span>{Math.max(0,skipLimit-usedSkips)} of {skipLimit} weekly skips left</span></div><label style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>Weekly skip allowance<select aria-label={"Weekly skips allowed for "+h.name} value={skipLimit} onChange={e=>onSkipLimitChange(h,Number(e.target.value))} style={{width:68,padding:"5px"}}>{Array.from({length:8},(_,i)=><option key={i} value={i}>{i}</option>)}</select></label>{measurable&&<><div className="habit-measure-row"><input aria-label={"Progress for "+h.name} type="number" min="0" step="any" placeholder={h.unit||"Value"} value={values[h.id]??(entry?.value!==undefined?String(entry.value):"")} onChange={e=>setValues(v=>({...v,[h.id]:e.target.value}))}/><button className="habit-check" type="button" onClick={()=>onRecord(h,Number(values[h.id]??entry?.value??0))}>Save progress</button></div><div className="habit-progress-track"><span style={{width:Math.min(100,(entry?.value||0)/Math.max(1,h.targetValue||1)*100)+"%"}}/></div></>}{date===todayKey()&&timerEligible&&<div className="habit-timer-row"><span>{running?"Timer running · ":"Timer · "}{Math.floor(elapsed/3600).toString().padStart(2,"0")}:{Math.floor(elapsed%3600/60).toString().padStart(2,"0")}:{(elapsed%60).toString().padStart(2,"0")}</span>{running?<button className="habit-check checked" type="button" onClick={()=>onTimerStop(h)}>Stop & save</button>:<button className="habit-check" type="button" disabled={!!activeTimer} onClick={()=>onTimerStart(h)}>{activeTimer?"Another timer is running":"Start timer"}</button>}</div>}<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{!measurable&&<button className={isDone?"habit-check checked":"habit-check"} type="button" onClick={()=>onToggle(h)}>{isDone?<><Check size={16}/> {h.goalType==='quit'?'Avoided':'Done'}</>:h.goalType==='quit'?'Stayed away today':'Check in'}</button>}<button type="button" className={isSkipped?"habit-check checked":"habit-check"} disabled={isDone||(!isSkipped&&usedSkips>=skipLimit)} onClick={()=>onSkip(h)}>{isSkipped?"Undo skip":"Skip today"}</button>{onDelete&&<button type="button" className="secondary-button" onClick={()=>onDelete(h.id)}>Delete habit</button>}</div></div>}</div>})}</div><p className="stat-caption" style={{marginTop:10}}>{done} of {active.length} habits completed</p></>;
}