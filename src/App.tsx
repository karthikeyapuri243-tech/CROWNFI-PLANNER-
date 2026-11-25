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
import confetti from 'canvas-confetti';

type Task = { id:string; userId:string; title:string; notes?:string; dueDate:string; scheduledDate?:string; dueTime?:string; durationMinutes?:number; reminderMinutesBefore?:number; priority:'High'|'Medium'|'Low'; repeat?:'none'|'daily'|'weekdays'|'weekly'; lastGeneratedDate?:string; completed:boolean; createdAt:string };
type Habit = { id:string; userId:string; name:string; emoji:string; goalType?:'build'|'quit'; trackingType?:'check'|'measurable'; targetValue?:number; unit?:string; reminderTime?:string; reminderMinutesBefore?:number; allowedSkipsPerWeek?:number; createdAt:string };
type ScheduleBlock = { id:string; userId:string; title:string; startTime:string; endTime:string; repeat:'weekly'|'once'; days:number[]; date?:string; createdAt:string };
type Checkin = { id:string; userId:string; habitId:string; date:string; completed:boolean; skipped?:boolean; value?:number; timerStartedAt?:string; elapsedSeconds?:number };
type Tab = 'today'|'schedule'|'tasks'|'upcoming'|'habits'|'progress'|'internship'|'settings';

