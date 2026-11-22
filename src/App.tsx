import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import Auth from './components/Auth';
import { createPlannerTask, createRecurringPlannerOccurrence, updatePlannerTask, deletePlannerTask, subscribePlannerTasks, createPlannerBlock, updatePlannerBlock, deletePlannerBlock, subscribePlannerBlocks, createPlannerHabit, deletePlannerHabit, subscribePlannerHabits, setPlannerHabitCheckin, subscribePlannerCheckins } from './lib/plannerDb';
import { Bell, CalendarDays, CalendarRange, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Flame, LayoutDashboard, ListTodo, LogOut, Menu, Moon, Plus, Search, Sun, Target, Trash2, TrendingUp, X } from 'lucide-react';

type Task = { id:string; userId:string; title:string; notes?:string; dueDate:string; dueTime?:string; durationMinutes?:number; reminderMinutesBefore?:number; priority:'High'|'Medium'|'Low'; repeat?:'none'|'daily'|'weekdays'|'weekly'; lastGeneratedDate?:string; completed:boolean; createdAt:string };
type Habit = { id:string; userId:string; name:string; emoji:string; trackingType?:'check'|'measurable'; targetValue?:number; unit?:string; reminderTime?:string; reminderMinutesBefore?:number; createdAt:string };
type ScheduleBlock = { id:string; userId:string; title:string; startTime:string; endTime:string; repeat:'weekly'|'once'; days:number[]; date?:string; createdAt:string };
type Checkin = { id:string; userId:string; habitId:string; date:string; completed:boolean; value?:number; timerStartedAt?:string; elapsedSeconds?:number };
type Tab = 'today'|'schedule'|'tasks'|'upcoming'|'habits'|'progress';