const dateKey = (d:Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const nextRepeatDate = (value:string,repeat:NonNullable<Task['repeat']>) => { const d=new Date(value+'T12:00:00'); if(repeat==='daily')d.setDate(d.getDate()+1); else if(repeat==='weekly')d.setDate(d.getDate()+7); else { do { d.setDate(d.getDate()+1); } while(d.getDay()===0||d.getDay()===6); } return dateKey(d); };
const todayKey = () => dateKey(new Date());
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
  if(task.completed||!task.dueDate)return false;
  if(task.dueDate<referenceDate)return true;
  if(task.dueDate>referenceDate||!task.dueTime||referenceDate!==todayKey())return false;
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
  const pendingDeleteRef = useRef<{key:string}|null>(null);
  const [user,setUser] = useState<User|null>(null);
  const [authLoading,setAuthLoading] = useState(true);
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
  const [internshipEditing,setInternshipEditing] = useState<Task|null>(null);
  const [internshipTitle,setInternshipTitle] = useState('');
  const [internshipNotes,setInternshipNotes] = useState('');
  const [internshipDeadline,setInternshipDeadline] = useState('');
  const [internshipPriority,setInternshipPriority] = useState<'High'|'Medium'|'Low'>('Medium');
  const [internshipFilter,setInternshipFilter] = useState<'All'|'Open'|'Overdue'|'Completed'>('Open');
  const [internshipSearch,setInternshipSearch] = useState('');
  const [tasksLoaded,setTasksLoaded] = useState(false);
  const [syncError,setSyncError] = useState('');
  const [clockNow,setClockNow] = useState(()=>new Date());
  const [habits,setHabits] = useState<Habit[]>([]);
  const [habitsLoaded,setHabitsLoaded] = useState(false);
  const [checkins,setCheckins] = useState<Checkin[]>([]);
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
  const [selectedDate,setSelectedDate] = useState(todayKey());
  const [dark,setDark] = useState(() => localStorage.getItem('KRAM-theme') === 'dark');
  const [taskOpen,setTaskOpen] = useState(false);
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
  const [filter,setFilter] = useState<'All'|'Open'|'Completed'>('All');
  const [taskQuery,setTaskQuery] = useState('');
  const [priorityFilter,setPriorityFilter] = useState<'All'|'High'|'Medium'|'Low'>('All');
  const [taskSort,setTaskSort] = useState<'Date'|'Priority'|'Title'>('Date');

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); }),[]);
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

  useEffect(() => { const timer=window.setInterval(()=>setClockNow(new Date()),30000); return ()=>window.clearInterval(timer); },[]);
  useEffect(()=>{if(!Capacitor.isNativePlatform())return;let active=true;LocalNotifications.checkPermissions().then(permission=>{if(!active)return;const enabled=permission.display==='granted';setNotificationsEnabled(enabled);localStorage.setItem('KRAM-notifications',enabled?'on':'off');}).catch(error=>console.warn('KRAM notification permission check failed',error));return()=>{active=false;};},[]);
  useEffect(()=>{if(Capacitor.isNativePlatform()||!notificationsEnabled||!('Notification' in window)||Notification.permission!=='granted')return;const check=()=>{const now=new Date();const today=dateKey(now);const currentMinute=now.getHours()*60+now.getMinutes();const notify=(key:string,titleText:string,body:string)=>{if(localStorage.getItem(key)==='sent')return;localStorage.setItem(key,'sent');const options={body,icon:'/kram-icon.svg',tag:key};if('serviceWorker' in navigator){navigator.serviceWorker.ready.then(registration=>registration.showNotification(titleText,options)).catch(error=>{console.warn('KRAM service-worker notification failed',error);});}else{try{new Notification(titleText,options);}catch(error){console.warn('KRAM notification failed',error);}}playReminderAlert(soundEnabled,vibrationEnabled);};tasks.filter(t=>!t.completed&&(t.scheduledDate||t.dueDate)===today&&!!t.dueTime&&t.reminderMinutesBefore!==null&&t.reminderMinutesBefore!==undefined).forEach(t=>{const at=timeToMinutes(t.dueTime!)-t.reminderMinutesBefore!;if(currentMinute===at)notify('KRAM-reminder-task-'+t.id+'-'+today,'Task reminder',t.title+' is coming up.');});habits.filter(h=>!!h.reminderTime).forEach(h=>{const at=timeToMinutes(h.reminderTime!)-(h.reminderMinutesBefore??10);if(currentMinute===at)notify('KRAM-reminder-habit-'+h.id+'-'+today,'Habit reminder','Time to work on '+h.name+'.');});};check();const timer=window.setInterval(check,15000);return()=>window.clearInterval(timer);},[notificationsEnabled,soundEnabled,vibrationEnabled,tasks,habits]);

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
        tasks.filter(task=>!task.completed && !!task.dueTime && !!(task.scheduledDate||task.dueDate) && task.reminderMinutesBefore!==null && task.reminderMinutesBefore!==undefined).forEach(task=>{
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
    const c=subscribePlannerCheckins(user.uid,setCheckins);
    const d=subscribePlannerBlocks(user.uid,setBlocks);
    return () => {a();b();c();d();};
  },[user]);

  const todaysTasks = useMemo(() => tasks.filter(t=>(t.scheduledDate||t.dueDate)===selectedDate).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||'')),[tasks,selectedDate]);
  const doneCount = todaysTasks.filter(t=>t.completed).length;
  const completion = todaysTasks.length ? Math.round(doneCount/todaysTasks.length*100) : 0;
  const nextTask = todaysTasks
  .filter(t => !t.completed)
  .sort((a, b) => {
    if (!a.dueTime) return 1;
    if (!b.dueTime) return -1;
    return a.dueTime.localeCompare(b.dueTime);
  })[0];

  const todayCheckins = habits.filter(h=>checkins.some(c=>c.habitId===h.id&&c.date===selectedDate&&c.completed)).length;
  const week = useMemo(()=>Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const key=dateKey(d);const day=tasks.filter(t=>t.dueDate===key);return {key,label:d.toLocaleDateString('en-IN',{weekday:'short'}),total:day.length,done:day.filter(t=>t.completed).length};}),[tasks]);

  const openNewTask = (date='') => {setEditing(null);setTitle('');setNotes('');setDueDate('');setScheduleDate(date||selectedDate);setDueTime('');setEndTime('');setDurationMinutes(30);setReminderMinutesBefore(-1);setPriority('Medium');setRepeat('none');setTaskError('');setTaskOpen(true);};
  const openEditTask = (t:Task) => {setEditing(t);setTitle(t.title);setNotes(t.notes||'');setDueDate(t.dueDate||'');setScheduleDate(t.scheduledDate||(t.dueTime?t.dueDate:selectedDate)||selectedDate);setDueTime(t.dueTime||'');setEndTime(t.dueTime?minutesToTime(timeToMinutes(t.dueTime)+(t.durationMinutes||60)):'');setDurationMinutes(t.durationMinutes||60);setReminderMinutesBefore(t.reminderMinutesBefore??0);setPriority(t.priority);setRepeat(t.repeat||'none');setTaskError('');setTaskOpen(true);};
  const saveTask = async (e:FormEvent) => {
    e.preventDefault();
    if (savingTask) return;
    if (!user) { setTaskError('You are signed out. Please sign in again.'); return; }
    if (!title.trim()) { setTaskError('Please enter a task name.'); return; }
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
      const payload={title:title.trim(),notes:notes.trim(),dueDate:dueDate||'',scheduledDate:plannedDate,dueTime:dueTime||'',...(dueTime?{durationMinutes:calculatedDuration}:{}),reminderMinutesBefore:dueTime&&reminderMinutesBefore>=0?reminderMinutesBefore:null,priority,repeat,completed:editing?.completed||false};
      if(editing) await updatePlannerTask(editing.id,payload);
      else await createPlannerTask(user.uid,payload);
      setTaskOpen(false);
    } catch (err) {
      console.error('KRAM task save failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      setTaskError('Could not save task. ' + message);
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
      confetti({particleCount:55,spread:62,origin:{y:0.72},scalar:0.8});
      triggerKramHaptic(vibrationEnabled,'success');
      showMomentumToast('Task complete · one more step forward');
    }
    if(nextCompleted&&t.repeat&&t.repeat!=='none'&&t.dueDate) {
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
      await createPlannerTask(user.uid,{title:quickTaskTitle.trim(),notes:'',dueDate:'',dueTime:'',priority:'Medium',completed:false});
      setQuickTaskTitle('');
    } catch (err) {
      console.error('KRAM quick task save failed:',err);
      setQuickTaskError('Could not add task. Please try again.');
    } finally {
      setQuickTaskSaving(false);
    }
  };

  const activeBlocks = blocks.filter(b=>b.repeat==='weekly'?b.days.includes(new Date(selectedDate+'T12:00:00').getDay()):b.date===selectedDate);
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
  const confirmDoubleTapDelete=(key:string)=>{const pending=pendingDeleteRef.current;if(pending?.key===key){pendingDeleteRef.current=null;return true;}pendingDeleteRef.current={key};const armed=window.confirm('This action cannot be undone. Tap OK, then tap Delete once more when you are ready. A final confirmation will appear.');if(!armed){pendingDeleteRef.current=null;return false;}return false;};
  const handleDeleteTask=async(id:string)=>{if(!confirmDoubleTapDelete('task:'+id))return;const task=tasks.find(item=>item.id===id);let deleteWholeSeries=false;if(task?.repeat&&task.repeat!=='none'){const choice=window.prompt('This task repeats. What should be deleted?\n1 — Only this day\n2 — The whole series\nCancel — Keep it');if(choice===null)return;if(choice.trim()==='2')deleteWholeSeries=true;else if(choice.trim()!=='1'){window.alert('Choose 1 for this day or 2 for the whole series.');return;}}if(!window.confirm(deleteWholeSeries?'Delete this recurring task and all its occurrences?':'Delete this task for this day?'))return;try{if(deleteWholeSeries&&user){const root=tasks.filter(item=>id.startsWith(item.id+'_')&&item.repeat&&item.repeat!=='none').sort((x,y)=>y.id.length-x.id.length)[0]||task;await deletePlannerTaskSeries(user.uid,root?.id||id);}else await deletePlannerTask(id);triggerKramHaptic(vibrationEnabled,'success');}catch(error){console.error(error);window.alert('Could not delete the task. Please try again.');}};
  const openInternshipForm=(task?:Task)=>{setInternshipEditing(task||null);setInternshipTitle(task?.title||'');setInternshipNotes(task?.notes||'');setInternshipDeadline(task?.dueDate||'');setInternshipPriority(task?.priority||'Medium');setInternshipFormOpen(true);};
  const saveInternshipTask=async(e:FormEvent)=>{e.preventDefault();if(!user||!internshipTitle.trim())return;const payload={title:internshipTitle.trim(),notes:internshipNotes.trim(),dueDate:internshipDeadline||'',priority:internshipPriority,completed:internshipEditing?.completed||false};try{if(internshipEditing)await updateInternshipTask(internshipEditing.id,payload);else await createInternshipTask(user.uid,payload);setInternshipFormOpen(false);}catch(error){console.error('KRAM internship task save failed',error);window.alert('Could not save this internship task. Please try again.');}};
  const toggleInternshipTask=async(task:Task)=>{try{await updateInternshipTask(task.id,{completed:!task.completed});if(!task.completed){confetti({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');}}catch(error){console.error(error);window.alert('Could not update this internship task. Please try again.');}};
  const removeInternshipTask=async(task:Task)=>{if(!window.confirm('Delete "'+task.title+'"? This cannot be undone.'))return;try{await deleteInternshipTask(task.id);}catch(error){console.error(error);window.alert('Could not delete this internship task. Please try again.');}};
  const handleDeleteHabit=async(id:string)=>{const habit=habits.find(h=>h.id===id);if(!confirmDoubleTapDelete('habit:'+id))return;if(!window.confirm('Delete '+(habit?.name||'this habit')+' permanently? Its habit history and check-ins may also be removed. This cannot be undone.'))return;try{await deletePlannerHabit(id);triggerKramHaptic(vibrationEnabled,'success');}catch(error){console.error(error);window.alert('Could not delete the habit. Please try again.');}};
  const handleDeleteBlock=async(id:string)=>{if(!confirmDoubleTapDelete('commitment:'+id))return;if(!window.confirm('Delete this commitment permanently? This cannot be undone.'))return;try{await deletePlannerBlock(id);triggerKramHaptic(vibrationEnabled,'success');}catch(error){console.error(error);window.alert('Could not delete the commitment. Please try again.');}};
  const toggleBlockDay=(day:number)=>setBlockDays(current=>current.includes(day)?current.filter(d=>d!==day):[...current,day].sort());
  const openNewTaskAt=(time:string)=>{openNewTask(selectedDate);setDueTime(time);};
  const placeTaskAt=async(taskId:string,time:string)=>{
    const task=tasks.find(t=>t.id===taskId);if(!task||task.completed)return;
    const start=timeToMinutes(time),finish=start+(task.durationMinutes||30);
    const blocked=activeBlocks.some(x=>start<timeToMinutes(x.endTime)&&finish>timeToMinutes(x.startTime));
    const occupied=todaysTasks.some(x=>!x.completed&&x.id!==taskId&&!!x.dueTime&&start<timeToMinutes(x.dueTime)+(x.durationMinutes||60)&&finish>timeToMinutes(x.dueTime));
    if(blocked||occupied){setSmartMessage('That slot overlaps another commitment. Choose another hour.');setDragTaskId('');return;}
    try{await updatePlannerTask(taskId,{scheduledDate:selectedDate,dueTime:time,durationMinutes:task.durationMinutes||30});setSmartMessage('Task placed on your timetable.');}
    catch(error){console.error(error);setSmartMessage('Could not move this task. Please try again.');}
    setDragTaskId('');
  };
  const scheduleTasks=async()=>{
    if(!user||scheduling)return;
    const pending=tasks.filter(t=>!t.completed&&!t.dueTime&&(!t.scheduledDate)&&(!t.dueDate||t.dueDate>=selectedDate)).sort((x,y)=>priorityRank(x.priority)-priorityRank(y.priority)||x.createdAt.localeCompare(y.createdAt));
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
  const scheduledTasks=todaysTasks.filter(t=>!t.completed&&!!t.dueTime).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||''));
  const overdueTasks=tasks.filter(t=>isTaskOverdue(t,selectedDate,clockNow)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||(a.dueTime||'').localeCompare(b.dueTime||''));
  const overdueTaskIds=new Set(overdueTasks.map(t=>t.id));
  const unscheduledTasks=tasks.filter(t=>!t.completed&&!t.dueTime&&!t.scheduledDate&&(!t.dueDate||t.dueDate>=selectedDate)&&!overdueTaskIds.has(t.id));
  const scheduleConflicts=scheduledTasks.filter((task,index)=>scheduledTasks.slice(0,index).some(previous=>timeToMinutes(task.dueTime!)<timeToMinutes(previous.dueTime!)+(previous.durationMinutes||60)));
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
  const toggleHabit = async (h:Habit) => {const existing=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate);try{await setPlannerHabitCheckin(user!.uid,h.id,selectedDate,!existing?.completed,existing?.value,{skipped:false});if(!existing?.completed){confetti({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');const streak=habitStreak(h.id,checkins,selectedDate)+1;showMomentumToast(streak===7?'7-day streak · wonderful consistency!':streak===30?'30-day streak · incredible commitment!':streak===3?'3-day streak · keep it steady!':'Habit complete · consistency grows');}}catch(error){console.error('KRAM habit check-in failed:',error);setHabitError('Could not save your check-in. Please try again.');}};
  const skipHabit = async (h:Habit) => { if(!user)return; const existing=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate); if(existing?.completed){setHabitError('A completed habit cannot be skipped.');return;} const weekStart=mondayWeekStart(selectedDate); const used=checkins.filter(c=>c.habitId===h.id&&c.skipped&&c.date>=weekStart&&c.date<=selectedDate).length; const limit=Math.max(0,Math.min(7,h.allowedSkipsPerWeek??1)); if(existing?.skipped){try{await setPlannerHabitCheckin(user.uid,h.id,selectedDate,false,existing.value,{skipped:false});setHabitError('Skip removed.');}catch(error){console.error(error);setHabitError('Could not undo this skip. Please try again.');}return;} if(used>=limit){setHabitError('You have used all '+limit+' allowed skip'+(limit===1?'':'s')+' for this week. Your allowance resets on Monday.');return;} try{await setPlannerHabitCheckin(user.uid,h.id,selectedDate,false,existing?.value,{skipped:true,timerStartedAt:null});setHabitError('Skip used. Your streak is protected; no XP was earned.');}catch(error){console.error(error);setHabitError('Could not save this skip. Please try again.');} };
  const changeHabitSkipLimit = async (h:Habit,value:number) => { try { await updatePlannerHabit(h.id,{allowedSkipsPerWeek:value}); } catch(error) { console.error(error); setHabitError('Could not update the weekly skip allowance.'); } };
  const recordHabitValue = async (h:Habit,value:number) => {if(!user||!Number.isFinite(value)||value<0)return;try{const completed=value>=(h.targetValue||0);await setPlannerHabitCheckin(user.uid,h.id,selectedDate,completed,value,{skipped:false});if(completed){confetti({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');showMomentumToast('Daily target reached · nicely done');}}catch(error){console.error('KRAM measurable habit update failed:',error);setHabitError('Could not save this progress. Please try again.');}};
  const startHabitTimer = async (h:Habit) => {if(!user||selectedDate!==todayKey())return;const running=checkins.find(c=>!!c.timerStartedAt&&c.date===todayKey());if(running&&running.habitId!==h.id){setHabitError('Stop the active habit timer before starting another.');return;}const entry=checkins.find(c=>c.habitId===h.id&&c.date===todayKey());try{await setPlannerHabitCheckin(user.uid,h.id,todayKey(),entry?.completed||false,entry?.value,{timerStartedAt:new Date().toISOString(),elapsedSeconds:entry?.elapsedSeconds||0,skipped:false});setHabitError('');}catch(error){console.error(error);setHabitError('Could not start the timer. Please try again.');}};
  const stopHabitTimer = async (h:Habit) => {if(!user)return;const entry=checkins.find(c=>c.habitId===h.id&&c.date===todayKey());if(!entry?.timerStartedAt)return;const seconds=Math.max(0,(entry.elapsedSeconds||0)+Math.floor((Date.now()-new Date(entry.timerStartedAt).getTime())/1000));const rawValue=h.unit==='hours'?seconds/3600:seconds/60;const value=Number(rawValue.toFixed(2));const completed=h.trackingType==='measurable'?value>=(h.targetValue||0):seconds>0;try{await setPlannerHabitCheckin(user.uid,h.id,todayKey(),completed,value,{timerStartedAt:null,elapsedSeconds:seconds,skipped:false});if(completed){confetti({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');}setHabitError('');}catch(error){console.error(error);setHabitError('Could not save the timer. Please try again.');}};

  if(authLoading) return <div className="loading-screen"><div className="loader-mark">K</div><p>Opening your planner…</p></div>;
  if(!user) return <Auth/>;

  const navItems:[Tab,string,any][]=[['today','Today',LayoutDashboard],['schedule','Schedule',CalendarDays],['tasks','Tasks',ListTodo],['habits','Habits',Target],['progress','Progress',TrendingUp],['internship','Internship',BriefcaseBusiness],['settings','Settings',Settings]];
  const visibleTasks = (tab==='tasks'?tasks:todaysTasks)
    .filter(t=>(filter==='All'||(filter==='Open'?!t.completed:t.completed))
      && (priorityFilter==='All'||t.priority===priorityFilter)
      && (!taskQuery.trim()||t.title.toLowerCase().includes(taskQuery.trim().toLowerCase())||(t.notes||'').toLowerCase().includes(taskQuery.trim().toLowerCase())))
    .sort((a,b)=>taskSort==='Priority'?priorityRank(a.priority)-priorityRank(b.priority)||((a.dueDate||'9999').localeCompare(b.dueDate||'9999')):taskSort==='Title'?a.title.localeCompare(b.title):(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||(a.dueTime||'').localeCompare(b.dueTime||''));
  const upcomingDays=Array.from({length:14},(_,i)=>{const d=new Date(todayKey()+'T12:00:00');d.setDate(d.getDate()+i);const key=dateKey(d);return {key,label:i===0?'Today':i===1?'Tomorrow':prettyDate(key,{weekday:'long',month:'short',day:'numeric'}),items:tasks.filter(t=>t.dueDate===key&&!t.completed).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||''))};}).filter(day=>day.items.length>0);
  const habitHistory90=Array.from({length:90},(_,i)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-(89-i));const key=dateKey(d);const records=checkins.filter(c=>c.date===key&&habits.some(h=>h.id===c.habitId));const completed=records.filter(c=>c.completed).length;const skipped=records.filter(c=>c.skipped).length;const total=habits.filter(h=>!h.createdAt||h.createdAt.slice(0,10)<=key).length;return {key,completed,skipped,total,percent:total?Math.round(completed/total*100):0};});
  const history90Completed=habitHistory90.reduce((sum,d)=>sum+d.completed,0);
  const history90Skips=habitHistory90.reduce((sum,d)=>sum+d.skipped,0);
  const history90Possible=habitHistory90.reduce((sum,d)=>sum+d.total,0);

  return <div className="app-shell" onClickCapture={()=>triggerKramHaptic(vibrationEnabled,'light')}>
    <aside className="sidebar">
      <div className="brand"><img className="brand-icon" src="/kram-icon.svg" alt="KRAM"/><div><strong>KRAM</strong><span>PERSONAL PLANNER</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'nav-item active':'nav-item'} onClick={()=>setTab(id)}><Icon size={19}/><span>{label}</span>{id==='tasks'&&<small>{tasks.filter(t=>!t.completed).length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{(user.displayName||user.email||'U').charAt(0).toUpperCase()}</div><div className="user-details"><strong>{user.displayName||'My planner'}</strong><span>{user.email}</span></div></div></div>
    </aside>
    {momentumToast&&<div key={momentumToastKey} className="momentum-toast" role="status"><span className="momentum-toast-icon"><Check size={16}/></span><span>{momentumToast}</span><span className="momentum-toast-sparkle">✦</span></div>}
   <main className="main-area">
      <header className="topbar"><button className="mobile-brand" aria-label="Open navigation menu" aria-expanded={mobileMenu} onClick={()=>setMobileMenu(!mobileMenu)}><Menu size={20}/><img src="/kram-icon.svg" alt=""/><b>KRAM</b></button><div className="breadcrumb">My workspace <span>/</span> <strong>{navItems.find(n=>n[0]===tab)?.[1]}</strong></div><div className="top-actions"><span className={syncError?"sync-label sync-error":"sync-label"}><span className="sync-dot"/>{syncError?"Sync issue":"Synced"}</span><button className="icon-button" aria-label="Reminder settings" onClick={()=>setAlertsOpen(true)} title="Reminder settings"><Bell size={18}/></button><button className="icon-button theme-button" aria-label={dark?'Switch to light theme':'Switch to dark theme'} onClick={()=>setDark(!dark)} title="Toggle theme">{dark?<Sun size={18}/>:<Moon size={18}/>}</button></div></header>
      {syncError&&<div className="sync-error-banner" role="alert">{syncError}</div>}{mobileMenu&&<div className="mobile-menu-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setMobileMenu(false)}}><aside className="mobile-menu-drawer"><div className="mobile-menu-heading"><div><strong>KRAM</strong><span>YOUR WORKSPACE</span></div><button className="icon-button" onClick={()=>setMobileMenu(false)} aria-label="Close menu"><X size={20}/></button></div>{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'mobile-menu-item active':'mobile-menu-item'} onClick={()=>{setTab(id);setMobileMenu(false)}}><Icon size={19}/>{label}{id==='tasks'&&<small>{tasks.filter(t=>!t.completed).length}</small>}</button>)}<div className="mobile-menu-footer"><span>Signed in as</span><strong>{user.email}</strong></div></aside></div>}
      <div className="page-content page-transition" key={tab}>
        {tab==='today'&&<><div className="page-heading"><div><div className="eyebrow">YOUR DAY, YOUR PACE</div><h1>{getTimeGreeting(clockNow)}.</h1><p>{prettyDate(selectedDate)} <span className="muted-dot">·</span> Make today count, one step at a time.</p></div><button className="primary-button" onClick={()=>openNewTask()}><Plus size={18}/> Add task</button></div>
          <div className="date-switch"><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-1);setSelectedDate(dateKey(d));}}><ChevronLeft size={18}/></button><button className="date-current" onClick={()=>setSelectedDate(todayKey())}><CalendarDays size={16}/>{selectedDate===todayKey()?'Today':prettyDate(selectedDate,{month:'short',day:'numeric',year:'numeric'})}</button><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+1);setSelectedDate(dateKey(d));}}><ChevronRight size={18}/></button></div><section className="gita-wisdom-card"><div className="gita-wisdom-top"><span className="gita-wisdom-mark">ॐ</span><div><span className="eyebrow">A MOMENT OF WISDOM</span><h2>Bhagavad Gita</h2></div><span className="gita-wisdom-daily">DAILY SHLOKA</span></div><p className="gita-wisdom-verse">{dailyGitaWisdom(clockNow).verse}</p><p className="gita-wisdom-transliteration">{dailyGitaWisdom(clockNow).transliteration}</p><p className="gita-wisdom-meaning">“{dailyGitaWisdom(clockNow).meaning}”</p><span className="gita-wisdom-reference">{dailyGitaWisdom(clockNow).reference}</span></section>
          <form className="quick-add-task" onSubmit={saveQuickTask}><Plus size={18}/><input aria-label="Quick add task" maxLength={120} placeholder="Add a task and press Enter…" value={quickTaskTitle} onChange={e=>setQuickTaskTitle(e.target.value)}/><button className="quick-add-submit" type="submit" disabled={!quickTaskTitle.trim()||quickTaskSaving}>{quickTaskSaving?'Adding…':'Add task'}</button></form>{quickTaskError&&<p className="quick-add-error" role="alert">{quickTaskError}</p>}
          <section className="overview-grid"><div className="overview-card progress-card"><div className="card-topline"><span>DAILY PROGRESS</span><TrendingUp size={17}/></div><div className="progress-main"><div><strong>{completion}%</strong><p>{doneCount} of {todaysTasks.length} tasks completed</p></div><div className="ring" style={{'--progress':completion} as CSSProperties}><div>{completion}%</div></div></div><div className="progress-track"><span style={{width:completion+'%'}}/></div></div><div className="overview-card"><div className="card-topline"><span>TASKS LEFT</span><ListTodo size={17}/></div><strong className="stat-number">{Math.max(0,todaysTasks.length-doneCount)}</strong><p className="stat-caption">A clear next step is all you need.</p></div><div className="overview-card"><div className="card-topline"><span>HABITS TODAY</span><Flame size={17}/></div><strong className="stat-number">{todayCheckins}<em> / {habits.length}</em></strong><p className="stat-caption">Small actions build consistency.</p></div></section>
          <section className="dashboard-all-progress"><div><span>ALL TASKS COMPLETED</span><strong>{tasks.filter(t=>t.completed).length}</strong></div><div><span>HABIT CHECK-INS</span><strong>{checkins.filter(c=>c.completed).length}</strong></div><div><span>ACTIVE HABITS</span><strong>{habits.length}</strong></div></section>
          <section className="next-step-card">
            <div className="next-step-copy">
              <span className="eyebrow">YOUR NEXT STEP</span>
              {nextTask ? <>
                <h2>{nextTask.title.trim() || 'Untitled task'}</h2>
                <p className="next-step-meta">
                  {nextTask.dueTime ? `Scheduled for ${nextTask.dueTime}` : 'Whenever you are ready'}
                  <span>·</span>
                  <span className={`priority-label priority-${nextTask.priority.toLowerCase()}`}>{nextTask.priority} priority</span>
                </p>
                <button className="next-step-complete" onClick={() => toggleTask(nextTask)}>
                  <Check size={15}/> Mark as complete
                </button>
              </> : <>
                <h2>You're all caught up.</h2>
                <p>No unfinished tasks for this day. Enjoy the breathing room.</p>
              </>}
            </div>
            <div className="next-step-icon"><Target size={22}/></div>
          </section>
          <section className="week-glance">
            <div className="week-glance-heading"><div><span className="eyebrow">THE BIG PICTURE</span><h2>Your week, at a glance</h2></div><span className="week-total">{week.reduce((sum,d)=>sum+d.done,0)} <i>done this week</i></span></div>
            <div className="week-glance-bars">{week.map(d=><div className="week-glance-day" key={d.key}><div className="week-glance-track"><span style={{height:(d.total?Math.max(8,d.done/d.total*100):0)+'%'}}/></div><span className="week-glance-label">{d.label.slice(0,1)}</span></div>)}</div>
          </section>
          <section className="content-section"><div className="section-heading"><div><h2>Today's tasks</h2><p>Keep it simple. Focus on what matters.</p></div><button className="text-button" onClick={()=>setTab('tasks')}>View all <ChevronRight size={16}/></button></div><TaskList tasks={todaysTasks} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} emptyAction={()=>openNewTask()}/></section>
          <section className="content-section dashboard-habits"><div className="section-heading"><div><h2>Habit status</h2><p>Today's routine at a glance.</p></div><button className="text-button" onClick={()=>setTab('habits')}>Manage habits <ChevronRight size={16}/></button></div>
          <div className="dashboard-habit-summary"><strong>{todayCheckins} / {habits.length} completed</strong><span>{habits.length?Math.round(todayCheckins/habits.length*100):0}% of today's habits</span><div className="dashboard-habit-track"><span style={{width:(habits.length?todayCheckins/habits.length*100:0)+'%'}}/></div></div>
          {habits.length===0?<div className="dashboard-habit-empty"><Target size={18}/><span>No habits added yet.</span><button className="text-button" onClick={()=>setTab('habits')}>Create your first habit</button></div>:<div className="dashboard-habit-list">{habits.map(h=>{const entry=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate);const completed=!!entry?.completed;const inProgress=!completed&&(!!entry?.timerStartedAt||(h.trackingType==='measurable'&&(entry?.value||0)>0));const status=completed?'Completed':inProgress?'In progress':'Not started';const value=entry?.value||0;const percent=h.trackingType==='measurable'?Math.min(100,value/Math.max(1,h.targetValue||1)*100):0;return <div className="dashboard-habit-row" key={h.id}><div className="dashboard-habit-symbol">{completed?<CheckCircle2 size={17}/>:inProgress?<Clock3 size={17}/>:<Circle size={17}/>}</div><div className="dashboard-habit-detail"><strong>{h.emoji||'✦'} {h.name}</strong><span>{h.trackingType==='measurable'?value+' / '+(h.targetValue||0)+' '+(h.unit||''):'Daily check-in'}</span>{h.trackingType==='measurable'&&<div className="dashboard-habit-track"><span style={{width:percent+'%'}}/></div>}</div><span className={'dashboard-habit-status '+(completed?'is-done':inProgress?'is-progress':'is-pending')}>{status}</span>{h.trackingType==='measurable'?<button className="dashboard-habit-action" onClick={()=>setTab('habits')}>{completed?'View':'Log'}</button>:<button className={'dashboard-habit-action '+(completed?'is-done':'')} onClick={()=>toggleHabit(h)}>{completed?'Undo':'Done'}</button>}</div>})}</div>}</section>
        </>}
        {tab==='schedule'&&<><div className="page-heading"><div><div className="eyebrow">YOUR TIME, ALL 24 HOURS</div><h1>My timetable</h1><p>Recurring commitments, one-time events and flexible tasks in one place.</p></div><button className="primary-button" onClick={openBlockForm}><Plus size={18}/> Add commitment</button></div>
          <div className="schedule-date-row"><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-1);setSelectedDate(dateKey(d));setSmartMessage('');}}><ChevronLeft size={18}/></button><strong>{prettyDate(selectedDate,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</strong><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+1);setSelectedDate(dateKey(d));setSmartMessage('');}}><ChevronRight size={18}/></button><button className="text-button" onClick={()=>setSelectedDate(todayKey())}>Today</button></div>
          <div className="timetable-week-strip">{Array.from({length:7},(_,i)=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-d.getDay()+i);const key=dateKey(d);return <button key={key} className={key===selectedDate?'timetable-day selected':'timetable-day'} onClick={()=>setSelectedDate(key)}><span>{d.toLocaleDateString('en-IN',{weekday:'short'})}</span><strong>{d.getDate()}</strong></button>})}</div>
          <section className="schedule-planner-card timetable-tools"><div className="schedule-card-heading"><div><span className="eyebrow">SMART PLANNER</span><h2>Fill my free time</h2><p>Place unscheduled tasks around recurring commitments and timed tasks across the full day.</p></div><div className="schedule-spark">✦</div></div><button className="primary-button smart-plan-button" onClick={scheduleTasks} disabled={scheduling}>{scheduling?'Finding free time…':'✦  Auto-schedule tasks'}</button>{smartMessage&&<p className="schedule-message" role="status">{smartMessage}</p>}</section>
          {overdueTasks.length>0&&<section className="content-section overdue-panel"><div className="section-heading"><div><h2><span className="overdue-heading-dot"/> Overdue <span className="task-count overdue-count">{overdueTasks.length}</span></h2><p>Unfinished tasks from earlier dates or time slots. Move them into this day to schedule again.</p></div></div><div className="task-list">{overdueTasks.map(t=><div className="task-row overdue-task-row" key={t.id}><button type="button" className={"task-check schedule-task-check"+(t.completed?" is-checked":"")} title={t.completed?"Mark incomplete":"Mark complete"} aria-label={t.completed?"Mark incomplete":"Mark complete"} aria-pressed={t.completed} onClick={()=>toggleTask(t)}><span className="schedule-checkbox-mark">{t.completed?<Check size={15}/>:null}</span></button><button className="task-main" onClick={()=>openEditTask(t)}><strong>{t.title}</strong><small><span className="overdue-label">OVERDUE</span>{prettyDate(t.dueDate,{month:'short',day:'numeric'})}{t.dueTime?' · '+displayTime(t.dueTime):''} · {t.durationMinutes||60} min</small></button><div className="task-row-actions"><button className="secondary-button" onClick={async()=>{try{await updatePlannerTask(t.id,{dueDate:selectedDate,dueTime:'' });setSmartMessage('Overdue task moved to this day. You can now set a time or auto-schedule it.');}catch(error){console.error(error);setSmartMessage('Could not move the overdue task. Please try again.');}}}>Move to this day</button><button className="icon-button delete-button" title="Delete task" onClick={()=>handleDeleteTask(t.id)}><Trash2 size={16}/></button></div></div>)}</div></section>}
          <section className="content-section unscheduled-panel"><div className="section-heading"><div><h2>Tasks to schedule <span className="task-count">{unscheduledTasks.length}</span></h2><p>These tasks have no start time yet. Choose a time and duration when you are ready.</p></div></div>{unscheduledTasks.length===0?<div className="schedule-message">No tasks waiting for a time. Add a task without a start time, or leave its date blank, and it will appear here.</div>:<div className="task-list">{unscheduledTasks.map(t=><div className="task-row" key={t.id} draggable onDragStart={()=>setDragTaskId(t.id)} onDragEnd={()=>setDragTaskId('')}><button type="button" className={"task-check schedule-task-check"+(t.completed?" is-checked":"")} title={t.completed?"Mark incomplete":"Mark complete"} aria-label={t.completed?"Mark incomplete":"Mark complete"} aria-pressed={t.completed} onClick={()=>toggleTask(t)}><span className="schedule-checkbox-mark">{t.completed?<Check size={15}/>:null}</span></button><button className="task-main" onClick={()=>openEditTask(t)}><strong>{t.title}</strong><small><i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority} priority · {t.durationMinutes||60} min</small></button><div className="task-row-actions">{!t.completed&&<button className="secondary-button" onClick={()=>openEditTask(t)}>Set time</button>}<button className="icon-button delete-button" title="Delete task" onClick={()=>handleDeleteTask(t.id)}><Trash2 size={16}/></button></div></div>)}</div>}</section>
          <section className="content-section schedule-section"><div className="section-heading"><div><h2>24-hour timeline</h2><p>Each activity type has its own colour and label.</p></div></div><div className="timeline-legend"><span><i className="legend-class"/> Classes & commitments</span><span><i className="legend-task"/> Tasks</span><span><i className="legend-overdue"/> Overdue</span></div><div className="full-day-timeline">{Array.from({length:24},(_,hour)=>{const hourStart=hour*60;const label=hour===0?'12 AM':hour<12?hour+' AM':hour===12?'12 PM':(hour-12)+' PM';return <div className="timetable-hour" key={hour} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragTaskId)placeTaskAt(dragTaskId,minutesToTime(hourStart));}}><div className="timetable-hour-label">{label}</div><div className="timetable-hour-content"><button className="timetable-open-slot" onClick={()=>openNewTaskAt(minutesToTime(hourStart))}>＋ Add at {label}</button></div></div>})}{todaysTasks.filter(t=>!t.completed&&!!t.dueTime&&!isTaskOverdue(t,selectedDate,clockNow)).map(t=>{const start=timeToMinutes(t.dueTime!);const duration=t.durationMinutes||30;return <div className={duration<=15?"timetable-event task-event task-event-span task-event-compact":"timetable-event task-event task-event-span"} key={t.id} draggable onDragStart={()=>setDragTaskId(t.id)} onDragEnd={()=>setDragTaskId('')} style={{top:`calc(var(--hour-height) * ${start/60} + 7px)`,height:`max(30px, calc(var(--hour-height) * ${duration/60} - 4px))`}}><button className="timetable-complete" title="Mark complete" aria-label="Mark complete" onClick={()=>toggleTask(t)}><Circle size={17}/></button><button className="timetable-event-main" onClick={()=>openEditTask(t)}><span className="timeline-type-tag task-type-tag">{t.priority.toUpperCase()} PRIORITY TASK</span><strong>{t.title}</strong><span>{displayTime(t.dueTime!)} · {duration} min</span></button><div className="timetable-event-actions"><button title="Edit task" aria-label="Edit task" onClick={()=>openEditTask(t)}><Clock3 size={14}/></button><button title="Remove from schedule" aria-label="Remove from schedule" onClick={async()=>{try{await updatePlannerTask(t.id,{scheduledDate:'',dueTime:''});setSmartMessage('Task removed from the timetable and kept in your task list.');}catch(error){console.error(error);setSmartMessage('Could not remove this task from the timetable. Please try again.');}}}><CalendarDays size={15}/></button></div></div>})}{activeBlocks.map(x=>{const start=timeToMinutes(x.startTime);const duration=timeToMinutes(x.endTime)-start;return <div className="timetable-event fixed-event fixed-event-span" key={x.id} style={{top:`calc(var(--hour-height) * ${start/60} + 7px)`,height:`calc(var(--hour-height) * ${duration/60} - 14px)`}}><div><span className="timeline-type-tag class-type-tag">{x.repeat==='weekly'?'RECURRING COMMITMENT':'ONE-TIME COMMITMENT'}</span><strong>{x.title}</strong><span>{displayTime(x.startTime)}–{displayTime(x.endTime)} · {x.repeat==='weekly'?'Weekly':'One-time'}</span></div><div className="timetable-event-actions"><button title="Edit commitment" aria-label="Edit commitment" onClick={()=>openEditBlock(x)}><Clock3 size={14}/></button><button title="Delete commitment" aria-label="Delete commitment" onClick={()=>handleDeleteBlock(x.id)}><Trash2 size={15}/></button></div></div>})}</div></section>

        </>}
        {tab==='tasks'&&<><div className="page-heading"><div><div className="eyebrow">STAY ON TOP OF IT</div><h1>Your tasks</h1><p>Today, upcoming, and no-deadline tasks — all in one place.</p></div><button className="primary-button" onClick={()=>openNewTask(todayKey())}><Plus size={18}/> Add task</button></div><div className="task-tools"><label className="task-search"><Search size={17}/><input aria-label="Search tasks" placeholder="Search task names or notes…" value={taskQuery} onChange={e=>setTaskQuery(e.target.value)}/>{taskQuery&&<button type="button" onClick={()=>setTaskQuery('')} aria-label="Clear search"><X size={15}/></button>}</label><label className="task-tool-select"><span>Priority</span><select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value as 'All'|'High'|'Medium'|'Low')}><option>All</option><option>High</option><option>Medium</option><option>Low</option></select></label><label className="task-tool-select"><span>Sort</span><select value={taskSort} onChange={e=>setTaskSort(e.target.value as 'Date'|'Priority'|'Title')}><option>Date</option><option>Priority</option><option>Title</option></select></label></div><div className="filter-row">{(['All','Open','Completed'] as const).map(f=><button key={f} className={filter===f?'filter-pill selected':'filter-pill'} onClick={()=>setFilter(f)}>{f}{f==='All'&&<span>{tasks.length}</span>}</button>)}</div><TaskList tasks={visibleTasks} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} showDate emptyAction={()=>openNewTask(todayKey())}/></>}
        {tab==='internship'&&<><div className="page-heading"><div><div className="eyebrow">YOUR PROFESSIONAL WORKSPACE</div><h1>Internship</h1><p>Keep every assignment, follow-up and deadline in one place — separate from personal planning.</p></div><button className="primary-button" onClick={()=>openInternshipForm()}><Plus size={18}/> Add work</button></div><section className="internship-summary"><div><span>OPEN WORK</span><strong>{internshipTasks.filter(t=>!t.completed).length}</strong></div><div><span>OVERDUE</span><strong>{internshipTasks.filter(t=>!t.completed&&!!t.dueDate&&t.dueDate<todayKey()).length}</strong></div><div><span>COMPLETED</span><strong>{internshipTasks.filter(t=>t.completed).length}</strong></div></section><label className="task-search internship-search"><Search size={17}/><input aria-label="Search internship work" placeholder="Search internship work…" value={internshipSearch} onChange={e=>setInternshipSearch(e.target.value)}/>{internshipSearch&&<button type="button" onClick={()=>setInternshipSearch('')} aria-label="Clear search"><X size={15}/></button>}</label><div className="filter-row">{(['Open','Overdue','Completed','All'] as const).map(f=><button key={f} className={internshipFilter===f?'filter-pill selected':'filter-pill'} onClick={()=>setInternshipFilter(f)}>{f}<span>{f==='Open'?internshipTasks.filter(t=>!t.completed).length:f==='Overdue'?internshipTasks.filter(t=>!t.completed&&!!t.dueDate&&t.dueDate<todayKey()).length:f==='Completed'?internshipTasks.filter(t=>t.completed).length:internshipTasks.length}</span></button>)}</div><div className="internship-work-list">{internshipTasks.filter(t=>(internshipFilter==='All'||(internshipFilter==='Open'?!t.completed:internshipFilter==='Completed'?t.completed:!t.completed&&!!t.dueDate&&t.dueDate<todayKey()))&&(!internshipSearch.trim()||t.title.toLowerCase().includes(internshipSearch.toLowerCase())||(t.notes||'').toLowerCase().includes(internshipSearch.toLowerCase()))).sort((a,b)=>{if(a.completed!==b.completed)return a.completed?1:-1;if(!a.dueDate)return 1;if(!b.dueDate)return -1;return a.dueDate.localeCompare(b.dueDate);}).map(task=><article className={'internship-work-card'+(task.completed?' completed':'')} key={task.id}><button className="task-check" type="button" aria-label={task.completed?'Mark incomplete':'Mark complete'} onClick={()=>toggleInternshipTask(task)}>{task.completed?<Check size={15}/>:<Circle size={19}/>}</button><button className="internship-work-main" type="button" onClick={()=>openInternshipForm(task)}><strong>{task.title}</strong>{task.notes&&<span>{task.notes}</span>}<small>{task.dueDate?<><CalendarDays size={13}/>{prettyDate(task.dueDate,{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</>:<><CalendarDays size={13}/>No deadline set</>}{!task.completed&&task.dueDate<todayKey()&&<em>OVERDUE</em>}<i className={'priority-dot '+task.priority.toLowerCase()}/>{task.priority} priority</small></button><button type="button" className="icon-button delete-button" aria-label="Delete internship work" onClick={()=>removeInternshipTask(task)}><Trash2 size={16}/></button></article>)}{internshipTasks.filter(t=>(internshipFilter==='All'||(internshipFilter==='Open'?!t.completed:internshipFilter==='Completed'?t.completed:!t.completed&&!!t.dueDate&&t.dueDate<todayKey()))&&(!internshipSearch.trim()||t.title.toLowerCase().includes(internshipSearch.toLowerCase())||(t.notes||'').toLowerCase().includes(internshipSearch.toLowerCase()))).length===0&&<div className="empty-state"><div className="empty-icon"><BriefcaseBusiness size={23}/></div><strong>No internship work here</strong><p>Add an assignment or follow-up with its deadline. Your personal tasks will stay separate.</p><button className="secondary-button" onClick={()=>openInternshipForm()}><Plus size={16}/> Add internship work</button></div>}</div></>}
        {tab==='upcoming'&&<><div className="page-heading"><div><div className="eyebrow">PLAN AHEAD, STAY FLEXIBLE</div><h1>Upcoming</h1><p>Your next 14 days of unfinished tasks, organised by date.</p></div><button className="primary-button" onClick={()=>openNewTask(todayKey())}><Plus size={18}/> Add task</button></div>{upcomingDays.length===0?<div className="empty-state"><div className="empty-icon"><CalendarRange size={23}/></div><strong>Nothing coming up</strong><p>Add a task with a future date and it will appear here.</p><button className="secondary-button" onClick={()=>openNewTask(todayKey())}><Plus size={16}/> Add a task</button></div>:upcomingDays.map(day=><section className="content-section" key={day.key}><div className="section-heading"><div><h2>{day.label}</h2><p>{day.items.length} task{day.items.length===1?'':'s'} planned</p></div></div><TaskList tasks={day.items} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} showDate emptyAction={()=>openNewTask(day.key)}/></section>)}</>}
        {tab==='habits'&&<><div className="page-heading"><div><div className="eyebrow">CONSISTENCY OVER PERFECTION</div><h1>Your habits</h1><p>Build good habits and leave unwanted habits behind.</p></div><button className="primary-button" onClick={()=>{setHabitReminderTime('');setHabitReminderMinutesBefore(10);setHabitOpen(true);}}><Plus size={18}/> Add habit</button></div><div className="habit-date-note"><CalendarDays size={17}/> Check in for <strong>{prettyDate(selectedDate)}</strong><button className="text-button" onClick={()=>setSelectedDate(todayKey())}>Go to today</button></div><div className="timetable-week-strip habit-week-strip">{Array.from({length:7},(_,i)=>{const d=new Date(mondayWeekStart(selectedDate)+"T12:00:00");d.setDate(d.getDate()+i);const key=dateKey(d);return <button type="button" key={key} className={key===selectedDate?"timetable-day selected":"timetable-day"} onClick={()=>setSelectedDate(key)}><span>{d.toLocaleDateString("en-IN",{weekday:"short"})}</span><strong>{d.getDate()}</strong></button>})}</div>{habitError&&<div className="habit-error-banner" role="alert">{habitError}</div>}<HabitList habits={habits} checkins={checkins} date={selectedDate} now={clockNow} onToggle={toggleHabit} onSkip={skipHabit} onSkipLimitChange={changeHabitSkipLimit} onRecord={recordHabitValue} onTimerStart={startHabitTimer} onTimerStop={stopHabitTimer} onDelete={handleDeleteHabit}/></>}
        {tab==='progress'&&<><div className="page-heading"><div><div className="eyebrow">NOTICE YOUR MOMENTUM</div><h1>Your progress</h1><p>Look back, learn, and keep moving forward.</p></div></div><section className="overview-grid progress-overview"><div className="overview-card"><div className="card-topline"><span>TOTAL TASKS DONE</span><CheckCircle2 size={17}/></div><strong className="stat-number">{tasks.filter(t=>t.completed).length}</strong><p className="stat-caption">Every completed task counts.</p></div><div className="overview-card"><div className="card-topline"><span>ACTIVE HABITS</span><Target size={17}/></div><strong className="stat-number">{habits.length}</strong><p className="stat-caption">Routines you're building.</p></div><div className="overview-card"><div className="card-topline"><span>HABIT CHECK-INS</span><Flame size={17}/></div><strong className="stat-number">{checkins.filter(c=>c.completed).length}</strong><p className="stat-caption">Small wins, added up.</p></div></section><section className="content-section"><div className="section-heading"><div><h2>Habit rewards</h2><p>Earn points for completed daily habits. Each habit can earn points once per day.</p></div></div><div className="overview-grid progress-overview"><div className="overview-card"><span className="habit-summary-label">TOTAL XP</span><strong className="stat-number">{checkins.filter(c=>c.completed).reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0)}</strong><p className="stat-caption">10 XP for check-ins · 15 XP for measurable targets.</p></div><div className="overview-card"><span className="habit-summary-label">CURRENT STREAK</span><strong className="stat-number">{(()=>{let n=0;const d=new Date();const today=dateKey(d);const completedDays=new Set(checkins.filter(c=>c.completed).map(c=>c.date));if(!completedDays.has(today)){d.setDate(d.getDate()-1);}while(completedDays.has(dateKey(d))){n++;d.setDate(d.getDate()-1);}return n;})()}</strong><p className="stat-caption">Consecutive days with at least one completed habit.</p></div><div className="overview-card"><span className="habit-summary-label">LEVEL</span><strong className="stat-number">{Math.floor(checkins.filter(c=>c.completed).reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0)/100)+1}</strong><p className="stat-caption">100 XP per level. Keep building consistency.</p></div></div><div className="habit-list"><div className="habit-row"><div className="habit-emoji">🏅</div><div className="habit-info"><strong>First win</strong><span>{checkins.some(c=>c.completed)?'Unlocked · Complete your first habit':'Locked · Complete any habit once'}</span></div></div><div className="habit-row"><div className="habit-emoji">🔥</div><div className="habit-info"><strong>7 active days</strong><span>{(()=>{const days=new Set(checkins.filter(c=>c.completed).map(c=>c.date));return [...days].length>=7?'Unlocked · Habits completed on 7 different days':'Locked · Complete habits on 7 different days';})()}</span></div></div><div className="habit-row"><div className="habit-emoji">⭐</div><div className="habit-info"><strong>500 XP milestone</strong><span>{checkins.filter(c=>c.completed).reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0)>=500?'Unlocked · 500 XP earned':'Locked · Reach 500 XP'}</span></div></div></div></section><section className="content-section chart-section"><div className="section-heading"><div><h2>Last 7 days</h2><p>Tasks completed each day.</p></div></div><div className="weekly-chart">{week.map(d=><div className="chart-column" key={d.key}><div className="chart-value">{d.done}/{d.total}</div><div className="chart-bar-area"><div className="chart-bar" style={{height:(d.total?Math.max(6,d.done/d.total*100):0)+'%'}}/></div><span>{d.label}</span></div>)}</div></section><section className="content-section chart-section"><div className="section-heading"><div><h2>Habit history · Last 90 days</h2><p>Each square is one day. Green shows completed habits; amber marks a day when a skip was used.</p></div></div><div className="overview-grid progress-overview"><div className="overview-card"><span className="habit-summary-label">COMPLETION RATE</span><strong className="stat-number">{history90Possible?Math.round(history90Completed/history90Possible*100):0}%</strong><p className="stat-caption">{history90Completed} completed out of {history90Possible} habit-days.</p></div><div className="overview-card"><span className="habit-summary-label">SKIPS USED</span><strong className="stat-number">{history90Skips}</strong><p className="stat-caption">Skips protect streaks but do not earn XP.</p></div></div><div style={{display:'grid',gridTemplateColumns:'repeat(15,minmax(0,1fr))',gap:5,marginTop:16}}>{habitHistory90.map(day=><div key={day.key} title={day.key+': '+day.completed+' completed, '+day.skipped+' skipped, '+Math.max(0,day.total-day.completed-day.skipped)+' missed'} style={{aspectRatio:'1',minWidth:0,borderRadius:4,background:day.total===0?'var(--surface-muted, #e8e8e8)':day.skipped>0&&day.completed===0?'#d6ad55':day.percent>=100?'#397c59':day.percent>=50?'#83b997':day.percent>0?'#c3dfcb':'var(--surface-muted, #e8e8e8)'}} aria-label={day.key+' habit progress'} />)}</div><div style={{display:'flex',gap:14,flexWrap:'wrap',fontSize:12,marginTop:12,color:'var(--text-muted, #777)'}}><span>■ Completed</span><span style={{color:'#d6ad55'}}>■ Skip used</span><span>■ No completion</span></div></section></>}
        {tab==='settings'&&<><div className="page-heading"><div><div className="eyebrow">MAKE KRAM YOURS</div><h1>Settings</h1><p>Manage your app preferences and reminders.</p></div></div><section className="content-section settings-section"><div className="section-heading"><div><h2>Appearance</h2><p>Choose how KRAM looks on this device.</p></div></div><div className="settings-list"><div className="settings-row"><div className="settings-icon"><Palette size={19}/></div><div className="settings-copy"><strong>Theme</strong><span>{dark?'Dark appearance':'Light appearance'}</span></div><button type="button" className="secondary-button" onClick={()=>setDark(!dark)}>{dark?<Sun size={16}/>:<Moon size={16}/>} Switch to {dark?'light':'dark'}</button></div></div></section><section className="content-section settings-section"><div className="section-heading"><div><h2>Privacy & lock</h2><p>Protect KRAM with your own four-block password.</p></div></div><div className="settings-list"><div className="settings-row"><div className="settings-icon"><ShieldCheck size={19}/></div><div className="settings-copy"><strong>{blockLockHash?'Four-block lock is on':'Four-block app lock'}</strong><span>{blockLockHash?'KRAM asks for your block password when you reopen the app.':'Tap the four areas in any sequence. Repeating a block is allowed.'}</span></div><button type="button" className="secondary-button" onClick={startBlockLockSetup}>{blockLockHash?'Change lock':'Set up lock'}</button></div></div></section><section className="content-section settings-section"><div className="section-heading"><div><h2>Notifications & updates</h2><p>Control reminders, sound, vibration and app updates.</p></div></div><div className="settings-list"><button type="button" className="settings-row settings-action" onClick={()=>setAlertsOpen(true)}><div className="settings-icon"><BellRing size={19}/></div><div className="settings-copy"><strong>Reminder settings</strong><span>{notificationsEnabled?'Notifications enabled':'Notifications not enabled'} · Sound and vibration</span></div><ChevronRight size={18}/></button><button type="button" className="settings-row settings-action" onClick={()=>setAlertsOpen(true)}><div className="settings-icon"><Smartphone size={19}/></div><div className="settings-copy"><strong>App updates</strong><span>Check for and install the latest KRAM version</span></div><ChevronRight size={18}/></button></div></section><section className="content-section settings-section"><div className="section-heading"><div><h2>Account</h2><p>Your signed-in KRAM account.</p></div></div><div className="settings-list"><div className="settings-row"><div className="settings-icon"><ShieldCheck size={19}/></div><div className="settings-copy"><strong>{user.displayName||'My planner'}</strong><span>{user.email}</span></div><button type="button" className="secondary-button sign-out-button" onClick={()=>{if(window.confirm('Sign out of KRAM? Your synced planner data will remain in your account.'))void signOut(auth);}}>Sign out</button></div></div></section><p className="settings-version">KRAM Personal Planner · Your data stays synced to your account.</p></>}
      </div>
    </main>
     {(blockLockSetup||isLocked)&&<div className="block-lock-screen"><div className="block-lock-glow"/><div className="block-lock-panel"><div className="block-lock-mark"><img src="/kram-icon.svg" alt="KRAM"/></div><div className="eyebrow">{blockLockSetup?'DEVICE SECURITY':'WELCOME BACK'}</div><h2>{blockLockSetup?(blockLockStage==='create'?'Create your block lock':'Confirm your block lock'):'KRAM is locked'}</h2><p>{blockLockSetup?(blockLockStage==='create'?'Tap the four areas in your chosen order. You can repeat any area.':'Repeat the same taps to confirm your password.'):'Enter your four-block password to continue.'}</p><div className="block-lock-grid" role="group" aria-label="Four block password">{[0,1,2,3].map(index=><button key={index} type="button" aria-label={['Top left block','Top right block','Bottom left block','Bottom right block'][index]} className={((blockLockSetup?blockLockSequence:unlockSequence).includes(index)?'selected':'')} onClick={()=>tapLockBlock(index,blockLockSetup?'setup':'unlock')}/>)}</div><div className="block-lock-dots" aria-label={(blockLockSetup?blockLockSequence:unlockSequence).length+' taps entered'}>{Array.from({length:Math.max(4,(blockLockSetup?blockLockSequence:unlockSequence).length)},(_,i)=><span key={i} className={i<(blockLockSetup?blockLockSequence:unlockSequence).length?'filled':''}/>)}</div>{blockLockError&&<p className="block-lock-error" role="alert">{blockLockError}</p>}<div className="block-lock-actions"><button type="button" className="secondary-button" onClick={()=>{if(blockLockSetup){if(blockLockStage==='confirm'){setBlockLockStage('create');setBlockLockFirst([]);}setBlockLockSequence([]);setBlockLockError('');}else{setUnlockSequence([]);setBlockLockError('');}}}>Clear</button><button type="button" className="primary-button" onClick={()=>void finishBlockLockEntry()}>{blockLockSetup?(blockLockStage==='create'?'Continue':'Save lock'):'Unlock'}</button></div>{blockLockSetup&&<button type="button" className="text-button block-lock-cancel" onClick={()=>setBlockLockSetup(false)}>Cancel</button>}</div></div>}
    {alertsOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setAlertsOpen(false)}}><section className="modal-card"><div className="modal-heading"><div><div className="eyebrow">KRAM ALERTS</div><h2>Notification settings</h2></div><button type="button" className="icon-button" aria-label="Close notification settings" onClick={()=>setAlertsOpen(false)}><X size={19}/></button></div><p className="alert-settings-copy">Allow KRAM to send task and habit reminders. Android reminders are scheduled on your device and can appear when KRAM is closed.</p><button type="button" className="primary-button alert-enable" onClick={async()=>{let enabled=false;if(Capacitor.isNativePlatform()){const permission=await LocalNotifications.requestPermissions();enabled=permission.display==='granted';if(enabled){const exact=await LocalNotifications.checkExactNotificationSetting();if(exact.exact_alarm!=='granted'){const updated=await LocalNotifications.changeExactNotificationSetting();if(updated.exact_alarm!=='granted')setSmartMessage('Please allow KRAM under Android Settings → Alarms & reminders so reminders can run on time.');}}}else{if(!('Notification' in window)){setSmartMessage('This browser does not support notifications.');return;}enabled=(await Notification.requestPermission())==='granted';}setNotificationsEnabled(enabled);localStorage.setItem('KRAM-notifications',enabled?'on':'off');setSmartMessage(enabled?'Notifications enabled.':'Notification permission was not granted.');}}>{notificationsEnabled?'✓ ':''}{Capacitor.isNativePlatform()?'Enable Android notifications':'Enable browser notifications'}</button>{notificationsEnabled&&<button type="button" className="secondary-button alert-enable" onClick={sendTestNotification}>Send test notification</button>}<p className="alert-settings-note" role="status">{smartMessage}</p><label className="alert-toggle"><span><strong>Alert sound</strong><small>Play a short tone when a reminder appears</small></span><input type="checkbox" checked={soundEnabled} onChange={e=>{setSoundEnabled(e.target.checked);localStorage.setItem('KRAM-sound',e.target.checked?'on':'off');}}/></label><label className="alert-toggle"><span><strong>Touch haptics & reminders</strong><small>Subtle feedback when you tap or complete actions, plus reminder vibration</small></span><input type="checkbox" checked={vibrationEnabled} onChange={e=>{setVibrationEnabled(e.target.checked);localStorage.setItem('KRAM-vibration',e.target.checked?'on':'off');}}/></label><p className="alert-settings-note">On Android, reminders are scheduled locally on your device. Keep notification permission enabled in Android Settings. Web reminders may pause when the browser is closed.</p>{Capacitor.getPlatform()==='android'&&<section className="app-update-panel"><div><strong>App updates</strong><p>{updateAvailable?'KRAM '+updateAvailable.version+' is ready to install.':'Check whether a newer version of KRAM is available.'}</p></div>{updateAvailable?<button type="button" className="primary-button" onClick={downloadAndInstallKramUpdate} disabled={updateBusy}>{updateBusy?(updateProgress>0&&updateProgress<100?'Downloading '+updateProgress+'%…':'Preparing update…'):downloadedUpdatePath?'Install update':'Download & install'}</button>:<button type="button" className="secondary-button" onClick={checkForKramUpdate} disabled={updateChecking}>{updateChecking?'Checking…':'Check for updates'}</button>}{updateMessage&&<p className="app-update-message" role="status">{updateMessage}</p>}{updateAvailable&&<button type="button" className="text-button" onClick={checkForKramUpdate} disabled={updateChecking}>Check again</button>}</section>}<div className="modal-actions"><button type="button" className="primary-button" onClick={()=>setAlertsOpen(false)}>Done</button></div></section></div>}
    {taskOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setTaskOpen(false)}}><form className="modal-card task-form-card" onSubmit={saveTask}><div className="modal-heading"><div><div className="eyebrow">{editing?'UPDATE TASK':'MAKE IT HAPPEN'}</div><h2>{editing?'Edit task':'New task'}</h2><p className="modal-subtitle">A few details now make it easier to follow through later.</p></div><button type="button" className="icon-button" aria-label="Close task form" onClick={()=>setTaskOpen(false)}><X size={19}/></button></div><p className="form-intro">Capture the task first. Add timing and reminders only if you need them.</p><div className="form-section-label">What needs to get done?</div><label>Task name<input autoFocus required maxLength={120} placeholder="e.g. Finish marketing assignment" value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Notes <span className="optional">Optional</span><textarea rows={3} placeholder="Add details, links or anything to remember…" value={notes} onChange={e=>setNotes(e.target.value)}/></label><div className="form-section-label">When should it happen?</div><div className="form-two"><label>Due date <span className="optional">Optional — leave blank if you have no deadline</span><input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label><label>Start time <span className="optional">Optional</span><input type="time" value={dueTime} onChange={e=>{setDueTime(e.target.value);if(e.target.value&&!scheduleDate)setScheduleDate(selectedDate);if(e.target.value&&!endTime)setEndTime(minutesToTime(timeToMinutes(e.target.value)+30));}}/></label></div><div className="form-section-label">Reminder</div><label>Remind me<select value={reminderMinutesBefore} onChange={e=>setReminderMinutesBefore(Number(e.target.value))}><option value={-1}>No reminder</option><option value={0}>At task time</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option></select>{!dueTime&&reminderMinutesBefore!==-1&&<span className="optional">Set a start time above for this reminder to work.</span>}</label>{dueTime&&<><label>Plan for<input type="date" value={scheduleDate} onChange={e=>setScheduleDate(e.target.value)} required/></label><label>End time<input type="time" value={endTime} min={dueTime||undefined} onChange={e=>setEndTime(e.target.value)}/><span className="optional">Choose when you expect this task to finish.</span></label></>}<div className="form-section-label">Personalise this task</div><label>Priority<select value={priority} onChange={e=>setPriority(e.target.value as 'High'|'Medium'|'Low')}><option>Low</option><option>Medium</option><option>High</option></select></label><label>Repeat<select value={repeat} onChange={e=>setRepeat(e.target.value as NonNullable<Task['repeat']>)}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option><option value="weekly">Every week</option></select></label>{taskError&&<div className="auth-error" role="alert">{taskError}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setTaskOpen(false)} disabled={savingTask}>Cancel</button><button className="primary-button" type="submit" disabled={savingTask}>{savingTask?'Saving…':editing?'Save changes':'Add task'}</button></div></form></div>}
    {internshipFormOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setInternshipFormOpen(false)}}><form className="modal-card internship-form-card" onSubmit={saveInternshipTask}><div className="modal-heading"><div><div className="eyebrow">INTERNSHIP WORK</div><h2>{internshipEditing?'Edit work':'Add internship work'}</h2><p className="modal-subtitle">Track an assignment, follow-up or task with its deadline.</p></div><button type="button" className="icon-button" aria-label="Close form" onClick={()=>setInternshipFormOpen(false)}><X size={19}/></button></div><label>What do you need to do?<input autoFocus required maxLength={120} placeholder="e.g. Prepare weekly performance report" value={internshipTitle} onChange={e=>setInternshipTitle(e.target.value)}/></label><label>Details <span className="optional">Optional</span><textarea rows={3} placeholder="Add instructions, links or notes…" value={internshipNotes} onChange={e=>setInternshipNotes(e.target.value)}/></label><label>Deadline <span className="optional">Optional</span><input type="date" value={internshipDeadline} onChange={e=>setInternshipDeadline(e.target.value)}/></label><label>Priority<select value={internshipPriority} onChange={e=>setInternshipPriority(e.target.value as 'High'|'Medium'|'Low')}><option>Low</option><option>Medium</option><option>High</option></select></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setInternshipFormOpen(false)}>Cancel</button><button type="submit" className="primary-button">{internshipEditing?'Save changes':'Add to internship'}</button></div></form></div>}
    {blockOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setBlockOpen(false)}}><form className="modal-card" onSubmit={saveBlock}><div className="modal-heading"><div><div className="eyebrow">PROTECT YOUR TIME</div><h2>{editingBlock?'Edit commitment':'New commitment'}</h2></div><button type="button" className="icon-button" onClick={()=>setBlockOpen(false)}><X size={19}/></button></div><label>Name<input autoFocus required maxLength={100} placeholder="e.g. College, Gym, Internship" value={blockTitle} onChange={e=>setBlockTitle(e.target.value)}/></label><div className="form-two"><label>Start<input type="time" required value={blockStart} onChange={e=>setBlockStart(e.target.value)}/></label><label>End<input type="time" required value={blockEnd} onChange={e=>setBlockEnd(e.target.value)}/></label></div><label>Repeat<select value={blockRepeat} onChange={e=>setBlockRepeat(e.target.value as 'weekly'|'once')}><option value="weekly">Every week</option><option value="once">Specific date only</option></select></label>{blockRepeat==='weekly'?<div className="block-day-picker"><span>Repeat on</span><div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=><button type="button" key={day} className={blockDays.includes(i)?'block-day active':'block-day'} onClick={()=>toggleBlockDay(i)}>{day}</button>)}</div></div>:<label>Date<input type="date" required value={blockDate} onChange={e=>setBlockDate(e.target.value)}/></label>}{blockError&&<div className="auth-error" role="alert">{blockError}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setBlockOpen(false)}>Cancel</button><button className="primary-button" type="submit">{editingBlock?'Save changes':'Save commitment'}</button></div></form></div>}
    {habitOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setHabitOpen(false)}}><form className="modal-card habit-form-card" onSubmit={addHabit}><div className="modal-heading"><div><div className="eyebrow">BUILD A ROUTINE</div><h2>Add a habit</h2><p className="modal-subtitle">Choose a simple routine and a way to track your progress.</p></div><button type="button" className="icon-button" aria-label="Close add habit" onClick={()=>setHabitOpen(false)}><X size={19}/></button></div><p className="form-intro">Start with a routine you can repeat. You can change its tracking and reminders later.</p><div className="form-section-label">Habit details</div><label>What is your goal?<select value={habitGoalType} onChange={e=>setHabitGoalType(e.target.value as 'build'|'quit')}><option value="build">Build a good habit</option><option value="quit">Quit a bad habit</option></select><span className="optional">For example: build reading daily, or quit smoking / reduce social media.</span></label><label>Habit name<input autoFocus required maxLength={80} placeholder="e.g. Read, exercise, drink water" value={habitName} onChange={e=>setHabitName(e.target.value)}/></label><div className="emoji-picker" role="group" aria-label="Choose a habit icon">{['✦','📚','💧','🏃','🧘','💪','🌱','🙏'].map(emoji=><button type="button" key={emoji} className={habitEmoji===emoji?'emoji-choice selected':'emoji-choice'} aria-pressed={habitEmoji===emoji} aria-label={'Choose '+emoji+' icon'} onClick={()=>setHabitEmoji(emoji)}>{emoji}</button>)}</div><label>How do you want to track it?<select value={habitTrackingType} onChange={e=>setHabitTrackingType(e.target.value as "check"|"measurable")}><option value="check">Simple check-in</option><option value="measurable">Measurable target</option></select></label><div className="form-section-label">Flexibility & reminders</div><div className="form-two"><label>Allowed skips per week<select value={habitAllowedSkips} onChange={e=>setHabitAllowedSkips(Number(e.target.value))}>{Array.from({length:8},(_,i)=><option key={i} value={i}>{i} {i===1?'skip':'skips'}</option>)}</select><span className="optional">Resets every Monday. Default: 1.</span></label><label>Daily reminder time <span className="optional">Optional</span><input type="time" value={habitReminderTime} onChange={e=>setHabitReminderTime(e.target.value)}/></label><label>Remind me<select value={habitReminderMinutesBefore} onChange={e=>setHabitReminderMinutesBefore(Number(e.target.value))} disabled={!habitReminderTime}><option value={0}>At reminder time</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option></select></label></div>{habitTrackingType==="measurable"&&<><div className="form-section-label">Daily target</div><div className="form-two"><label>Target value<input required type="number" min="0.01" step="any" value={habitTarget} onChange={e=>setHabitTarget(e.target.value)} placeholder="e.g. 30"/></label><label>Unit<select value={habitUnit} onChange={e=>setHabitUnit(e.target.value)}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="litres">Litres</option><option value="pages">Pages</option><option value="steps">Steps</option><option value="sessions">Sessions</option><option value="reps">Reps</option></select></label></div></>}{habitError&&<p className="quick-add-error" role="alert">{habitError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setHabitOpen(false)}>Cancel</button><button className="primary-button" type="submit">Add habit</button></div></form></div>}
    <nav className="bottom-nav">{navItems.filter(([id])=>id!=='settings').map(([id,label,Icon])=><button key={id} className={tab===id?'bottom-item active':'bottom-item'} onClick={()=>setTab(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
  </div>;
}

function TaskList({tasks,onToggle,onEdit,onDelete,showDate=false,emptyAction}:{tasks:Task[];onToggle:(t:Task)=>void;onEdit:(t:Task)=>void;onDelete:(id:string)=>void;showDate?:boolean;emptyAction:()=>void}) {
 return <div className="task-list">{tasks.length===0?<div className="empty-state"><div className="empty-icon"><CheckCircle2 size={23}/></div><strong>Nothing on your list</strong><p>Enjoy the breathing room, or add a task when you're ready.</p><button className="secondary-button" onClick={emptyAction}><Plus size={16}/> Add your first task</button></div>:tasks.map(t=><div className={t.completed?'task-row completed':'task-row'} key={t.id}><button className="task-check" onClick={()=>onToggle(t)} aria-label={t.completed?'Mark incomplete':'Complete task'}>{t.completed?<Check size={15}/>:<Circle size={19}/>}</button><button className="task-main" onClick={()=>onEdit(t)}><strong>{t.title}</strong>{t.notes&&<span>{t.notes}</span>}<small>{showDate&&<><CalendarDays size={12}/>{t.dueDate?prettyDate(t.dueDate,{month:'short',day:'numeric'}):'No due date'} · </>}{isTaskOverdue(t)&&<span className="overdue-label">OVERDUE</span>}{t.dueTime&&<><Clock3 size={12}/>{t.dueTime} · </>}<i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority} priority</small></button><button className="icon-button delete-button" title="Delete task" onClick={()=>onDelete(t.id)}><Trash2 size={16}/></button></div>)}</div>;
}
function HabitList({habits,checkins,date,now,onToggle,onSkip,onSkipLimitChange,onRecord,onTimerStart,onTimerStop,onDelete}:{habits:Habit[];checkins:Checkin[];date:string;now:Date;onToggle:(h:Habit)=>void;onSkip:(h:Habit)=>void;onSkipLimitChange:(h:Habit,value:number)=>void;onRecord:(h:Habit,value:number)=>void;onTimerStart:(h:Habit)=>void;onTimerStop:(h:Habit)=>void;onDelete?:(id:string)=>void}) {
 const [values,setValues]=useState<Record<string,string>>({});
 const [expandedHabitId,setExpandedHabitId]=useState<string|null>(null);
 const active=habits;
 const done=active.filter(h=>checkins.some(c=>c.habitId===h.id&&c.date===date&&c.completed)).length;
 const activeTimer=checkins.find(c=>!!c.timerStartedAt&&c.date===todayKey());
 return <><div className="habit-list">{active.length===0?<div className="empty-state"><div className="empty-icon"><Target size={23}/></div><strong>No habits yet</strong><p>Add a good habit to build or an unwanted habit you want to quit.</p></div>:active.map(h=>{const entry=checkins.find(c=>c.habitId===h.id&&c.date===date);const isDone=!!entry?.completed;const isSkipped=!!entry?.skipped;const weekStart=mondayWeekStart(date);const usedSkips=checkins.filter(c=>c.habitId===h.id&&c.skipped&&c.date>=weekStart&&c.date<=date).length;const skipLimit=Math.max(0,Math.min(7,h.allowedSkipsPerWeek??1));const streak=habitStreak(h.id,checkins,date);const measurable=h.trackingType==="measurable";const timerEligible=!measurable||h.unit==="minutes"||h.unit==="hours";const running=!!entry?.timerStartedAt;const elapsed=(entry?.elapsedSeconds||0)+(running?Math.max(0,Math.floor((now.getTime()-new Date(entry!.timerStartedAt!).getTime())/1000)):0);const expanded=expandedHabitId===h.id;const status=isDone?"Completed":isSkipped?"Skipped":entry?.timerStartedAt?"In progress":"Not started";return <div className="habit-row habit-row-expanded" key={h.id} style={{flexWrap:"wrap"}}><button type="button" className="habit-emoji" aria-label={expanded?"Hide habit details":"Show habit details"} onClick={()=>setExpandedHabitId(expanded?null:h.id)}>{h.emoji||"✦"}</button><button type="button" className="habit-info" onClick={()=>setExpandedHabitId(expanded?null:h.id)} style={{textAlign:"left",background:"transparent",border:0,padding:0,cursor:"pointer",minWidth:0}}><strong>{h.name}</strong><span>{h.goalType==='quit'?'Quit habit · ': 'Build habit · '}{status} · {measurable?"Target: "+(h.targetValue||0)+" "+(h.unit||"units"):"Daily check-in"}</span></button><button type="button" className="text-button" onClick={()=>setExpandedHabitId(expanded?null:h.id)}>{expanded?"Hide details":"Details"} <span aria-hidden="true">{expanded?"−":"+"}</span></button>{expanded&&<div style={{flexBasis:"100%",padding:"8px 4px 4px 44px",display:"grid",gap:12}}><div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:13}}><span>🔥 {streak} day streak</span><span>{Math.max(0,skipLimit-usedSkips)} of {skipLimit} weekly skips left</span></div><label style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>Weekly skip allowance<select aria-label={"Weekly skips allowed for "+h.name} value={skipLimit} onChange={e=>onSkipLimitChange(h,Number(e.target.value))} style={{width:68,padding:"5px"}}>{Array.from({length:8},(_,i)=><option key={i} value={i}>{i}</option>)}</select></label>{measurable&&<><div className="habit-measure-row"><input aria-label={"Progress for "+h.name} type="number" min="0" step="any" placeholder={h.unit||"Value"} value={values[h.id]??(entry?.value!==undefined?String(entry.value):"")} onChange={e=>setValues(v=>({...v,[h.id]:e.target.value}))}/><button className="habit-check" type="button" onClick={()=>onRecord(h,Number(values[h.id]??entry?.value??0))}>Save progress</button></div><div className="habit-progress-track"><span style={{width:Math.min(100,(entry?.value||0)/Math.max(1,h.targetValue||1)*100)+"%"}}/></div></>}{date===todayKey()&&timerEligible&&<div className="habit-timer-row"><span>{running?"Timer running · ":"Timer · "}{Math.floor(elapsed/3600).toString().padStart(2,"0")}:{Math.floor(elapsed%3600/60).toString().padStart(2,"0")}:{(elapsed%60).toString().padStart(2,"0")}</span>{running?<button className="habit-check checked" type="button" onClick={()=>onTimerStop(h)}>Stop & save</button>:<button className="habit-check" type="button" disabled={!!activeTimer} onClick={()=>onTimerStart(h)}>{activeTimer?"Another timer is running":"Start timer"}</button>}</div>}<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{!measurable&&<button className={isDone?"habit-check checked":"habit-check"} type="button" onClick={()=>onToggle(h)}>{isDone?<><Check size={16}/> {h.goalType==='quit'?'Avoided':'Done'}</>:h.goalType==='quit'?'Stayed away today':'Check in'}</button>}<button type="button" className={isSkipped?"habit-check checked":"habit-check"} disabled={isDone||(!isSkipped&&usedSkips>=skipLimit)} onClick={()=>onSkip(h)}>{isSkipped?"Undo skip":"Skip today"}</button>{onDelete&&<button type="button" className="secondary-button" onClick={()=>onDelete(h.id)}>Delete habit</button>}</div></div>}</div>})}</div><p className="stat-caption" style={{marginTop:10}}>{done} of {active.length} habits completed · Tap a habit to see its options.</p></>;
}