const dateKey = (d:Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const nextRepeatDate = (value:string,repeat:NonNullable<Task['repeat']>) => { const d=new Date(value+'T12:00:00'); if(repeat==='daily')d.setDate(d.getDate()+1); else if(repeat==='weekly')d.setDate(d.getDate()+7); else { do { d.setDate(d.getDate()+1); } while(d.getDay()===0||d.getDay()===6); } return dateKey(d); };
const todayKey = () => dateKey(new Date());
const prettyDate = (value:string, options:Intl.DateTimeFormatOptions = {weekday:'long',month:'long',day:'numeric'}) => new Date(value+'T12:00:00').toLocaleDateString('en-IN', options);
const timeToMinutes = (value:string) => { const [h,m]=value.split(':').map(Number); return h*60+m; };
const minutesToTime = (value:number) => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
const displayTime = (value:string) => new Date(`2000-01-01T${value}:00`).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'});
const priorityRank = (value:Task['priority']) => value==='High'?0:value==='Medium'?1:2;
const playReminderAlert = (sound:boolean,vibration:boolean) => {
  if (vibration && 'vibrate' in navigator) navigator.vibrate([180,90,180]);
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
const notificationId = (value:string) => { let hash=0; for(let i=0;i<value.length;i++) hash=((hash<<5)-hash+value.charCodeAt(i))|0; return Math.abs(hash)||1; };
const reminderDate = (date:string,time:string,minutesBefore:number) => { const value=new Date(date+'T'+time+':00'); value.setMinutes(value.getMinutes()-minutesBefore); return value; };
const isTaskOverdue = (task:Task, referenceDate=todayKey(), now=new Date()) => {
  if(task.completed)return false;
  if(task.dueDate<referenceDate)return true;
  if(task.dueDate>referenceDate||!task.dueTime||referenceDate!==todayKey())return false;
  return timeToMinutes(task.dueTime)+(task.durationMinutes||60)<=now.getHours()*60+now.getMinutes();
};

export default function App() {
  const [user,setUser] = useState<User|null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [tasks,setTasks] = useState<Task[]>([]);
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
  const [dueDate,setDueDate] = useState(todayKey());
  const [dueTime,setDueTime] = useState('');
  const [durationMinutes,setDurationMinutes] = useState(60);
  const [scheduleStart,setScheduleStart] = useState(() => localStorage.getItem('KRAM-schedule-start') || '08:00');
  const [scheduleEnd,setScheduleEnd] = useState(() => localStorage.getItem('KRAM-schedule-end') || '21:00');
  const [scheduling,setScheduling] = useState(false);
  const [smartMessage,setSmartMessage] = useState('');
  const [priority,setPriority] = useState<'High'|'Medium'|'Low'>('Medium');
  const [repeat,setRepeat] = useState<NonNullable<Task['repeat']>>('none');
  const [habitName,setHabitName] = useState('');
  const [habitTrackingType,setHabitTrackingType] = useState<'check'|'measurable'>('check');
  const [habitTarget,setHabitTarget] = useState('');
  const [habitUnit,setHabitUnit] = useState('minutes');
  const [habitError,setHabitError] = useState('');
  const [mobileMenu,setMobileMenu] = useState(false);
  const [filter,setFilter] = useState<'All'|'Open'|'Completed'>('All');
  const [taskQuery,setTaskQuery] = useState('');
  const [priorityFilter,setPriorityFilter] = useState<'All'|'High'|'Medium'|'Low'>('All');
  const [taskSort,setTaskSort] = useState<'Date'|'Priority'|'Title'>('Date');

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); }),[]);
  useEffect(()=>{const tap=(event:MouseEvent)=>{if(!vibrationEnabled||!('vibrate' in navigator))return;const target=event.target as HTMLElement|null;if(target?.closest('button,[role="button"]'))navigator.vibrate(12);};document.addEventListener('click',tap,true);return()=>document.removeEventListener('click',tap,true);},[vibrationEnabled]);
  useEffect(() => { const timer=window.setInterval(()=>setClockNow(new Date()),30000); return ()=>window.clearInterval(timer); },[]);
  useEffect(()=>{if(Capacitor.isNativePlatform()||!notificationsEnabled||!('Notification' in window)||Notification.permission!=='granted')return;const check=()=>{const now=new Date();const today=dateKey(now);const currentMinute=now.getHours()*60+now.getMinutes();const notify=(key:string,titleText:string,body:string)=>{if(localStorage.getItem(key)==='sent')return;localStorage.setItem(key,'sent');const options={body,icon:'/kram-icon.svg',tag:key};if('serviceWorker' in navigator){navigator.serviceWorker.ready.then(registration=>registration.showNotification(titleText,options)).catch(error=>{console.warn('KRAM service-worker notification failed',error);});}else{try{new Notification(titleText,options);}catch(error){console.warn('KRAM notification failed',error);}}playReminderAlert(soundEnabled,vibrationEnabled);};tasks.filter(t=>!t.completed&&t.dueDate===today&&!!t.dueTime).forEach(t=>{const at=timeToMinutes(t.dueTime!)-(t.reminderMinutesBefore??10);if(currentMinute===at)notify('KRAM-reminder-task-'+t.id+'-'+today,'Task reminder',t.title+' is coming up.');});habits.filter(h=>!!h.reminderTime).forEach(h=>{const at=timeToMinutes(h.reminderTime!)-(h.reminderMinutesBefore??10);if(currentMinute===at)notify('KRAM-reminder-habit-'+h.id+'-'+today,'Habit reminder','Time to work on '+h.name+'.');});};check();const timer=window.setInterval(check,15000);return()=>window.clearInterval(timer);},[notificationsEnabled,soundEnabled,vibrationEnabled,tasks,habits]);

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
        tasks.filter(task=>!task.completed && !!task.dueTime && !!task.dueDate).forEach(task=>{
          const at=reminderDate(task.dueDate,task.dueTime!,task.reminderMinutesBefore??0);
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

  const todaysTasks = useMemo(() => tasks.filter(t=>t.dueDate===selectedDate).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||'')),[tasks,selectedDate]);
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

  const openNewTask = (date=selectedDate) => {setEditing(null);setTitle('');setNotes('');setDueDate(date);setDueTime('');setDurationMinutes(60);setReminderMinutesBefore(0);setPriority('Medium');setRepeat('none');setTaskError('');setTaskOpen(true);};
  const openEditTask = (t:Task) => {setEditing(t);setTitle(t.title);setNotes(t.notes||'');setDueDate(t.dueDate);setDueTime(t.dueTime||'');setDurationMinutes(t.durationMinutes||60);setReminderMinutesBefore(t.reminderMinutesBefore??0);setPriority(t.priority);setRepeat(t.repeat||'none');setTaskError('');setTaskOpen(true);};
  const saveTask = async (e:FormEvent) => {
    e.preventDefault();
    if (savingTask) return;
    if (!user) { setTaskError('You are signed out. Please sign in again.'); return; }
    if (!title.trim()) { setTaskError('Please enter a task name.'); return; }
    if (dueTime) {
      const start = timeToMinutes(dueTime);
      const finish = start + durationMinutes;
      const matchingBlocks = blocks.filter(b =>
        b.repeat === 'weekly'
          ? b.days.includes(new Date(dueDate + 'T12:00:00').getDay())
          : b.date === dueDate
      );
      const overlapsClass = matchingBlocks.some(b =>
        start < timeToMinutes(b.endTime) && finish > timeToMinutes(b.startTime)
      );
      const overlapsTask = tasks.some(t =>
        t.id !== editing?.id &&
        !t.completed &&
        t.dueDate === dueDate &&
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
      const payload={title:title.trim(),notes:notes.trim(),dueDate,dueTime,durationMinutes,reminderMinutesBefore:dueTime&&reminderMinutesBefore>=0?reminderMinutesBefore:null,priority,repeat,completed:editing?.completed||false};
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
    if(nextCompleted&&t.repeat&&t.repeat!=='none') {
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
      await createPlannerTask(user.uid,{title:quickTaskTitle.trim(),notes:'',dueDate:selectedDate,dueTime:'',priority:'Medium',completed:false});
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
  const handleDeleteTask=async(id:string)=>{if(window.confirm('Delete this task? This cannot be undone.')){try{await deletePlannerTask(id);}catch(error){console.error(error);window.alert('Could not delete the task. Please try again.');}}};
  const handleDeleteBlock=async(id:string)=>{if(window.confirm('Delete this commitment? This cannot be undone.')){try{await deletePlannerBlock(id);}catch(error){console.error(error);window.alert('Could not delete the commitment. Please try again.');}}};
  const toggleBlockDay=(day:number)=>setBlockDays(current=>current.includes(day)?current.filter(d=>d!==day):[...current,day].sort());
  const openNewTaskAt=(time:string)=>{openNewTask(selectedDate);setDueTime(time);};
  const placeTaskAt=async(taskId:string,time:string)=>{
    const task=tasks.find(t=>t.id===taskId);if(!task||task.completed)return;
    const start=timeToMinutes(time),finish=start+(task.durationMinutes||60);
    const blocked=activeBlocks.some(x=>start<timeToMinutes(x.endTime)&&finish>timeToMinutes(x.startTime));
    const occupied=todaysTasks.some(x=>!x.completed&&x.id!==taskId&&!!x.dueTime&&start<timeToMinutes(x.dueTime)+(x.durationMinutes||60)&&finish>timeToMinutes(x.dueTime));
    if(blocked||occupied){setSmartMessage('That slot overlaps another commitment. Choose another hour.');setDragTaskId('');return;}
    try{await updatePlannerTask(taskId,{dueDate:selectedDate,dueTime:time,durationMinutes:task.durationMinutes||60});setSmartMessage('Task placed on your timetable.');}
    catch(error){console.error(error);setSmartMessage('Could not move this task. Please try again.');}
    setDragTaskId('');
  };
  const scheduleTasks=async()=>{
    if(!user||scheduling)return;
    const pending=todaysTasks.filter(t=>!t.completed&&!t.dueTime).sort((x,y)=>priorityRank(x.priority)-priorityRank(y.priority)||x.createdAt.localeCompare(y.createdAt));
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
      const duration=task.durationMinutes||60;
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
      for(const item of planned)await updatePlannerTask(item.task.id,{dueTime:minutesToTime(item.start),durationMinutes:item.task.durationMinutes||60});
      const remaining=pending.length-planned.length;
      setSmartMessage(planned.length+' task(s) scheduled'+(remaining?'. '+remaining+' task(s) did not fit in your available time.':' successfully.'));
    }catch(error){console.error(error);setSmartMessage('Some tasks could not be saved. Please check your connection and try again.');}
    finally{setScheduling(false);}
  };
  const scheduledTasks=todaysTasks.filter(t=>!t.completed&&!!t.dueTime).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||''));
  const overdueTasks=tasks.filter(t=>isTaskOverdue(t,selectedDate,clockNow)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||(a.dueTime||'').localeCompare(b.dueTime||''));
  const overdueTaskIds=new Set(overdueTasks.map(t=>t.id));
  const unscheduledTasks=todaysTasks.filter(t=>!t.completed&&!t.dueTime&&!overdueTaskIds.has(t.id));
  const scheduleConflicts=scheduledTasks.filter((task,index)=>scheduledTasks.slice(0,index).some(previous=>timeToMinutes(task.dueTime!)<timeToMinutes(previous.dueTime!)+(previous.durationMinutes||60)));
  const addHabit = async (e:React.FormEvent) => {
    e.preventDefault();
    if(!user||!habitName.trim())return;
    if(habitTrackingType==='measurable'&&(!Number.isFinite(Number(habitTarget))||Number(habitTarget)<=0)){setHabitError('Enter a target greater than zero.');return;}
    setHabitError('');
    try {
      await createPlannerHabit(user.uid,habitName.trim(),{trackingType:habitTrackingType,targetValue:habitTrackingType==='measurable'?Number(habitTarget):0,unit:habitTrackingType==='measurable'?habitUnit:'',reminderTime:habitReminderTime||null,reminderMinutesBefore:habitReminderTime?habitReminderMinutesBefore:null});
      setHabitName('');setHabitTarget('');setHabitTrackingType('check');setHabitUnit('minutes');setHabitReminderTime('');setHabitReminderMinutesBefore(10);setHabitOpen(false);
    } catch(error) {console.error('KRAM habit save failed:',error);setHabitError('Could not save this habit. Please try again.');}
  };
  const toggleHabit = async (h:Habit) => {const existing=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate);try{await setPlannerHabitCheckin(user!.uid,h.id,selectedDate,!existing?.completed);}catch(error){console.error('KRAM habit check-in failed:',error);setHabitError('Could not save your check-in. Please try again.');}};
  const recordHabitValue = async (h:Habit,value:number) => {if(!user||!Number.isFinite(value)||value<0)return;try{await setPlannerHabitCheckin(user.uid,h.id,selectedDate,value>=(h.targetValue||0),value);}catch(error){console.error('KRAM measurable habit update failed:',error);setHabitError('Could not save this progress. Please try again.');}};
  const startHabitTimer = async (h:Habit) => {if(!user||selectedDate!==todayKey())return;const running=checkins.find(c=>!!c.timerStartedAt&&c.date===todayKey());if(running&&running.habitId!==h.id){setHabitError('Stop the active habit timer before starting another.');return;}const entry=checkins.find(c=>c.habitId===h.id&&c.date===todayKey());try{await setPlannerHabitCheckin(user.uid,h.id,todayKey(),entry?.completed||false,entry?.value,{timerStartedAt:new Date().toISOString(),elapsedSeconds:entry?.elapsedSeconds||0});setHabitError('');}catch(error){console.error(error);setHabitError('Could not start the timer. Please try again.');}};
  const stopHabitTimer = async (h:Habit) => {if(!user)return;const entry=checkins.find(c=>c.habitId===h.id&&c.date===todayKey());if(!entry?.timerStartedAt)return;const seconds=Math.max(0,(entry.elapsedSeconds||0)+Math.floor((Date.now()-new Date(entry.timerStartedAt).getTime())/1000));const rawValue=h.unit==='hours'?seconds/3600:seconds/60;const value=Number(rawValue.toFixed(2));const completed=h.trackingType==='measurable'?value>=(h.targetValue||0):seconds>0;try{await setPlannerHabitCheckin(user.uid,h.id,todayKey(),completed,value,{timerStartedAt:null,elapsedSeconds:seconds});setHabitError('');}catch(error){console.error(error);setHabitError('Could not save the timer. Please try again.');}};

  if(authLoading) return <div className="loading-screen"><div className="loader-mark">K</div><p>Opening your planner…</p></div>;
  if(!user) return <Auth/>;

  const navItems:[Tab,string,typeof LayoutDashboard][]=[['today','Today',LayoutDashboard],['schedule','Schedule',CalendarDays],['tasks','Tasks',ListTodo],['upcoming','Upcoming',CalendarRange],['habits','Habits',Target],['progress','Progress',TrendingUp]];
  const visibleTasks = (tab==='tasks'?tasks:todaysTasks)
    .filter(t=>(filter==='All'||(filter==='Open'?!t.completed:t.completed))
      && (priorityFilter==='All'||t.priority===priorityFilter)
      && (!taskQuery.trim()||t.title.toLowerCase().includes(taskQuery.trim().toLowerCase())||(t.notes||'').toLowerCase().includes(taskQuery.trim().toLowerCase())))
    .sort((a,b)=>taskSort==='Priority'?priorityRank(a.priority)-priorityRank(b.priority)||a.dueDate.localeCompare(b.dueDate):taskSort==='Title'?a.title.localeCompare(b.title):a.dueDate.localeCompare(b.dueDate)||(a.dueTime||'').localeCompare(b.dueTime||''));
  const upcomingDays=Array.from({length:14},(_,i)=>{const d=new Date(todayKey()+'T12:00:00');d.setDate(d.getDate()+i);const key=dateKey(d);return {key,label:i===0?'Today':i===1?'Tomorrow':prettyDate(key,{weekday:'long',month:'short',day:'numeric'}),items:tasks.filter(t=>t.dueDate===key&&!t.completed).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||''))};}).filter(day=>day.items.length>0);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-icon" src="/kram-icon.svg" alt="KRAM"/><div><strong>KRAM</strong><span>PERSONAL PLANNER</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'nav-item active':'nav-item'} onClick={()=>setTab(id)}><Icon size={19}/><span>{label}</span>{id==='tasks'&&<small>{tasks.filter(t=>!t.completed).length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{(user.displayName||user.email||'U').charAt(0).toUpperCase()}</div><div className="user-details"><strong>{user.displayName||'My planner'}</strong><span>{user.email}</span></div><button className="icon-button" title="Sign out" onClick={()=>signOut(auth)}><LogOut size={17}/></button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="mobile-brand" onClick={()=>setMobileMenu(!mobileMenu)}><Menu size={20}/><img src="/kram-icon.svg" alt=""/><b>KRAM</b></button><div className="breadcrumb">My workspace <span>/</span> <strong>{navItems.find(n=>n[0]===tab)?.[1]}</strong></div><div className="top-actions"><span className={syncError?"sync-label sync-error":"sync-label"}><span className="sync-dot"/>{syncError?"Sync issue":"Synced"}</span><button className="icon-button" onClick={()=>setAlertsOpen(true)} title="Reminder settings"><Bell size={18}/></button><button className="icon-button theme-button" onClick={()=>setDark(!dark)} title="Toggle theme">{dark?<Sun size={18}/>:<Moon size={18}/>}</button><button className="icon-button mobile-logout" onClick={()=>signOut(auth)} title="Sign out"><LogOut size={18}/></button></div></header>
      {syncError&&<div className="sync-error-banner" role="alert">{syncError}</div>}{mobileMenu&&<div className="mobile-menu">{navItems.map(([id,label,Icon])=><button key={id} onClick={()=>{setTab(id);setMobileMenu(false)}}><Icon size={18}/>{label}</button>)}</div>}
      <div className="page-content page-transition" key={tab}>
        {tab==='today'&&<><div className="page-heading"><div><div className="eyebrow">YOUR DAY, YOUR PACE</div><h1>Make today count.</h1><p>{prettyDate(selectedDate)} <span className="muted-dot">·</span> One step at a time.</p></div><button className="primary-button" onClick={()=>openNewTask()}><Plus size={18}/> Add task</button></div>
          <div className="date-switch"><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-1);setSelectedDate(dateKey(d));}}><ChevronLeft size={18}/></button><button className="date-current" onClick={()=>setSelectedDate(todayKey())}><CalendarDays size={16}/>{selectedDate===todayKey()?'Today':prettyDate(selectedDate,{month:'short',day:'numeric',year:'numeric'})}</button><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+1);setSelectedDate(dateKey(d));}}><ChevronRight size={18}/></button></div>
          <form className="quick-add-task" onSubmit={saveQuickTask}><Plus size={18}/><input aria-label="Quick add task" maxLength={120} placeholder="Add a task and press Enter…" value={quickTaskTitle} onChange={e=>setQuickTaskTitle(e.target.value)}/><button className="quick-add-submit" type="submit" disabled={!quickTaskTitle.trim()||quickTaskSaving}>{quickTaskSaving?'Adding…':'Add task'}</button></form>{quickTaskError&&<p className="quick-add-error" role="alert">{quickTaskError}</p>}
          <section className="overview-grid"><div className="overview-card progress-card"><div className="card-topline"><span>DAILY PROGRESS</span><TrendingUp size={17}/></div><div className="progress-main"><div><strong>{completion}%</strong><p>{doneCount} of {todaysTasks.length} tasks completed</p></div><div className="ring" style={{'--progress':completion} as CSSProperties}><div>{completion}%</div></div></div><div className="progress-track"><span style={{width:completion+'%'}}/></div></div><div className="overview-card"><div className="card-topline"><span>TASKS LEFT</span><ListTodo size={17}/></div><strong className="stat-number">{Math.max(0,todaysTasks.length-doneCount)}</strong><p className="stat-caption">A clear next step is all you need.</p></div><div className="overview-card"><div className="card-topline"><span>HABITS TODAY</span><Flame size={17}/></div><strong className="stat-number">{todayCheckins}<em> / {habits.length}</em></strong><p className="stat-caption">Small actions build consistency.</p></div></section>
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
          {overdueTasks.length>0&&<section className="content-section overdue-panel"><div className="section-heading"><div><h2><span className="overdue-heading-dot"/> Overdue <span className="task-count overdue-count">{overdueTasks.length}</span></h2><p>Unfinished tasks from earlier dates or time slots. Move them into this day to schedule again.</p></div></div><div className="task-list">{overdueTasks.map(t=><div className="task-row overdue-task-row" key={t.id}><button className="task-check schedule-task-check" title="Mark complete" aria-label="Mark complete" onClick={()=>toggleTask(t)}><Circle size={19}/><span>Complete</span></button><button className="task-main" onClick={()=>openEditTask(t)}><strong>{t.title}</strong><small><span className="overdue-label">OVERDUE</span>{prettyDate(t.dueDate,{month:'short',day:'numeric'})}{t.dueTime?' · '+displayTime(t.dueTime):''} · {t.durationMinutes||60} min</small></button><div className="task-row-actions"><button className="secondary-button" onClick={async()=>{try{await updatePlannerTask(t.id,{dueDate:selectedDate,dueTime:'' });setSmartMessage('Overdue task moved to this day. You can now set a time or auto-schedule it.');}catch(error){console.error(error);setSmartMessage('Could not move the overdue task. Please try again.');}}}>Move to this day</button><button className="icon-button delete-button" title="Delete task" onClick={()=>handleDeleteTask(t.id)}><Trash2 size={16}/></button></div></div>)}</div></section>}
          <section className="content-section unscheduled-panel"><div className="section-heading"><div><h2>Tasks to schedule <span className="task-count">{unscheduledTasks.length}</span></h2><p>These tasks are waiting for a time. Drag one onto an hour on desktop, or use Set time.</p></div></div>{unscheduledTasks.length===0?<div className="schedule-message">No unscheduled tasks for this date. Add a task without a start time to see it here.</div>:<div className="task-list">{unscheduledTasks.map(t=><div className="task-row" key={t.id} draggable onDragStart={()=>setDragTaskId(t.id)} onDragEnd={()=>setDragTaskId('')}><button className="task-check schedule-task-check" title="Mark complete" aria-label="Mark complete" onClick={()=>toggleTask(t)}><Circle size={19}/><span>Complete</span></button><button className="task-main" onClick={()=>openEditTask(t)}><strong>{t.title}</strong><small><i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority} priority · {t.durationMinutes||60} min</small></button><div className="task-row-actions">{!t.completed&&<button className="secondary-button" onClick={()=>openEditTask(t)}>Set time</button>}<button className="icon-button delete-button" title="Delete task" onClick={()=>handleDeleteTask(t.id)}><Trash2 size={16}/></button></div></div>)}</div>}</section>
          <section className="content-section schedule-section"><div className="section-heading"><div><h2>24-hour timeline</h2><p>Each activity type has its own colour and label.</p></div></div><div className="timeline-legend"><span><i className="legend-class"/> Classes & commitments</span><span><i className="legend-task"/> Tasks</span><span><i className="legend-overdue"/> Overdue</span></div><div className="full-day-timeline">{Array.from({length:24},(_,hour)=>{const hourStart=hour*60;const label=hour===0?'12 AM':hour<12?hour+' AM':hour===12?'12 PM':(hour-12)+' PM';return <div className="timetable-hour" key={hour} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragTaskId)placeTaskAt(dragTaskId,minutesToTime(hourStart));}}><div className="timetable-hour-label">{label}</div><div className="timetable-hour-content"><button className="timetable-open-slot" onClick={()=>openNewTaskAt(minutesToTime(hourStart))}>＋ Add at {label}</button></div></div>})}{todaysTasks.filter(t=>!t.completed&&!!t.dueTime&&!isTaskOverdue(t,selectedDate,clockNow)).map(t=>{const start=timeToMinutes(t.dueTime!);const duration=t.durationMinutes||60;return <div className="timetable-event task-event task-event-span" key={t.id} draggable onDragStart={()=>setDragTaskId(t.id)} onDragEnd={()=>setDragTaskId('')} style={{top:`calc(var(--hour-height) * ${start/60} + 7px)`,height:`calc(var(--hour-height) * ${duration/60} - 14px)`}}><button className="timetable-complete" title="Mark complete" aria-label="Mark complete" onClick={()=>toggleTask(t)}><Circle size={17}/></button><button className="timetable-event-main" onClick={()=>openEditTask(t)}><span className="timeline-type-tag task-type-tag">{t.priority.toUpperCase()} PRIORITY TASK</span><strong>{t.title}</strong><span>{displayTime(t.dueTime!)} · {duration} min</span></button><div className="timetable-event-actions"><button title="Edit task" aria-label="Edit task" onClick={()=>openEditTask(t)}><Clock3 size={14}/></button><button title="Remove from schedule" aria-label="Remove from schedule" onClick={async()=>{try{await updatePlannerTask(t.id,{dueTime:''});setSmartMessage('Task removed from the timetable and kept in your task list.');}catch(error){console.error(error);setSmartMessage('Could not remove this task from the timetable. Please try again.');}}}><CalendarDays size={15}/></button></div></div>})}{activeBlocks.map(x=>{const start=timeToMinutes(x.startTime);const duration=timeToMinutes(x.endTime)-start;return <div className="timetable-event fixed-event fixed-event-span" key={x.id} style={{top:`calc(var(--hour-height) * ${start/60} + 7px)`,height:`calc(var(--hour-height) * ${duration/60} - 14px)`}}><div><span className="timeline-type-tag class-type-tag">{x.repeat==='weekly'?'RECURRING COMMITMENT':'ONE-TIME COMMITMENT'}</span><strong>{x.title}</strong><span>{displayTime(x.startTime)}–{displayTime(x.endTime)} · {x.repeat==='weekly'?'Weekly':'One-time'}</span></div><div className="timetable-event-actions"><button title="Edit commitment" aria-label="Edit commitment" onClick={()=>openEditBlock(x)}><Clock3 size={14}/></button><button title="Delete commitment" aria-label="Delete commitment" onClick={()=>handleDeleteBlock(x.id)}><Trash2 size={15}/></button></div></div>})}</div></section>

        </>}
        {tab==='tasks'&&<><div className="page-heading"><div><div className="eyebrow">STAY ON TOP OF IT</div><h1>Your tasks</h1><p>Everything you need to do, in one place.</p></div><button className="primary-button" onClick={()=>openNewTask(todayKey())}><Plus size={18}/> Add task</button></div><div className="task-tools"><label className="task-search"><Search size={17}/><input aria-label="Search tasks" placeholder="Search task names or notes…" value={taskQuery} onChange={e=>setTaskQuery(e.target.value)}/>{taskQuery&&<button type="button" onClick={()=>setTaskQuery('')} aria-label="Clear search"><X size={15}/></button>}</label><label className="task-tool-select"><span>Priority</span><select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value as 'All'|'High'|'Medium'|'Low')}><option>All</option><option>High</option><option>Medium</option><option>Low</option></select></label><label className="task-tool-select"><span>Sort</span><select value={taskSort} onChange={e=>setTaskSort(e.target.value as 'Date'|'Priority'|'Title')}><option>Date</option><option>Priority</option><option>Title</option></select></label></div><div className="filter-row">{(['All','Open','Completed'] as const).map(f=><button key={f} className={filter===f?'filter-pill selected':'filter-pill'} onClick={()=>setFilter(f)}>{f}{f==='All'&&<span>{tasks.length}</span>}</button>)}</div><TaskList tasks={visibleTasks} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} showDate emptyAction={()=>openNewTask(todayKey())}/></>}
        {tab==='upcoming'&&<><div className="page-heading"><div><div className="eyebrow">PLAN AHEAD, STAY FLEXIBLE</div><h1>Upcoming</h1><p>Your next 14 days of unfinished tasks, organised by date.</p></div><button className="primary-button" onClick={()=>openNewTask(todayKey())}><Plus size={18}/> Add task</button></div>{upcomingDays.length===0?<div className="empty-state"><div className="empty-icon"><CalendarRange size={23}/></div><strong>Nothing coming up</strong><p>Add a task with a future date and it will appear here.</p><button className="secondary-button" onClick={()=>openNewTask(todayKey())}><Plus size={16}/> Add a task</button></div>:upcomingDays.map(day=><section className="content-section" key={day.key}><div className="section-heading"><div><h2>{day.label}</h2><p>{day.items.length} task{day.items.length===1?'':'s'} planned</p></div></div><TaskList tasks={day.items} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} showDate emptyAction={()=>openNewTask(day.key)}/></section>)}</>}
        {tab==='habits'&&<><div className="page-heading"><div><div className="eyebrow">CONSISTENCY OVER PERFECTION</div><h1>Your habits</h1><p>Build routines that make your days better.</p></div><button className="primary-button" onClick={()=>{setHabitReminderTime('');setHabitReminderMinutesBefore(10);setHabitOpen(true);}}><Plus size={18}/> Add habit</button></div><div className="habit-date-note"><CalendarDays size={17}/> Check in for <strong>{prettyDate(selectedDate)}</strong><button className="text-button" onClick={()=>setSelectedDate(todayKey())}>Go to today</button></div>{habitError&&<div className="habit-error-banner" role="alert">{habitError}</div>}<HabitList habits={habits} checkins={checkins} date={selectedDate} now={clockNow} onToggle={toggleHabit} onRecord={recordHabitValue} onTimerStart={startHabitTimer} onTimerStop={stopHabitTimer} onDelete={deletePlannerHabit}/></>}
        {tab==='progress'&&<><div className="page-heading"><div><div className="eyebrow">NOTICE YOUR MOMENTUM</div><h1>Your progress</h1><p>Look back, learn, and keep moving forward.</p></div></div><section className="overview-grid progress-overview"><div className="overview-card"><div className="card-topline"><span>TOTAL TASKS DONE</span><CheckCircle2 size={17}/></div><strong className="stat-number">{tasks.filter(t=>t.completed).length}</strong><p className="stat-caption">Every completed task counts.</p></div><div className="overview-card"><div className="card-topline"><span>ACTIVE HABITS</span><Target size={17}/></div><strong className="stat-number">{habits.length}</strong><p className="stat-caption">Routines you're building.</p></div><div className="overview-card"><div className="card-topline"><span>HABIT CHECK-INS</span><Flame size={17}/></div><strong className="stat-number">{checkins.filter(c=>c.completed).length}</strong><p className="stat-caption">Small wins, added up.</p></div></section><section className="content-section"><div className="section-heading"><div><h2>Habit rewards</h2><p>Earn points for completed daily habits. Each habit can earn points once per day.</p></div></div><div className="overview-grid progress-overview"><div className="overview-card"><span className="habit-summary-label">TOTAL XP</span><strong className="stat-number">{checkins.filter(c=>c.completed).reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0)}</strong><p className="stat-caption">10 XP for check-ins · 15 XP for measurable targets.</p></div><div className="overview-card"><span className="habit-summary-label">CURRENT STREAK</span><strong className="stat-number">{(()=>{let n=0;const d=new Date();const today=dateKey(d);const completedDays=new Set(checkins.filter(c=>c.completed).map(c=>c.date));if(!completedDays.has(today)){d.setDate(d.getDate()-1);}while(completedDays.has(dateKey(d))){n++;d.setDate(d.getDate()-1);}return n;})()}</strong><p className="stat-caption">Consecutive days with at least one completed habit.</p></div><div className="overview-card"><span className="habit-summary-label">LEVEL</span><strong className="stat-number">{Math.floor(checkins.filter(c=>c.completed).reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0)/100)+1}</strong><p className="stat-caption">100 XP per level. Keep building consistency.</p></div></div><div className="habit-list"><div className="habit-row"><div className="habit-emoji">🏅</div><div className="habit-info"><strong>First win</strong><span>{checkins.some(c=>c.completed)?'Unlocked · Complete your first habit':'Locked · Complete any habit once'}</span></div></div><div className="habit-row"><div className="habit-emoji">🔥</div><div className="habit-info"><strong>7 active days</strong><span>{(()=>{const days=new Set(checkins.filter(c=>c.completed).map(c=>c.date));return [...days].length>=7?'Unlocked · Habits completed on 7 different days':'Locked · Complete habits on 7 different days';})()}</span></div></div><div className="habit-row"><div className="habit-emoji">⭐</div><div className="habit-info"><strong>500 XP milestone</strong><span>{checkins.filter(c=>c.completed).reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0)>=500?'Unlocked · 500 XP earned':'Locked · Reach 500 XP'}</span></div></div></div></section><section className="content-section chart-section"><div className="section-heading"><div><h2>Last 7 days</h2><p>Tasks completed each day.</p></div></div><div className="weekly-chart">{week.map(d=><div className="chart-column" key={d.key}><div className="chart-value">{d.done}/{d.total}</div><div className="chart-bar-area"><div className="chart-bar" style={{height:(d.total?Math.max(6,d.done/d.total*100):0)+'%'}}/></div><span>{d.label}</span></div>)}</div></section></>}
      </div>
    </main>
    {alertsOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setAlertsOpen(false)}}><section className="modal-card"><div className="modal-heading"><div><div className="eyebrow">KRAM ALERTS</div><h2>Notification settings</h2></div><button type="button" className="icon-button" onClick={()=>setAlertsOpen(false)}><X size={19}/></button></div><p className="alert-settings-copy">Allow KRAM to send task and habit reminders. Android reminders are scheduled on your device and can appear when KRAM is closed.</p><button type="button" className="primary-button alert-enable" onClick={async()=>{let enabled=false;if(Capacitor.isNativePlatform()){const permission=await LocalNotifications.requestPermissions();enabled=permission.display==='granted';if(enabled){const exact=await LocalNotifications.checkExactNotificationSetting();if(exact.exact_alarm!=='granted'){const updated=await LocalNotifications.changeExactNotificationSetting();if(updated.exact_alarm!=='granted')setSmartMessage('Please allow KRAM under Android Settings → Alarms & reminders so reminders can run on time.');}}}else{if(!('Notification' in window)){setSmartMessage('This browser does not support notifications.');return;}enabled=(await Notification.requestPermission())==='granted';}setNotificationsEnabled(enabled);localStorage.setItem('KRAM-notifications',enabled?'on':'off');setSmartMessage(enabled?'Notifications enabled.':'Notification permission was not granted.');}}>{notificationsEnabled?'✓ ':''}{Capacitor.isNativePlatform()?'Enable Android notifications':'Enable browser notifications'}</button><label className="alert-toggle"><span><strong>Alert sound</strong><small>Play a short tone when a reminder appears</small></span><input type="checkbox" checked={soundEnabled} onChange={e=>{setSoundEnabled(e.target.checked);localStorage.setItem('KRAM-sound',e.target.checked?'on':'off');}}/></label><label className="alert-toggle"><span><strong>Mobile vibration</strong><small>Vibrate on supported phones</small></span><input type="checkbox" checked={vibrationEnabled} onChange={e=>{setVibrationEnabled(e.target.checked);localStorage.setItem('KRAM-vibration',e.target.checked?'on':'off');}}/></label><p className="alert-settings-note">On Android, reminders are scheduled locally on your device. Keep notification permission enabled in Android Settings. Web reminders may pause when the browser is closed.</p><div className="modal-actions"><button type="button" className="primary-button" onClick={()=>setAlertsOpen(false)}>Done</button></div></section></div>}
    {taskOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setTaskOpen(false)}}><form className="modal-card" onSubmit={saveTask}><div className="modal-heading"><div><div className="eyebrow">{editing?'UPDATE TASK':'MAKE IT HAPPEN'}</div><h2>{editing?'Edit task':'New task'}</h2></div><button type="button" className="icon-button" onClick={()=>setTaskOpen(false)}><X size={19}/></button></div><label>Task name<input autoFocus required maxLength={120} placeholder="What do you need to do?" value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Notes <span className="optional">Optional</span><textarea rows={3} placeholder="Add a little detail…" value={notes} onChange={e=>setNotes(e.target.value)}/></label><div className="form-two"><label>Due date<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} required/></label><label>Start time <span className="optional">Optional</span><input type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)}/></label></div><label>Remind me<select value={reminderMinutesBefore} onChange={e=>setReminderMinutesBefore(Number(e.target.value))}><option value={-1}>No reminder</option><option value={0}>At task time</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option></select>{!dueTime&&reminderMinutesBefore!==-1&&<span className="optional">Set a start time above for this reminder to work.</span>}</label><label>Duration<select value={durationMinutes} onChange={e=>setDurationMinutes(Number(e.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={90}>1 hour 30 minutes</option><option value={120}>2 hours</option><option value={180}>3 hours</option></select></label><label>Priority<select value={priority} onChange={e=>setPriority(e.target.value as 'High'|'Medium'|'Low')}><option>Low</option><option>Medium</option><option>High</option></select></label><label>Repeat<select value={repeat} onChange={e=>setRepeat(e.target.value as NonNullable<Task['repeat']>)}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option><option value="weekly">Every week</option></select></label>{taskError&&<div className="auth-error" role="alert">{taskError}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setTaskOpen(false)} disabled={savingTask}>Cancel</button><button className="primary-button" type="submit" disabled={savingTask}>{savingTask?'Saving…':editing?'Save changes':'Add task'}</button></div></form></div>}
    {blockOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setBlockOpen(false)}}><form className="modal-card" onSubmit={saveBlock}><div className="modal-heading"><div><div className="eyebrow">PROTECT YOUR TIME</div><h2>{editingBlock?'Edit commitment':'New commitment'}</h2></div><button type="button" className="icon-button" onClick={()=>setBlockOpen(false)}><X size={19}/></button></div><label>Name<input autoFocus required maxLength={100} placeholder="e.g. College, Gym, Internship" value={blockTitle} onChange={e=>setBlockTitle(e.target.value)}/></label><div className="form-two"><label>Start<input type="time" required value={blockStart} onChange={e=>setBlockStart(e.target.value)}/></label><label>End<input type="time" required value={blockEnd} onChange={e=>setBlockEnd(e.target.value)}/></label></div><label>Repeat<select value={blockRepeat} onChange={e=>setBlockRepeat(e.target.value as 'weekly'|'once')}><option value="weekly">Every week</option><option value="once">Specific date only</option></select></label>{blockRepeat==='weekly'?<div className="block-day-picker"><span>Repeat on</span><div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=><button type="button" key={day} className={blockDays.includes(i)?'block-day active':'block-day'} onClick={()=>toggleBlockDay(i)}>{day}</button>)}</div></div>:<label>Date<input type="date" required value={blockDate} onChange={e=>setBlockDate(e.target.value)}/></label>}{blockError&&<div className="auth-error" role="alert">{blockError}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setBlockOpen(false)}>Cancel</button><button className="primary-button" type="submit">{editingBlock?'Save changes':'Save commitment'}</button></div></form></div>}
    {habitOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setHabitOpen(false)}}><form className="modal-card" onSubmit={addHabit}><div className="modal-heading"><div><div className="eyebrow">BUILD A ROUTINE</div><h2>Add a habit</h2></div><button type="button" className="icon-button" onClick={()=>setHabitOpen(false)}><X size={19}/></button></div><label>Habit name<input autoFocus required maxLength={80} placeholder="e.g. Read, exercise, drink water" value={habitName} onChange={e=>setHabitName(e.target.value)}/></label><label>Tracking type<select value={habitTrackingType} onChange={e=>setHabitTrackingType(e.target.value as "check"|"measurable")}><option value="check">Simple check-in</option><option value="measurable">Measurable target</option></select></label><div className="form-two"><label>Daily reminder time <span className="optional">Optional</span><input type="time" value={habitReminderTime} onChange={e=>setHabitReminderTime(e.target.value)}/></label><label>Remind me<select value={habitReminderMinutesBefore} onChange={e=>setHabitReminderMinutesBefore(Number(e.target.value))} disabled={!habitReminderTime}><option value={0}>At reminder time</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option></select></label></div>{habitTrackingType==="measurable"&&<div className="form-two"><label>Daily target<input required type="number" min="0.01" step="any" value={habitTarget} onChange={e=>setHabitTarget(e.target.value)} placeholder="e.g. 30"/></label><label>Unit<select value={habitUnit} onChange={e=>setHabitUnit(e.target.value)}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="litres">Litres</option><option value="pages">Pages</option><option value="steps">Steps</option><option value="sessions">Sessions</option><option value="reps">Reps</option></select></label></div>}{habitError&&<p className="quick-add-error" role="alert">{habitError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setHabitOpen(false)}>Cancel</button><button className="primary-button" type="submit">Add habit</button></div></form></div>}
    <nav className="bottom-nav">{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'bottom-item active':'bottom-item'} onClick={()=>setTab(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
  </div>;
}

function TaskList({tasks,onToggle,onEdit,onDelete,showDate=false,emptyAction}:{tasks:Task[];onToggle:(t:Task)=>void;onEdit:(t:Task)=>void;onDelete:(id:string)=>void;showDate?:boolean;emptyAction:()=>void}) {
 return <div className="task-list">{tasks.length===0?<div className="empty-state"><div className="empty-icon"><CheckCircle2 size={23}/></div><strong>Nothing on your list</strong><p>Enjoy the breathing room, or add a task when you're ready.</p><button className="secondary-button" onClick={emptyAction}><Plus size={16}/> Add your first task</button></div>:tasks.map(t=><div className={t.completed?'task-row completed':'task-row'} key={t.id}><button className="task-check" onClick={()=>onToggle(t)} aria-label={t.completed?'Mark incomplete':'Complete task'}>{t.completed?<Check size={15}/>:<Circle size={19}/>}</button><button className="task-main" onClick={()=>onEdit(t)}><strong>{t.title}</strong>{t.notes&&<span>{t.notes}</span>}<small>{showDate&&<><CalendarDays size={12}/>{prettyDate(t.dueDate,{month:'short',day:'numeric'})} · </>}{isTaskOverdue(t)&&<span className="overdue-label">OVERDUE</span>}{t.dueTime&&<><Clock3 size={12}/>{t.dueTime} · </>}<i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority} priority</small></button><button className="icon-button delete-button" title="Delete task" onClick={()=>onDelete(t.id)}><Trash2 size={16}/></button></div>)}</div>;
}
function HabitList({habits,checkins,date,now,onToggle,onRecord,onTimerStart,onTimerStop,onDelete}:{habits:Habit[];checkins:Checkin[];date:string;now:Date;onToggle:(h:Habit)=>void;onRecord:(h:Habit,value:number)=>void;onTimerStart:(h:Habit)=>void;onTimerStop:(h:Habit)=>void;onDelete?:(id:string)=>void}) {
 const [values,setValues]=useState<Record<string,string>>({});
 const active=habits;
 const done=active.filter(h=>checkins.some(c=>c.habitId===h.id&&c.date===date&&c.completed)).length;
 const weekStart=new Date(date+"T12:00:00");weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));
 const weekDates=Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(weekStart.getDate()+i);return dateKey(d);});
 const weekDone=active.reduce((n,h)=>n+weekDates.filter(day=>checkins.some(c=>c.habitId===h.id&&c.date===day&&c.completed)).length,0);
 const activeTimer=checkins.find(c=>!!c.timerStartedAt&&c.date===todayKey());
 return <><div className="habit-summary-grid"><div className="overview-card"><span className="habit-summary-label">DAILY COMPLETION</span><strong>{active.length?Math.round(done/active.length*100):0}%</strong><span>{done} of {active.length} habits completed</span></div><div className="overview-card"><span className="habit-summary-label">WEEKLY CHECK-INS</span><strong>{weekDone}</strong><span>Completed check-ins this week</span></div></div>
 {date!==todayKey()&&<p className="stat-caption">Timer controls are available on today's habits. You can still enter past progress manually.</p>}
 <div className="habit-list">{active.length===0?<div className="empty-state"><div className="empty-icon"><Target size={23}/></div><strong>No habits yet</strong><p>Start with one small routine you want to build.</p></div>:active.map(h=>{const entry=checkins.find(c=>c.habitId===h.id&&c.date===date);const isDone=!!entry?.completed;const measurable=h.trackingType==="measurable";const timerEligible=!measurable||h.unit==="minutes"||h.unit==="hours";const running=!!entry?.timerStartedAt;const elapsed=(entry?.elapsedSeconds||0)+(running?Math.max(0,Math.floor((now.getTime()-new Date(entry!.timerStartedAt!).getTime())/1000)):0);return <div className="habit-row habit-row-expanded" key={h.id}><div className="habit-emoji">{h.emoji||"✦"}</div><div className="habit-info"><strong>{h.name}</strong><span>{measurable?"Target: "+(h.targetValue||0)+" "+(h.unit||"units"):(isDone?"Completed":"Simple check-in")}</span>{measurable&&<><div className="habit-measure-row"><input aria-label={"Progress for "+h.name} type="number" min="0" step="any" placeholder={h.unit||"Value"} value={values[h.id]??(entry?.value!==undefined?String(entry.value):"")} onChange={e=>setValues(v=>({...v,[h.id]:e.target.value}))}/><button className="habit-check" type="button" onClick={()=>onRecord(h,Number(values[h.id]??entry?.value??0))}>Save</button></div><div className="habit-progress-track"><span style={{width:Math.min(100,(entry?.value||0)/Math.max(1,h.targetValue||1)*100)+"%"}}/></div></>}{date===todayKey()&&timerEligible&&<div className="habit-timer-row"><span>{running?"Timer running · ":"Timer · "}{Math.floor(elapsed/3600).toString().padStart(2,"0")}:{Math.floor(elapsed%3600/60).toString().padStart(2,"0")}:{(elapsed%60).toString().padStart(2,"0")}</span>{running?<button className="habit-check checked" type="button" onClick={()=>onTimerStop(h)}>Stop & save</button>:<button className="habit-check" type="button" disabled={!!activeTimer} onClick={()=>onTimerStart(h)}>{activeTimer?"Another timer is running":"Start timer"}</button>}</div>}</div>{!measurable&&<button className={isDone?"habit-check checked":"habit-check"} onClick={()=>onToggle(h)}>{isDone?<><Check size={16}/> Done</>:"Check in"}</button>}{onDelete&&<button className="icon-button delete-button" title="Delete habit" onClick={()=>onDelete(h.id)}><Trash2 size={16}/></button>}</div>})}</div></>;
}
