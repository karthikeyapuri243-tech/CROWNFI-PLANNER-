import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import Auth from './components/Auth';
import { createPlannerTask, createRecurringPlannerOccurrence, updatePlannerTask, deletePlannerTask, deletePlannerTaskSeries, deletePlannerTaskWithUndo, restoreDeletedPlannerTask, type DeletedPlannerTask, type DeletedPlannerRoutine, deletePlannerRoutineWithUndo, restoreDeletedPlannerRoutine, subscribePlannerTasks, subscribeInternshipTasks, createInternshipTask, updateInternshipTask, createPlannerBlock, updatePlannerBlock, subscribePlannerBlocks, createPlannerHabit, subscribePlannerHabits, setPlannerHabitCheckin, subscribePlannerCheckins } from './lib/plannerDb';
import { Dumbbell, Bell, CalendarDays, CalendarRange, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Flame, LayoutDashboard, ListTodo, Lightbulb, SlidersHorizontal, Info, Menu, Moon, Plus, Search, Sun, Target, Trash2, TrendingUp, X, Settings, BellRing, Palette, Smartphone, ShieldCheck, BriefcaseBusiness } from 'lucide-react';
// Load celebration effects only when needed, not during startup.
const celebrate = (options: import('canvas-confetti').Options) => {if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;void import('canvas-confetti').then(({default:confetti})=>confetti({...options,particleCount:Math.min(options.particleCount||35,32),ticks:120,disableForReducedMotion:true})).catch(()=>{});};
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

// Release notes belong to this revision only. Replace this list (never append old releases)
// whenever KRAM_UPDATE_REVISION changes.
const KRAM_UPDATE_REVISION = '2026-11-27.10';
const KRAM_UPDATE_NOTES = [
  'Cleaner dashboard, forms and lists with fewer repeated labels.',
  'Compact icon actions for adding, scheduling and navigating.'
];
type ListKind = 'todo'|'someday';
type Task = { listKind?:ListKind; id:string; userId:string; title:string; notes?:string; dueDate:string; scheduledDate?:string; dueTime?:string; durationMinutes?:number; reminderMinutesBefore?:number; priority:'High'|'Medium'|'Low'; repeat?:'none'|'daily'|'weekdays'|'weekly'; lastGeneratedDate?:string; completed:boolean; createdAt:string };
type Habit = { id:string; userId:string; name:string; emoji:string; goalType?:'build'|'quit'; trackingType?:'check'|'measurable'; targetValue?:number; unit?:string; reminderTime?:string; reminderMinutesBefore?:number; allowedSkipsPerWeek?:number; createdAt:string };
// Duration targets are legacy data; display them as simple daily check-ins without rewriting history.
const quantityHabitUnits=['litres','pages','steps','sessions','reps'];
const isQuantityHabit=(h:Habit)=>h.goalType!=='quit'&&h.trackingType==='measurable'&&quantityHabitUnits.includes(h.unit||'');
type ScheduleBlock = { id:string; userId:string; title:string; startTime:string; endTime:string; repeat:'weekly'|'once'; days:number[]; date?:string; createdAt:string };
type Checkin = { id:string; userId:string; habitId:string; date:string; completed:boolean; skipped?:boolean; value?:number; timerStartedAt?:string; elapsedSeconds?:number };
type Tab = 'fitness'|'today'|'schedule'|'tasks'|'upcoming'|'habits'|'progress'|'internship'|'internship-todo'|'internship-deadlines'|'settings';

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
const getTimeGreeting = (date:Date) => { const hour=date.getHours(); return hour>=5&&hour<12?'Good morning':hour>=12&&hour<17?'Good afternoon':'Good evening'; };
type PersonalPreferences={name:string;greeting:boolean;encouragement:boolean;shloka:boolean};
const defaultPersonalPreferences:PersonalPreferences={name:'',greeting:true,encouragement:true,shloka:true};
function readPersonalPreferences(uid:string):PersonalPreferences{
  try{const p=JSON.parse(localStorage.getItem('KRAM-personalization-'+uid)||'{}');return {name:typeof p.name==='string'?p.name.trim().slice(0,32):'',greeting:p.greeting!==false,encouragement:p.encouragement!==false,shloka:p.shloka!==false};}catch{return {...defaultPersonalPreferences};}
}
const smallDailyMessages=['A little progress goes a long way.','Make room for what matters.','One thing at a time.','Small steps, steady progress.','Make today your own.','Focus on what you can do.','Consistency over perfection.'];
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
const KRAM_RELEASE_PAGE = 'https://github.com/karthikeyapuri243-tech/CROWNFI-PLANNER-/releases';
const getLatestKramRelease = async () => {
  const response=await fetch('https://api.github.com/repos/karthikeyapuri243-tech/CROWNFI-PLANNER-/releases/latest',{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
  if(!response.ok)throw new Error('GitHub release check failed ('+response.status+').');
  const release=await response.json();
  const version=String(release.tag_name||'').replace(/^v/i,'');
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('The latest KRAM release has an invalid version.');
  const apk=Array.isArray(release.assets)?release.assets.find((asset:any)=>asset.name==='KRAM-'+version+'.apk'):null;
  if(!apk?.browser_download_url||release.draft||release.prerelease)throw new Error('The latest KRAM release does not contain a stable APK file.');
  const installed=await CapacitorApp.getInfo();
  return {version,installed:installed.version,available:compareAppVersions(version,installed.version)>0};
};


type FitnessExercise={name:string;photo:string;dose:string;muscles:string;steps:string[];avoid:string};
const fitnessA:FitnessExercise[]=[
{name:'Leg press',photo:'Leg_Press',dose:'3 × 12 reps',muscles:'Thighs and glutes',steps:['Sit with your back supported and feet shoulder-width on the platform.','Bend your knees slowly to a comfortable depth, then push through your feet.'],avoid:'Do not lock your knees or let your lower back lift.'},
{name:'Dumbbell chest press',photo:'Dumbbell_Bench_Press',dose:'3 × 12 reps',muscles:'Chest and triceps',steps:['Lie on a flat bench with feet planted and dumbbells beside your chest.','Press up smoothly, then lower with control.'],avoid:'Keep wrists stacked above elbows; do not bounce or flare elbows straight out.'},
{name:'Lat pulldown',photo:'Wide-Grip_Lat_Pulldown',dose:'3 × 12 reps',muscles:'Back',steps:['Adjust the thigh pad and grip the bar slightly wider than shoulders.','Pull the bar toward your upper chest, then slowly return overhead.'],avoid:'Do not pull behind your neck or swing your torso.'},
{name:'Dumbbell shoulder press',photo:'Dumbbell_Shoulder_Press',dose:'2 × 12 reps',muscles:'Shoulders and triceps',steps:['Sit upright with dumbbells at shoulder height.','Press overhead comfortably and lower slowly.'],avoid:'Do not arch your lower back or force painful range.'},
{name:'Dumbbell bicep curl',photo:'Dumbbell_Bicep_Curl',dose:'2 × 12 reps',muscles:'Biceps',steps:['Stand tall with arms by your sides.','Bend your elbows to lift the weights, then lower slowly.'],avoid:'Keep elbows close and avoid swinging.'},
{name:'Plank',photo:'Plank',dose:'3 × 20–30 sec',muscles:'Core',steps:['Place elbows under shoulders, with legs extended.','Brace your stomach and maintain a straight line from shoulders to heels while breathing.'],avoid:'Stop before your hips sag or your lower back hurts.'}
];
const fitnessB:FitnessExercise[]=[
{name:'Goblet squat',photo:'Goblet_Squat',dose:'3 × 12 reps',muscles:'Thighs and glutes',steps:['Hold a light dumbbell close to your chest.','Sit down between your hips as far as comfortable, then stand tall.'],avoid:'Keep heels grounded and knees tracking in the direction of toes.'},
{name:'Incline dumbbell press',photo:'Incline_Dumbbell_Press',dose:'3 × 12 reps',muscles:'Upper chest and triceps',steps:['Set a bench to a comfortable low incline and plant your feet.','Press dumbbells up from chest level and lower them slowly.'],avoid:'Avoid bouncing and excessive back arch.'},
{name:'Seated cable row',photo:'Seated_Cable_Rows',dose:'3 × 12 reps',muscles:'Back',steps:['Sit tall with knees slightly bent and arms extended.','Pull the handle toward your lower ribs, then return slowly.'],avoid:'Do not jerk your torso or round your back.'},
{name:'Seated leg curl',photo:'Seated_Leg_Curl',dose:'3 × 12 reps',muscles:'Hamstrings',steps:['Align your knee joint with the machine pivot and adjust the pads.','Bend your knees against the resistance, then return slowly.'],avoid:'Avoid lifting your hips or slamming the weight stack.'},
{name:'Dumbbell lateral raise',photo:'Side_Lateral_Raise',dose:'2 × 12 reps',muscles:'Side shoulders',steps:['Hold light dumbbells at your sides with elbows slightly bent.','Raise arms outward to about shoulder height, then lower.'],avoid:'Do not swing or shrug your shoulders.'},
{name:'Triceps pushdown',photo:'Triceps_Pushdown_-_Rope_Attachment',dose:'2 × 12 reps',muscles:'Triceps',steps:['Stand facing the cable with elbows close to your sides.','Straighten your elbows to push the rope down, then return slowly.'],avoid:'Keep upper arms still and avoid leaning into the weight.'}
];
const fitnessCardio:FitnessExercise[]=[
{name:'Treadmill walking',photo:'Walking_Treadmill',dose:'20 min',muscles:'Cardiovascular fitness',steps:['Start at an easy pace for five minutes.','Increase to a brisk pace where you can still speak comfortably.'],avoid:'Use the safety clip and avoid running before you are ready.'},
{name:'Stationary cycling',photo:'Bicycling_Stationary',dose:'10 min',muscles:'Cardiovascular fitness',steps:['Adjust seat height so your knee stays slightly bent at the bottom of the pedal stroke.','Pedal steadily at a moderate resistance, then cool down.'],avoid:'Do not use resistance that causes knee pain.'}
];
const fitnessPhotoBase='https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
function FitnessPhoto({exercise,index}:{exercise:FitnessExercise;index:number}){
 const [failed,setFailed]=useState(false);
 return <figure style={{margin:0,minWidth:0}}>{failed?<div role="img" aria-label="Exercise photo unavailable" style={{aspectRatio:'4/3',display:'grid',placeItems:'center',background:'var(--surface2)',borderRadius:12,textAlign:'center',padding:12,color:'var(--muted)'}}>Photo unavailable. Check connection.</div>:<img loading="lazy" decoding="async" src={fitnessPhotoBase+exercise.photo+'/'+index+'.jpg'} alt={exercise.name+' demonstration, position '+(index+1)} onError={()=>setFailed(true)} style={{display:'block',width:'100%',aspectRatio:'4/3',objectFit:'contain',background:'#f1f1f1',borderRadius:12}}/>}<figcaption style={{color:'var(--muted)',fontSize:11,textAlign:'center',marginTop:6}}>Position {index+1}</figcaption></figure>;
}
type FitnessLog={start:string;done:Record<string,string[]>};
const fitnessDayNumber=(value:string)=>{const [y,m,d]=value.split('-').map(Number);return Date.UTC(y,m-1,d)/86400000;};
const fitnessWeekNumber=(start:string,date:string)=>Math.max(0,Math.floor((fitnessDayNumber(mondayWeekStart(date))-fitnessDayNumber(mondayWeekStart(start)))/7));
function readFitnessLog(key:string,today:string):FitnessLog{
 try{const raw=JSON.parse(localStorage.getItem(key)||'{}');const valid=typeof raw.start==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.start)&&Number.isFinite(fitnessDayNumber(raw.start));const done:Record<string,string[]>={};if(raw.done&&typeof raw.done==='object'){for(const [date,ids] of Object.entries(raw.done)){if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Array.isArray(ids))done[date]=ids.filter((id):id is string=>typeof id==='string');}}return {start:valid?raw.start:today,done};}catch{return {start:today,done:{}};}
}
function FitnessGuide({uid,today}:{uid:string;today:string}){
 const storageKey='KRAM-fitness-v1-'+uid;
 const [log,setLog]=useState<FitnessLog>(()=>readFitnessLog(storageKey,today));
 const [chosenDate,setChosenDate]=useState<string|null>(null);
 const [expanded,setExpanded]=useState<string|null>(null);
 const [startOpen,setStartOpen]=useState(false);
 const [storageError,setStorageError]=useState('');
 const currentWeek=mondayWeekStart(today);
 const selected=chosenDate&&mondayWeekStart(chosenDate)===currentWeek?chosenDate:today;
 const week=fitnessWeekNumber(log.start,selected);
 const day=(new Date(selected+'T12:00:00').getDay()+6)%7;
 const dates=Array.from({length:7},(_,i)=>{const d=new Date(currentWeek+'T12:00:00');d.setDate(d.getDate()+i);return dateKey(d);});
 const canLog=selected>=log.start&&selected<=today;
 const completed=log.done[selected]||[];
 useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(log));setStorageError('');}catch{setStorageError('Progress could not be saved on this device.');}},[storageKey,log]);
 const toggleExercise=(name:string)=>{if(!canLog)return;setLog(old=>{const current=old.done[selected]||[];return {...old,done:{...old.done,[selected]:current.includes(name)?current.filter(id=>id!==name):[...current,name]}};});};
 const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
 const strength=day===0||day===2||day===4;
 const isA=(day===2)===(week%2===1);
 const title=strength?'Full body '+(isA?'A':'B'):day===1||day===5?'Cardio':day===3?'Active recovery':'Rest & recovery';
 const exercises=strength?(isA?fitnessA:fitnessB):day===1||day===5?fitnessCardio:day===3?[{...fitnessCardio[0],dose:'20–30 min'}]:[];
 const completedCount=exercises.filter(exercise=>completed.includes(exercise.name)).length;
 const panel:CSSProperties={border:'1px solid var(--line)',background:'var(--surface)',borderRadius:18,padding:16,marginBottom:12};
 return <div style={{maxWidth:800,margin:'0 auto'}}>
 <div className="page-heading" style={{marginBottom:18}}><div><h1>Fitness</h1><p>3:30–4:30 PM</p></div></div>
 <section style={panel} aria-label="Weekly routine"><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><div><strong>Week {week+1}</strong></div><button type="button" className="secondary-button" style={{height:34,padding:'0 12px'}} aria-label="Gym start date" title="Gym start date" aria-expanded={startOpen} onClick={()=>setStartOpen(v=>!v)}><CalendarDays size={18}/></button></div>
 {startOpen&&<div style={{marginTop:12,background:'var(--surface2)',borderRadius:12,padding:12}}><label style={{display:'grid',gap:8,fontSize:12,fontWeight:600}}>Gym starting date<input type="date" value={log.start} onChange={e=>{const value=e.target.value;if(value){setLog(old=>({...old,start:value}));setExpanded(null);}}} style={{width:'100%',minWidth:0,padding:10,borderRadius:8,border:'1px solid var(--line)',background:'var(--surface)',color:'var(--text)'}}/></label><p style={{fontSize:11,color:'var(--muted)',margin:'8px 0 0'}}>The calendar week containing your start date is Week 1. Changing it adjusts the routine without deleting recorded exercises.</p></div>}
 <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:4,margin:'14px 0'}}>{days.map((d,i)=><button key={d} type="button" aria-label={prettyDate(dates[i],{weekday:'long',month:'short',day:'numeric'})} aria-pressed={selected===dates[i]} aria-current={today===dates[i]?'date':undefined} onClick={()=>{setChosenDate(dates[i]===today?null:dates[i]);setExpanded(null)}} style={{border:'1px solid var(--line)',borderRadius:10,padding:'8px 0',background:selected===dates[i]?'var(--green-soft)':'var(--surface)',color:selected===dates[i]?'var(--green)':'var(--muted)',fontSize:12,fontWeight:700}}>{d}<span style={{display:'block',fontSize:10,marginTop:4}}>{Number(dates[i].slice(-2))}</span>{today===dates[i]&&<span aria-hidden="true" style={{display:'block',width:4,height:4,margin:'4px auto 0',borderRadius:4,background:'var(--green)'}}/>}</button>)}</div>
 <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 0 0',borderTop:'1px solid var(--line)'}}><Dumbbell size={24} style={{color:'var(--green)'}}/><div style={{flex:1}}><div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>{selected===today?"Today's workout":prettyDate(selected)}</div><strong style={{fontSize:17}}>{title}</strong><div style={{fontSize:12,color:'var(--muted)',marginTop:4}}>{strength?'45–60 min · warm up 5 min':day===3?'30 min · comfortable pace':day===6?'Optional easy walk':'30–40 min · moderate effort'}</div></div>{selected!==today&&<button className="secondary-button" type="button" onClick={()=>{setChosenDate(null);setExpanded(null)}}>Today</button>}</div></section>
 {exercises.length>0&&<section style={panel} aria-label="Exercise completion"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><strong>{completedCount} / {exercises.length} completed</strong><span style={{color:'var(--green)',fontWeight:700}}>{Math.round(completedCount/exercises.length*100)}%</span></div><div className="progress-track" style={{marginTop:10}}><span style={{width:completedCount/exercises.length*100+'%'}}/></div>{completedCount===exercises.length&&<p role="status" style={{margin:'9px 0 0',fontSize:12,color:'var(--green)'}}>Workout complete. Great work!</p>}{!canLog&&<p style={{fontSize:12,color:'var(--muted)',margin:'8px 0 0'}}>Preview only. You can log exercises on or after your start date, up to today.</p>}{storageError&&<p role="alert">{storageError}</p>}</section>}
 {strength&&<section style={{...panel,background:'var(--green-soft)',color:'var(--text)'}}><strong>First week? Keep it light.</strong><p style={{fontSize:13,margin:'7px 0 0',lineHeight:1.55}}>Start with 2 sets per exercise and rest 60–120 seconds. Use a weight you can control with 2–3 reps left in reserve. Ask gym staff to show you each machine setup before your first set.</p></section>}
 {exercises.map((exercise,i)=><section key={exercise.name} style={panel}><div style={{display:'flex',alignItems:'center',gap:12}}><button type="button" disabled={!canLog} aria-label={(completed.includes(exercise.name)?'Mark incomplete: ':'Mark complete: ')+exercise.name} aria-pressed={completed.includes(exercise.name)} onClick={()=>toggleExercise(exercise.name)} style={{width:40,height:40,flexShrink:0,display:'grid',placeItems:'center',border:'1px solid var(--line)',borderRadius:12,background:completed.includes(exercise.name)?'var(--green-soft)':'var(--surface)',color:'var(--green)',opacity:canLog?1:.5}}>{completed.includes(exercise.name)?<Check size={21}/>:<Circle size={20}/>}</button><button type="button" aria-expanded={expanded===exercise.name} onClick={()=>setExpanded(old=>old===exercise.name?null:exercise.name)} style={{display:'flex',alignItems:'center',flex:1,minWidth:0,gap:8,background:'none',border:0,textAlign:'left',padding:0}}><span style={{flex:1,minWidth:0}}><strong style={{display:'block',fontSize:15}}>{i+1}. {exercise.name}</strong><span style={{display:'block',fontSize:12,color:'var(--muted)',marginTop:4}}>{strength&&week===0?exercise.dose.replace(/^\d+ ×/,'2 ×'):exercise.dose} · {exercise.muscles}</span></span><span style={{color:'var(--green)',fontSize:11,fontWeight:600}}>{expanded===exercise.name?'Hide':'How to'}</span><ChevronRight size={16} style={{transform:expanded===exercise.name?'rotate(90deg)':undefined}}/></button></div>
 {expanded===exercise.name&&<div style={{marginTop:16}}><div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}><FitnessPhoto key={exercise.name+'0'} exercise={exercise} index={0}/><FitnessPhoto key={exercise.name+'1'} exercise={exercise} index={1}/></div><ol style={{paddingLeft:20,listStyle:'decimal',lineHeight:1.6,fontSize:13,margin:'14px 0'}}>{exercise.steps.map(step=><li key={step}>{step}</li>)}</ol><div style={{padding:10,borderRadius:10,background:'var(--surface2)',fontSize:12,lineHeight:1.5}}><strong>Form tip: </strong>{exercise.avoid}</div></div>}</section>)}
 {day===6&&<section style={panel}>Take an easy walk if you feel like it. Eat regular meals and get enough sleep.</section>}
 {day===3&&<section style={panel}>Finish with gentle stretching for 5 minutes. Do not stretch into pain.</section>}
 <section style={panel}><strong>Safety & recovery</strong><p style={{fontSize:13,lineHeight:1.6,margin:'8px 0'}}>Stop if you feel sharp pain, dizziness, chest pain or unusual breathlessness. Increase weights slowly and get help from gym staff with unfamiliar equipment. Aim for 7–9 hours of sleep.</p><p style={{fontSize:11,color:'var(--muted)',margin:0}}>Exercise photos: <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noreferrer" style={{color:'var(--green)',textDecoration:'underline'}}>Free Exercise DB</a> (public-domain dataset). Internet required to load photos; the written guide works without them. Exercise completion and start date are stored on this device, not synced.</p></section>
 </div>;
}

function DashboardJump({label,onOpen}:{label:string;onOpen:()=>void}){
 return <button type="button" aria-label={label} title={label} onClick={onOpen} style={{position:'absolute',inset:0,zIndex:1,border:0,borderRadius:'inherit',background:'transparent',padding:0,cursor:'pointer',outlineOffset:3}}/>;
}
export default function App() {
  const [deleteTarget,setDeleteTarget]=useState<{id:string;kind:'task'|'idea'|'internship'|'habit'|'commitment';title:string;recurring?:boolean}|null>(null);
  const [deleteScope,setDeleteScope]=useState<'one'|'series'>('one');
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteError,setDeleteError]=useState('');
  const deletingRef=useRef(false);
  const [deletionNotice,setDeletionNotice]=useState<{uid:string;message:string;item?:DeletedPlannerTask|DeletedPlannerRoutine}|null>(null);
  const [undoBusy,setUndoBusy]=useState(false);
  const undoBusyRef=useRef(false);
  useEffect(()=>{if(!deletionNotice||undoBusy)return;const timer=window.setTimeout(()=>setDeletionNotice(current=>current===deletionNotice?null:current),deletionNotice.item?20000:3200);return()=>window.clearTimeout(timer);},[deletionNotice,undoBusy]);
  const [user,setUser] = useState<User|null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const activeAccountRef=useRef<string|null>(null);
  const nativeReminderQueue=useRef<Promise<void>>(Promise.resolve());
  const [reminderSyncError,setReminderSyncError]=useState('');
  const [reminderRefresh,setReminderRefresh]=useState(0);
  const [personalPrefs,setPersonalPrefs]=useState<PersonalPreferences>(defaultPersonalPreferences);
  const [personalNameDraft,setPersonalNameDraft]=useState('');
  const [personalPrefsError,setPersonalPrefsError]=useState('');
  const [updateIdentity,setUpdateIdentity]=useState<string|null>(null);
  const [whatsNewOpen,setWhatsNewOpen]=useState(false);
  const [installedVersion,setInstalledVersion]=useState('');
  const [blockLockHash,setBlockLockHash] = useState(()=>localStorage.getItem('KRAM-block-lock')||'');
  const [blockLockSetup,setBlockLockSetup] = useState(false);
  const [blockLockDisable,setBlockLockDisable] = useState(false);
  const [blockLockVerifying,setBlockLockVerifying] = useState(false);
  const lockVerifyRef=useRef(false);
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
  const [secondarySync,setSecondarySync]=useState<Record<string,'loading'|'ready'|'error'>>({habits:'loading',checkins:'loading',blocks:'loading',work:'loading'});
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
  const [taskFiltersOpen,setTaskFiltersOpen]=useState(false);
  const [workFiltersOpen,setWorkFiltersOpen]=useState(false);
  const [completedExpanded,setCompletedExpanded]=useState(false);
  const [habitSaving,setHabitSaving]=useState(false);
  const habitSavingRef=useRef(false);
  const [reminderMinutesBefore,setReminderMinutesBefore] = useState(0);
  const [habitReminderTime,setHabitReminderTime] = useState('');
  const [habitReminderMinutesBefore,setHabitReminderMinutesBefore] = useState(10);
  const [alertsOpen,setAlertsOpen] = useState(false);
  const [latestRelease,setLatestRelease] = useState<{version:string;installed:string;available:boolean}|null>(null);
  const updateCheckRef=useRef(false);
  const [updateChecking,setUpdateChecking] = useState(false);
  const [updateMessage,setUpdateMessage] = useState('');
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
  const [habitUnit,setHabitUnit] = useState('litres');
  const [habitAllowedSkips,setHabitAllowedSkips] = useState(1);
  const [habitError,setHabitError] = useState('');
  const [mobileMenu,setMobileMenu] = useState(false);
  const [listView,setListView] = useState<ListKind>('todo');
  const [taskListKind,setTaskListKind] = useState<ListKind>('todo');
  const [scheduleRequired,setScheduleRequired] = useState(false);
  const [listError,setListError] = useState('');
  const [movingTaskId,setMovingTaskId] = useState<string|null>(null);
  const [taskQuery,setTaskQuery] = useState('');
  const [priorityFilter,setPriorityFilter] = useState<'All'|'High'|'Medium'|'Low'>('All');
  const [taskSort,setTaskSort] = useState<'Date'|'Priority'|'Title'>('Date');

  useEffect(() => onAuthStateChanged(auth, u => {const uid=u?.uid||null;if(activeAccountRef.current!==uid){activeAccountRef.current=uid;setDeletionNotice(null);setDeleteTarget(null);setMomentumToast('');setTasks([]);setInternshipTasks([]);setHabits([]);setBlocks([]);setCheckins([]);setEntryLog({uid:'',days:[]});setTasksLoaded(false);setHabitsLoaded(false);setSyncError('');setSecondarySync({habits:'loading',checkins:'loading',blocks:'loading',work:'loading'});setInternshipError('');setWorkspaceMode('personal');setTab('today');setSelectedDate(todayKey());setTaskOpen(false);setHabitOpen(false);setTaskFiltersOpen(false);setWorkFiltersOpen(false);setCompletedExpanded(false);setTaskQuery('');setPriorityFilter('All');setInternshipSearch('');setInternshipFilter('Open');setBlockOpen(false);setInternshipFormOpen(false);}const prefs=u?readPersonalPreferences(u.uid):{...defaultPersonalPreferences};setPersonalPrefs(prefs);setPersonalNameDraft(prefs.name);setPersonalPrefsError('');setUser(u);setAuthLoading(false); }),[]);
  const savePersonalPreferences=(patch:Partial<PersonalPreferences>)=>{
    if(!user)return;
    const next={...personalPrefs,...patch};
    try{localStorage.setItem('KRAM-personalization-'+user.uid,JSON.stringify(next));setPersonalPrefs(next);setPersonalPrefsError('');}catch{setPersonalPrefsError('Could not save preferences on this device.');}
  };
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
    if(!user||isLocked||blockLockSetup||blockLockDisable||!updateIdentity)return;
    try{if(localStorage.getItem('KRAM-last-seen-update')!==updateIdentity)setWhatsNewOpen(true);}catch{setWhatsNewOpen(true);}
  },[user?.uid,isLocked,blockLockSetup,blockLockDisable,updateIdentity]);
  const closeWhatsNew=()=>{if(updateIdentity){try{localStorage.setItem('KRAM-last-seen-update',updateIdentity);}catch{}}setWhatsNewOpen(false);};
  useEffect(()=>{window.scrollTo({top:0,left:0,behavior:'instant'});setShlokaExpanded(false);},[tab,workspaceMode]);
  useEffect(()=>{
    if(!blockLockHash)return;
    const lock=()=>{setIsLocked(true);setBlockLockDisable(false);setUnlockSequence([]);setBlockLockError('');};
    const visibility=()=>{if(document.visibilityState==='hidden')lock();};
    document.addEventListener('visibilitychange',visibility);
    let listener:{remove:()=>Promise<void>}|null=null;
    if(Capacitor.isNativePlatform())void CapacitorApp.addListener('appStateChange',state=>{if(!state.isActive)lock();}).then(handle=>{listener=handle;});
    return()=>{document.removeEventListener('visibilitychange',visibility);if(listener)void listener.remove();};
  },[blockLockHash]);
  const startBlockLockDisable=()=>{setUnlockSequence([]);setBlockLockError('');setBlockLockDisable(true);};
  const cancelBlockLockDisable=()=>{if(lockVerifyRef.current)return;setBlockLockDisable(false);setUnlockSequence([]);setBlockLockError('');};
  const startBlockLockSetup=()=>{setBlockLockDisable(false);setBlockLockSequence([]);setBlockLockFirst([]);setBlockLockStage('create');setBlockLockError('');setBlockLockSetup(true);};
  const tapLockBlock=(index:number,mode:'setup'|'unlock')=>{if(lockVerifyRef.current)return;if(mode==='unlock'){setUnlockSequence(current=>[...current,index]);setBlockLockError('');return;}setBlockLockSequence(current=>[...current,index]);setBlockLockError('');};
  const finishBlockLockEntry=async()=>{
    if(blockLockSetup){
      if(blockLockSequence.length<2){setBlockLockError('Choose at least 2 taps. Repeating a block is allowed.');return;}
      if(blockLockStage==='create'){setBlockLockFirst(blockLockSequence);setBlockLockSequence([]);setBlockLockStage('confirm');setBlockLockError('Repeat the same taps to confirm.');return;}
      if(blockLockSequence.join(',')!==blockLockFirst.join(',')){setBlockLockSequence([]);setBlockLockError('That sequence does not match. Try again.');return;}
      try{const hash=await hashBlockPassword(blockLockSequence);localStorage.setItem('KRAM-block-lock',hash);setBlockLockHash(hash);setBlockLockSetup(false);setBlockLockSequence([]);setBlockLockFirst([]);setBlockLockError('');setIsLocked(false);}catch(error){console.error('KRAM block lock setup failed',error);setBlockLockError('Could not save the block lock on this device.');}
      return;
    }
    if(!blockLockHash||unlockSequence.length<2){setBlockLockError('Enter your block password first.');return;}
    if(lockVerifyRef.current)return;
    lockVerifyRef.current=true;setBlockLockVerifying(true);
    try{
      const hash=await hashBlockPassword(unlockSequence);
      if(hash!==blockLockHash){setUnlockSequence([]);setBlockLockError('Password is wrong. Try again.');return;}
      if(blockLockDisable){
        localStorage.removeItem('KRAM-block-lock');
        setBlockLockHash('');setBlockLockDisable(false);setBlockLockSetup(false);
      }
      setIsLocked(false);setUnlockSequence([]);setBlockLockError('');
    }catch(error){console.error('KRAM block lock verification failed',error);setUnlockSequence([]);setBlockLockError(blockLockDisable?'Could not turn off the lock. Try again.':'Could not check the password. Try again.');}
    finally{lockVerifyRef.current=false;setBlockLockVerifying(false);}
  };
  const checkForKramUpdate = async () => {
    if(Capacitor.getPlatform()!=='android'||updateCheckRef.current)return;
    updateCheckRef.current=true;setUpdateChecking(true);setUpdateMessage('');
    try{const release=await getLatestKramRelease();setLatestRelease(release);setInstalledVersion(release.installed);}
    catch(error){console.warn('KRAM update check failed',error);setLatestRelease(null);setUpdateMessage('Could not check for updates. Please check your connection and try again.');}
    finally{updateCheckRef.current=false;setUpdateChecking(false);}
  };
  useEffect(()=>{
    if(!user||Capacitor.getPlatform()!=='android')return;
    void checkForKramUpdate();
  },[user?.uid]);

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

  useEffect(() => {const refresh=()=>{if(!document.hidden)setClockNow(new Date());};const timer=window.setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[]);
  useEffect(()=>{if(!Capacitor.isNativePlatform())return;let active=true;LocalNotifications.checkPermissions().then(permission=>{if(!active)return;const enabled=permission.display==='granted';setNotificationsEnabled(enabled);localStorage.setItem('KRAM-notifications',enabled?'on':'off');}).catch(error=>console.warn('KRAM notification permission check failed',error));return()=>{active=false;};},[]);
  // Browser reminders require an open page; native alarms work independently.
  useEffect(()=>{
    if(Capacitor.isNativePlatform()||!user||!notificationsEnabled||!('Notification' in window)||Notification.permission!=='granted')return;
    const uid=user.uid;
    let active=true;
    const inFlight=new Set<string>();
    const notify=async(key:string,titleText:string,body:string)=>{
      if(!active||inFlight.has(key)||localStorage.getItem(key)==='sent')return;
      inFlight.add(key);
      const options={body,icon:'/kram-icon.svg',tag:key};
      try{
        const registration='serviceWorker' in navigator?await navigator.serviceWorker.getRegistration():undefined;
        if(!active||activeAccountRef.current!==uid)return;
        if(registration?.active)await registration.showNotification(titleText,options);
        else new Notification(titleText,options);
        localStorage.setItem(key,'sent');playReminderAlert(soundEnabled,vibrationEnabled);
      }catch(error){console.warn('KRAM browser notification failed',error);}
      finally{inFlight.delete(key);}
    };
    const check=()=>{
      const now=new Date();
      const recent=(at:Date)=>now.getTime()>=at.getTime()&&now.getTime()-at.getTime()<90000;
      tasks.filter(t=>t.userId===uid&&t.listKind!=='someday'&&!t.completed&&!!(t.scheduledDate||t.dueDate)&&!!t.dueTime&&typeof t.reminderMinutesBefore==='number'&&t.reminderMinutesBefore>=0).forEach(t=>{
        const at=reminderDate(t.scheduledDate||t.dueDate,t.dueTime!,t.reminderMinutesBefore!);
        if(recent(at))void notify('KRAM-reminder-'+uid+'-task-'+t.id+'-'+at.getTime(),'Task reminder',t.title+' is coming up.');
      });
      habits.filter(h=>h.userId===uid&&!!h.reminderTime).forEach(h=>{
        for(const offset of [0,1]){const day=new Date(now);day.setDate(day.getDate()+offset);const date=dateKey(day);
          if(checkins.some(c=>c.habitId===h.id&&c.date===date&&(c.completed||c.skipped)))continue;
          const at=reminderDate(date,h.reminderTime!,h.reminderMinutesBefore??10);
          if(recent(at))void notify('KRAM-reminder-'+uid+'-habit-'+h.id+'-'+at.getTime(),'Habit reminder','Time to work on '+h.name+'.');
        }
      });
    };
    check();const timer=window.setInterval(check,15000);document.addEventListener('visibilitychange',check);
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',check);};
  },[notificationsEnabled,soundEnabled,vibrationEnabled,user?.uid,tasks,habits,checkins]);

  useEffect(()=>{
    if(!Capacitor.isNativePlatform())return;
    const refresh=()=>{if(!document.hidden)setReminderRefresh(v=>v+1);};
    document.addEventListener('visibilitychange',refresh);
    return()=>document.removeEventListener('visibilitychange',refresh);
  },[]);
  const reminderDay=dateKey(clockNow);
  const allSyncReady=tasksLoaded&&habitsLoaded&&Object.values(secondarySync).every(v=>v==='ready');
  const hasSyncIssue=!!syncError||Object.values(secondarySync).includes('error');
  useEffect(() => {
    if(!Capacitor.isNativePlatform())return;
    let cancelled=false;
    const uid=user?.uid;
    const syncNativeReminders=async()=>{
      if(cancelled)return;
      try{
        if(!uid||!notificationsEnabled){
          const pending=(await LocalNotifications.getPending()).notifications;
          if(!cancelled&&pending.length)await LocalNotifications.cancel({notifications:pending.map(item=>({id:item.id}))});
          return;
        }
        if(!tasksLoaded||!habitsLoaded||syncError||secondarySync.checkins!=='ready')return;
        const permission=await LocalNotifications.checkPermissions();
        if(cancelled||activeAccountRef.current!==uid)return;
        if(permission.display!=='granted'){setReminderSyncError('Allow notifications in Android settings.');return;}
        await LocalNotifications.createChannel({id:'kram-reminders',name:'KRAM reminders',description:'Task and habit reminders',importance:5,sound:'default',vibrationPattern:[180,90,180]});
        const now=new Date();
        const upcoming:Array<{id:number;title:string;body:string;schedule:{at:Date;allowWhileIdle:boolean};channelId:string;sound:string}>=[];
        const add=(key:string,title:string,body:string,at:Date)=>{if(at>now)upcoming.push({id:notificationId(key),title,body,schedule:{at,allowWhileIdle:true},channelId:'kram-reminders',sound:'default'});};
        tasks.filter(t=>t.userId===uid&&t.listKind!=='someday'&&!t.completed&&!!t.dueTime&&!!(t.scheduledDate||t.dueDate)&&typeof t.reminderMinutesBefore==='number'&&t.reminderMinutesBefore>=0).forEach(t=>add('task-'+t.id+'-'+t.dueDate,'Task reminder',t.title+' is coming up.',reminderDate(t.scheduledDate||t.dueDate,t.dueTime!,t.reminderMinutesBefore!)));
        const finished=new Set(checkins.filter(c=>c.completed||c.skipped).map(c=>c.habitId+'_'+c.date));
        habits.filter(h=>h.userId===uid&&!!h.reminderTime).forEach(h=>{for(let offset=0;offset<30;offset++){const day=new Date(now);day.setDate(day.getDate()+offset);const date=dateKey(day);if(!finished.has(h.id+'_'+date))add('habit-'+h.id+'-'+date,'Habit reminder','Time to work on '+h.name+'.',reminderDate(date,h.reminderTime!,h.reminderMinutesBefore??10));}});
        if(cancelled||activeAccountRef.current!==uid)return;
        const pending=(await LocalNotifications.getPending()).notifications.filter(item=>item.title==='Task reminder'||item.title==='Habit reminder');
        if(cancelled||activeAccountRef.current!==uid)return;
        if(pending.length)await LocalNotifications.cancel({notifications:pending.map(item=>({id:item.id}))});
        if(cancelled||activeAccountRef.current!==uid)return;
        if(upcoming.length)await LocalNotifications.schedule({notifications:upcoming});
        if(!cancelled)setReminderSyncError('');
      }catch(error){console.warn('KRAM native reminder scheduling failed',error);if(!cancelled)setReminderSyncError('Could not schedule reminders. Check notification and alarm permissions.');}
    };
    nativeReminderQueue.current=nativeReminderQueue.current.catch(()=>{}).then(syncNativeReminders);
    return()=>{cancelled=true;};
  },[notificationsEnabled,user?.uid,tasks,habits,checkins,tasksLoaded,habitsLoaded,syncError,secondarySync.checkins,reminderDay,reminderRefresh]);


  useEffect(() => {
    document.documentElement.classList.toggle('dark',dark);
    localStorage.setItem('KRAM-theme',dark?'dark':'light');
  },[dark]);
  useEffect(() => { localStorage.setItem('KRAM-schedule-start',scheduleStart); localStorage.setItem('KRAM-schedule-end',scheduleEnd); },[scheduleStart,scheduleEnd]);
  useEffect(() => {
    if(!user) return;
    const a=subscribePlannerTasks(user.uid,items=>{setTasks(items);setTasksLoaded(true);setSyncError('');},()=>{setTasksLoaded(false);setSyncError('Tasks could not sync. Check your internet connection and refresh the planner.');});
    const mark=(key:string,status:'ready'|'error')=>setSecondarySync(prev=>prev[key]===status?prev:{...prev,[key]:status});
    const b=subscribePlannerHabits(user.uid,items=>{setHabits(items);setHabitsLoaded(true);mark('habits','ready');},()=>{setHabitsLoaded(false);mark('habits','error');});
    const c=subscribePlannerCheckins(user.uid,items=>{setCheckins(items);mark('checkins','ready');},days=>setEntryLog({uid:user.uid,days}),()=>{setEntryLog(prev=>({uid:user.uid,days:prev.uid===user.uid?prev.days:[],error:true}));mark('checkins','error');});
    const d=subscribePlannerBlocks(user.uid,items=>{setBlocks(items);mark('blocks','ready');},()=>mark('blocks','error'));
    const work=subscribeInternshipTasks(user.uid,items=>{setInternshipTasks(items);setInternshipError('');mark('work','ready');},()=>{setInternshipError('Work could not sync. Check your internet connection.');mark('work','error');});
    return () => {a();b();c();d();work();};
  },[user]);

  const todaysTasks = useMemo(() => tasks.filter(t=>t.listKind!=='someday'&&(t.scheduledDate||t.dueDate)===selectedDate).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||'')),[tasks,selectedDate]);
  const entryToday=dateKey(clockNow);
  const entryReady=!!user&&entryLog.uid===user.uid&&!entryLog.error;
  const entryStreak=useMemo(()=>summarizeEntryStreak(entryReady?entryLog.days:[],entryToday),[entryReady,entryLog.days,entryToday]);
  const doneCount = todaysTasks.filter(t=>t.completed).length;
  const completion = todaysTasks.length ? Math.round(doneCount/todaysTasks.length*100) : 0;
  const todayCheckins = habits.filter(h=>checkins.some(c=>c.habitId===h.id&&c.date===selectedDate&&c.completed)).length;
  const week = useMemo(()=>Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const key=dateKey(d);const day=tasks.filter(t=>t.listKind!=='someday'&&(t.scheduledDate||t.dueDate)===key);return {key,label:d.toLocaleDateString('en-IN',{weekday:'short'}),total:day.length,done:day.filter(t=>t.completed).length};}),[tasks,entryToday]);

  const openNewTask = (date='',kind:ListKind='todo') => {setTaskListKind(kind);setScheduleRequired(false);setEditing(null);setTitle('');setNotes('');setDueDate('');setScheduleDate(date||selectedDate);setDueTime('');setEndTime('');setDurationMinutes(30);setReminderMinutesBefore(-1);setPriority('Medium');setRepeat('none');setTaskError('');setTaskOpen(true);};
  const openEditTask = (t:Task) => {setTaskListKind(t.listKind||'todo');setScheduleRequired(false);setEditing(t);setTitle(t.title);setNotes(t.notes||'');setDueDate(t.dueDate||'');setScheduleDate(t.scheduledDate||(t.dueTime?t.dueDate:selectedDate)||selectedDate);setDueTime(t.dueTime||'');setEndTime(t.dueTime?minutesToTime(timeToMinutes(t.dueTime)+(t.durationMinutes||60)):'');setDurationMinutes(t.durationMinutes||60);setReminderMinutesBefore(t.reminderMinutesBefore??-1);setPriority(t.priority);setRepeat(t.repeat||'none');setTaskError('');setTaskOpen(true);};
  const openTaskSchedule = (t:Task) => {if(t.completed||t.listKind==='someday')return;openEditTask(t);setScheduleDate(t.scheduledDate||selectedDate);setScheduleRequired(true);};
  const moveToTodo = async(t:Task)=>{if(movingTaskId||t.listKind!=='someday'||t.completed)return;setMovingTaskId(t.id);setListError('');try{await updatePlannerTask(t.id,{listKind:'todo',dueDate:'',scheduledDate:'',dueTime:'',reminderMinutesBefore:null,repeat:'none'});setListView('todo');setTaskQuery('');setPriorityFilter('All');showMomentumToast('Moved to your to-do list');}catch(error){console.error(error);setListError('Could not move this item. Please try again.');}finally{setMovingTaskId(null);}};
  const saveTask = async (e:FormEvent) => {
    e.preventDefault();
    if (savingTask) return;
    if (!user) { setTaskError('You are signed out. Please sign in again.'); return; }
    if (!title.trim()) { setTaskError('Please enter a name.'); return; }
    if(taskListKind==='someday'){
      setSavingTask(true);setTaskError('');
      try{const payload={title:title.trim(),notes:notes.trim(),listKind:'someday',dueDate:'',scheduledDate:'',dueTime:'',reminderMinutesBefore:null,priority:'Medium',repeat:'none',completed:editing?.completed||false};if(editing)await updatePlannerTask(editing.id,payload,true);else await createPlannerTask(user.uid,payload);setListView('someday');setTaskQuery('');setPriorityFilter('All');setTab('tasks');setTaskOpen(false);}catch(error){console.error(error);setTaskError('Could not save this idea. Please try again.');}finally{setSavingTask(false);}return;
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
      if(editing) await updatePlannerTask(editing.id,payload,true);
      else await createPlannerTask(user.uid,payload);
      if(tab==='tasks'){setListView('todo');setTaskQuery('');setPriorityFilter('All');}
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
      await updatePlannerTask(t.id,{completed:nextCompleted},nextCompleted);
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
      if(tab==='tasks'){setTaskQuery('');setPriorityFilter('All');}
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
    try{const payload={title:blockTitle.trim(),startTime:blockStart,endTime:blockEnd,repeat:blockRepeat,days:blockRepeat==='weekly'?blockDays:[],date:blockRepeat==='once'?blockDate:''};if(editingBlock) await updatePlannerBlock(editingBlock.id,payload,true);else await createPlannerBlock(user.uid,payload);setBlockOpen(false);setBlockTitle('');setEditingBlock(null);}
    catch(error){console.error(error);setBlockError('Could not save. Check your connection and Firebase permissions.');}
  };
  const openBlockForm=()=>{setEditingBlock(null);setBlockTitle('');setBlockStart('09:00');setBlockEnd('10:00');setBlockRepeat('weekly');setBlockDate(selectedDate);setBlockDays([1,2,3,4,5]);setBlockError('');setBlockOpen(true);};
  const openEditBlock=(block:ScheduleBlock)=>{setEditingBlock(block);setBlockTitle(block.title);setBlockStart(block.startTime);setBlockEnd(block.endTime);setBlockRepeat(block.repeat);setBlockDate(block.date||selectedDate);setBlockDays(block.days||[]);setBlockError('');setBlockOpen(true);};
  const requestDelete=(target:NonNullable<typeof deleteTarget>)=>{if(deletingRef.current||undoBusyRef.current)return;setDeleteScope('one');setDeleteError('');setDeleteTarget(target);};
  const closeDelete=()=>{if(!deletingRef.current)setDeleteTarget(null);};
  const handleDeleteTask=(id:string)=>{const task=tasks.find(t=>t.id===id);if(!task)return;requestDelete({id,kind:task.listKind==='someday'?'idea':'task',title:task.title,recurring:!!task.repeat&&task.repeat!=='none'});};
  const confirmDelete=async()=>{
    if(!deleteTarget||!user||deletingRef.current||undoBusyRef.current)return;
    const target=deleteTarget;const uid=user.uid;deletingRef.current=true;setDeleteBusy(true);setDeleteError('');
    try{
      let undoItem:DeletedPlannerTask|DeletedPlannerRoutine|undefined;
      if(target.kind==='habit'||target.kind==='commitment')undoItem=await deletePlannerRoutineWithUndo(target.id,uid,target.kind);
      else if(target.kind==='internship')undoItem=await deletePlannerTaskWithUndo(target.id,uid);
      else if(target.recurring&&deleteScope==='series'){
        const task=tasks.find(t=>t.id===target.id);
        const root=tasks.filter(t=>target.id.startsWith(t.id+'_')&&t.repeat&&t.repeat!=='none').sort((a,b)=>a.id.length-b.id.length)[0]||task;
        const rootId=(root?.id||target.id).replace(/(?:_\d{4}-\d{2}-\d{2})+$/,'');
        await deletePlannerTaskSeries(user.uid,rootId);
      }else if(target.recurring||/(?:_\d{4}-\d{2}-\d{2})$/.test(target.id))await deletePlannerTask(target.id);
      else undoItem=await deletePlannerTaskWithUndo(target.id,uid);
      if(activeAccountRef.current===uid){setDeleteTarget(null);setMomentumToast('');triggerKramHaptic(vibrationEnabled,'light');setDeletionNotice({uid,message:target.kind==='internship'?'Work deleted':target.kind==='idea'?'Idea deleted':target.kind==='habit'?'Habit deleted':target.kind==='commitment'?'Commitment deleted':target.recurring&&deleteScope==='series'?'Series deleted':'To-do deleted',item:undoItem});}
    }catch(error){console.error('KRAM delete failed',error);setDeleteError('Could not delete this item. Please try again.');}
    finally{deletingRef.current=false;setDeleteBusy(false);}
  };
  const undoDeletion=async()=>{const notice=deletionNotice;if(!notice?.item||undoBusyRef.current||activeAccountRef.current!==notice.uid)return;undoBusyRef.current=true;setUndoBusy(true);try{if('kind' in notice.item)await restoreDeletedPlannerRoutine(notice.item);else await restoreDeletedPlannerTask(notice.item);if(activeAccountRef.current===notice.uid)setDeletionNotice({uid:notice.uid,message:'Item restored'});}catch(error){console.error('KRAM undo failed',error);if(activeAccountRef.current===notice.uid)setDeletionNotice({...notice,message:'Could not restore. Try again.'});}finally{undoBusyRef.current=false;setUndoBusy(false);}};
  const openInternshipForm=(task?:Task)=>{setInternshipError('');setInternshipEditing(task||null);setInternshipTitle(task?.title||'');setInternshipNotes(task?.notes||'');setInternshipDeadline(task?.dueDate||'');setInternshipPriority(task?.priority||'Medium');setInternshipFormOpen(true);};
  const saveQuickWork=async(e:FormEvent)=>{e.preventDefault();if(!user||!workQuickTitle.trim()||workQuickBusy)return;setWorkQuickBusy(true);setInternshipError('');try{await createInternshipTask(user.uid,{title:workQuickTitle.trim(),notes:'',dueDate:'',priority:'Medium',completed:false});setWorkQuickTitle('');setInternshipSearch('');setInternshipFilter('Open');}catch(error){console.error(error);setInternshipError('Could not add work. Please try again.');}finally{setWorkQuickBusy(false);}};
  const saveInternshipTask=async(e:FormEvent)=>{e.preventDefault();if(!user||internshipSaving)return;if(!internshipTitle.trim()){setInternshipError('Enter a name for your work.');return;}if(!internshipEditing&&tab==='internship-deadlines'&&!internshipDeadline){setInternshipError('Choose a deadline.');return;}setInternshipSaving(true);setInternshipError('');const payload={title:internshipTitle.trim(),notes:internshipNotes.trim(),dueDate:internshipDeadline||'',priority:internshipPriority,completed:internshipEditing?.completed||false};try{if(internshipEditing)await updateInternshipTask(internshipEditing.id,payload,true);else await createInternshipTask(user.uid,payload);setInternshipSearch('');setInternshipFilter(internshipEditing?.completed?'All':'Open');setInternshipFormOpen(false);if(!internshipEditing&&tab==='internship')setTab('internship-todo');if(!internshipEditing&&tab==='internship-deadlines'&&!internshipDeadline)setTab('internship-todo');}catch(error){console.error('KRAM internship task save failed',error);setInternshipError('Could not save work. Check your connection and try again.');}finally{setInternshipSaving(false);}};
  const toggleInternshipTask=async(task:Task)=>{try{await updateInternshipTask(task.id,{completed:!task.completed},!task.completed);if(!task.completed){celebrate({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');}}catch(error){console.error(error);setInternshipError('Could not update this internship task. Please try again.');}};
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
  const openHabitForm=(template?:{name:string;emoji:string;target?:string;unit?:string})=>{setHabitName(template?.name||'');setHabitEmoji(template?.emoji||'✦');setHabitGoalType('build');const quantity=!!template?.target&&quantityHabitUnits.includes(template?.unit||'');setHabitTrackingType(quantity?'measurable':'check');setHabitTarget(quantity?template?.target||'':'');setHabitUnit(quantity?template?.unit||'litres':'litres');setHabitReminderTime('');setHabitReminderMinutesBefore(10);setHabitAllowedSkips(1);setHabitError('');setHabitOpen(true);};
  const addHabit = async (e:React.FormEvent) => {
    e.preventDefault();
    if(!user||!habitName.trim()||habitSavingRef.current)return;
    const quantity=habitGoalType==='build'&&habitTrackingType==='measurable'&&quantityHabitUnits.includes(habitUnit);
    if(quantity&&(!Number.isFinite(Number(habitTarget))||Number(habitTarget)<=0)){setHabitError('Enter a target greater than zero.');return;}
    setHabitError('');habitSavingRef.current=true;setHabitSaving(true);
    try {
      await createPlannerHabit(user.uid,habitName.trim(),{emoji:habitEmoji,goalType:habitGoalType,trackingType:quantity?'measurable':'check',targetValue:quantity?Number(habitTarget):0,unit:quantity?habitUnit:'',reminderTime:habitReminderTime||null,reminderMinutesBefore:habitReminderTime?habitReminderMinutesBefore:null,allowedSkipsPerWeek:habitAllowedSkips});
      setHabitName('');setHabitEmoji('✦');setHabitGoalType('build');setHabitTarget('');setHabitTrackingType('check');setHabitUnit('litres');setHabitReminderTime('');setHabitReminderMinutesBefore(10);setHabitAllowedSkips(1);setHabitOpen(false);
    } catch(error) {console.error('KRAM habit save failed:',error);setHabitError('Could not save this habit. Please try again.');}finally{habitSavingRef.current=false;setHabitSaving(false);}
  };
  const toggleHabit = async (h:Habit) => {const existing=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate);try{await setPlannerHabitCheckin(user!.uid,h.id,selectedDate,!existing?.completed,existing?.value,{skipped:false,timerStartedAt:null});if(!existing?.completed){celebrate({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');const streak=habitStreak(h.id,checkins,selectedDate)+1;showMomentumToast(streak===7?'7-day streak · wonderful consistency!':streak===30?'30-day streak · incredible commitment!':streak===3?'3-day streak · keep it steady!':'Habit complete · consistency grows');}}catch(error){console.error('KRAM habit check-in failed:',error);setHabitError('Could not save your check-in. Please try again.');}};
  const skipHabit = async (h:Habit) => { if(!user)return; const existing=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate); if(existing?.completed){setHabitError('A completed habit cannot be skipped.');return;} const weekStart=mondayWeekStart(selectedDate); const used=checkins.filter(c=>c.habitId===h.id&&c.skipped&&c.date>=weekStart&&c.date<=selectedDate).length; const limit=Math.max(0,Math.min(7,h.allowedSkipsPerWeek??1)); if(existing?.skipped){try{await setPlannerHabitCheckin(user.uid,h.id,selectedDate,false,existing.value,{skipped:false});setHabitError('Skip removed.');}catch(error){console.error(error);setHabitError('Could not undo this skip. Please try again.');}return;} if(used>=limit){setHabitError('You have used all '+limit+' allowed skip'+(limit===1?'':'s')+' for this week. Your allowance resets on Monday.');return;} try{await setPlannerHabitCheckin(user.uid,h.id,selectedDate,false,existing?.value,{skipped:true,timerStartedAt:null});setHabitError('Skip used. Your streak is protected; no XP was earned.');}catch(error){console.error(error);setHabitError('Could not save this skip. Please try again.');} };
  const recordHabitValue = async (h:Habit,value:number) => {if(!user||!isQuantityHabit(h)||!Number.isFinite(value)||value<0)return;try{const completed=value>=(h.targetValue||0);await setPlannerHabitCheckin(user.uid,h.id,selectedDate,completed,value,{skipped:false,timerStartedAt:null},true);if(completed){celebrate({particleCount:38,spread:55,origin:{y:0.75},scalar:0.72});triggerKramHaptic(vibrationEnabled,'success');showMomentumToast('Daily target reached · nicely done');}}catch(error){console.error('KRAM measurable habit update failed:',error);setHabitError('Could not save this progress. Please try again.');}};



  const personalNavItems:[Tab,string,any][]=[['today','Today',LayoutDashboard],['schedule','Planner',CalendarDays],['tasks','To-do',ListTodo],['habits','Habits',Target],['progress','Progress',TrendingUp],['fitness','Fitness',Dumbbell],['settings','Settings',Settings]];
  const internshipNavItems:[Tab,string,any][]=[['internship','Overview',BriefcaseBusiness],['internship-todo','To-do',ListTodo],['internship-deadlines','Deadlines',CalendarDays],['settings','Settings',Settings]];
  const navItems=workspaceMode==='internship'?internshipNavItems:personalNavItems;
  const openDashboardTab=(target:Tab,filter:'Open'|'Overdue'|'Completed'='Open')=>{
    if(target==='tasks'){setListView('todo');setTaskQuery('');setPriorityFilter('All');setTaskFiltersOpen(false);setCompletedExpanded(false);}
    if(target==='internship-todo'||target==='internship-deadlines'){setInternshipFilter(filter);setInternshipSearch('');setWorkFiltersOpen(false);}
    setTab(target);
  };
  const workToday=dateKey(clockNow);
  const workOpen=internshipTasks.filter(t=>!t.completed);
  const workOverdue=workOpen.filter(t=>!!t.dueDate&&t.dueDate<workToday);
  const workDated=workOpen.filter(t=>!!t.dueDate).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const workBase=tab==='internship-deadlines'?internshipTasks.filter(t=>!!t.dueDate):internshipTasks;
  const workVisible=useMemo(()=>workBase.filter(t=>(internshipFilter==='All'||(internshipFilter==='Open'?!t.completed:internshipFilter==='Completed'?t.completed:!t.completed&&!!t.dueDate&&t.dueDate<workToday))&&(!internshipSearch.trim()||t.title.toLowerCase().includes(internshipSearch.trim().toLowerCase())||(t.notes||'').toLowerCase().includes(internshipSearch.trim().toLowerCase()))).sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||priorityRank(a.priority)-priorityRank(b.priority)||a.title.localeCompare(b.title)),[workBase,internshipFilter,internshipSearch,workToday]);
  const workWeekEnd=(()=>{const d=new Date(workToday+'T12:00:00');d.setDate(d.getDate()+((7-d.getDay())%7));return dateKey(d);})();
  const deadlineGroups=[{label:'Overdue',items:workVisible.filter(t=>!t.completed&&t.dueDate<workToday)},{label:'Today',items:workVisible.filter(t=>!t.completed&&t.dueDate===workToday)},{label:'This week',items:workVisible.filter(t=>!t.completed&&t.dueDate>workToday&&t.dueDate<=workWeekEnd)},{label:'Later',items:workVisible.filter(t=>!t.completed&&t.dueDate>workWeekEnd)},{label:'Completed',items:workVisible.filter(t=>t.completed)}].filter(g=>g.items.length);
  const visibleTasks = useMemo(()=>tab!=='tasks'?[]:tasks.filter(t=>(t.listKind||'todo')===listView)
    .filter(t=>(priorityFilter==='All'||t.priority===priorityFilter)
      && (!taskQuery.trim()||t.title.toLowerCase().includes(taskQuery.trim().toLowerCase())||(t.notes||'').toLowerCase().includes(taskQuery.trim().toLowerCase())))
    .sort((a,b)=>taskSort==='Priority'?priorityRank(a.priority)-priorityRank(b.priority)||((a.dueDate||'9999').localeCompare(b.dueDate||'9999')):taskSort==='Title'?a.title.localeCompare(b.title):(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||(a.dueTime||'').localeCompare(b.dueTime||'')),[tab,tasks,listView,priorityFilter,taskQuery,taskSort]);
  const openListItems=visibleTasks.filter(t=>!t.completed), completedListItems=visibleTasks.filter(t=>t.completed);
  const listHasFilters=!!taskQuery.trim()||priorityFilter!=='All';
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
  const preferredName=personalPrefs.name||user?.displayName?.trim().split(/\s+/)[0]||'';
  const greetingText=getTimeGreeting(clockNow)+(preferredName?', '+preferredName:'')+'.';
  const plannedCount=activeBlocks.length+todaysTasks.filter(t=>!!t.dueTime&&!t.completed).length;
  const rewardCheckins=checkins.filter(c=>c.completed);
  const rewardXP=rewardCheckins.reduce((sum,c)=>sum+(habits.find(h=>h.id===c.habitId)?.trackingType==='measurable'?15:10),0);
  const rewardDays=new Set(rewardCheckins.map(c=>c.date));
  let habitActivityStreak=0;let rewardCursor=rewardDays.has(entryToday)?entryToday:entryDayBefore(entryToday);while(rewardDays.has(rewardCursor)){habitActivityStreak++;rewardCursor=entryDayBefore(rewardCursor);}
  const remainingToday=Math.max(0,todaysTasks.length-doneCount);
  const allTodayDone=(todaysTasks.length+habits.length)>0&&remainingToday===0&&todayCheckins===habits.length;
  const dailyMessage=!tasksLoaded||!habitsLoaded?'':allTodayDone?'Everything checked off for today.':entryReady&&entryStreak.loggedToday&&[3,7,14,30,60,90,100,365].includes(entryStreak.current)?entryStreak.current+' days of showing up.':remainingToday>0?remainingToday+' '+(remainingToday===1?'task':'tasks')+' remaining today.':habits.length>todayCheckins?(habits.length-todayCheckins)+' '+(habits.length-todayCheckins===1?'habit':'habits')+' left today.':smallDailyMessages[clockNow.getDay()];
  const workMessage=workOverdue.length?workOverdue.length+' overdue '+(workOverdue.length===1?'deadline':'deadlines')+'.':workDated.some(t=>t.dueDate===workToday)?'You have work due today.':workOpen.length?workOpen.length+' open '+(workOpen.length===1?'task':'tasks')+'.':internshipTasks.length?'All work is caught up.':'Make a little room for focused work.';

  if(authLoading) return <div aria-busy="true" aria-label="Checking sign-in" style={{minHeight:'100dvh',background:'var(--bg)'}}/>;
  if(!user) return <Auth/>;

  return <div className={'app-shell'+(workspaceMode==='internship'?' internship-mode':'')} onClickCapture={e=>{if((e.target as HTMLElement).closest('button,summary,[role=button]'))triggerKramHaptic(vibrationEnabled,'light');}}>
    <aside className="sidebar">
      <div className="brand"><img className="brand-icon" src="/kram-icon.svg" alt="KRAM"/><div><strong>{workspaceMode==='internship'?'KRAM WORK':'KRAM'}</strong><span>{workspaceMode==='internship'?'INTERNSHIP DESK':'PERSONAL PLANNER'}</span></div></div>
      <div className="workspace-label">{workspaceMode==='internship'?'WORK HUB':'PERSONAL SPACE'}</div>
      <nav>{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'nav-item active':'nav-item'} onClick={()=>{setTab(id);if(id==='internship-todo'||id==='internship-deadlines'){setInternshipFilter('Open');setInternshipSearch('');setWorkFiltersOpen(false);}}}><Icon size={19}/><span>{label}</span>{id==='tasks'&&<small>{tasks.filter(t=>t.listKind!=='someday'&&!t.completed).length}</small>}{id==='internship-todo'&&<small>{workOpen.length}</small>}{id==='internship-deadlines'&&workOverdue.length>0&&<small>{workOverdue.length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{(user.displayName||user.email||'U').charAt(0).toUpperCase()}</div><div className="user-details"><strong>{user.displayName||'My planner'}</strong><span>{user.email}</span></div></div></div>
    </aside>
    {deletionNotice?.uid===user.uid?<div className="momentum-toast deletion-notice" style={{zIndex:85,pointerEvents:'auto'}}><span role="status">{deletionNotice.message}</span>{deletionNotice.item&&<button type="button" className="undo-delete-button" style={{background:'var(--green)',color:'var(--surface)',fontWeight:750}} disabled={undoBusy} onClick={()=>void undoDeletion()}>{undoBusy?'Restoring…':'Undo'}</button>}<button type="button" className="notice-close" disabled={undoBusy} aria-label="Dismiss message" onClick={()=>setDeletionNotice(null)}><X size={17}/></button></div>:momentumToast&&<div key={momentumToastKey} className="momentum-toast" role="status"><span>{momentumToast}</span></div>}
   <main className="main-area">
      <header className="topbar"><button className="mobile-brand" aria-label="Open navigation menu" aria-expanded={mobileMenu} onClick={()=>setMobileMenu(!mobileMenu)}><b>kram.</b></button><div className="breadcrumb">{workspaceMode==='internship'?'Internship desk':'My workspace'} <span>/</span> <strong>{navItems.find(n=>n[0]===tab)?.[1]}</strong></div><div className="top-actions"><details className="workspace-picker" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false;}}><summary aria-label="Switch workspace">{workspaceMode==='personal'?<LayoutDashboard size={15}/>:<BriefcaseBusiness size={15}/>}<span>{workspaceMode==='personal'?'Personal':'Internship'}</span><ChevronRight className="workspace-caret" size={13}/></summary><div className="workspace-picker-menu" role="group" aria-label="Choose workspace"><button type="button" className={workspaceMode==='personal'?'selected':''} aria-pressed={workspaceMode==='personal'} onClick={e=>{const picker=e.currentTarget.closest('details');if(picker){picker.open=false;picker.querySelector('summary')?.focus();}if(workspaceMode!=='personal'){setWorkspaceMode('personal');setTab('today');setSelectedDate(todayKey());}}}><LayoutDashboard size={16}/> Personal {workspaceMode==='personal'&&<Check size={15}/>}</button><button type="button" className={workspaceMode==='internship'?'selected':''} aria-pressed={workspaceMode==='internship'} onClick={e=>{const picker=e.currentTarget.closest('details');if(picker){picker.open=false;picker.querySelector('summary')?.focus();}if(workspaceMode!=='internship'){setWorkspaceMode('internship');setTab('internship');}}}><BriefcaseBusiness size={16}/> Internship {workspaceMode==='internship'&&<Check size={15}/>}</button></div></details><span className={hasSyncIssue?"sync-label sync-error":"sync-label"}><span className="sync-dot"/>{hasSyncIssue?"Sync issue":!allSyncReady||!entryReady?"Syncing…":"Synced"}</span><button className="icon-button" aria-label="Reminder settings" onClick={()=>setAlertsOpen(true)} title="Reminder settings"><Bell size={18}/></button><button className="icon-button theme-button" aria-label={dark?'Switch to light theme':'Switch to dark theme'} onClick={()=>setDark(!dark)} title="Toggle theme">{dark?<Sun size={18}/>:<Moon size={18}/>}</button><button type="button" className="mobile-profile" aria-label="Open settings" onClick={()=>{setTab('settings');setMobileMenu(false);}}>{(user.displayName||user.email||'K').slice(0,1).toUpperCase()}</button></div></header>
      {hasSyncIssue&&<div className="sync-error-banner" role="alert">{syncError||"Some planner data could not sync. Check your connection and reload KRAM."}</div>}{mobileMenu&&<div className="mobile-menu-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setMobileMenu(false)}}><aside className="mobile-menu-drawer"><div className="mobile-menu-heading"><div><strong>KRAM</strong><span>YOUR WORKSPACE</span></div><button className="icon-button" onClick={()=>setMobileMenu(false)} aria-label="Close menu"><X size={20}/></button></div>{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'mobile-menu-item active':'mobile-menu-item'} onClick={()=>{setTab(id);setMobileMenu(false)}}><Icon size={19}/>{label}{id==='tasks'&&<small>{tasks.filter(t=>t.listKind!=='someday'&&!t.completed).length}</small>}</button>)}<div className="mobile-menu-footer"><span>Signed in as</span><strong>{user.email}</strong></div></aside></div>}
      <AnimatePresence mode="wait" initial={false}><motion.div className={'page-content kram-motion-page page-'+tab} key={workspaceMode+'-'+tab} {...pageMotion}>
        {tab==='fitness'&&<FitnessGuide key={user.uid} uid={user.uid} today={dateKey(clockNow)}/>}
        {tab==='today'&&<><button type="button" className="secondary-button" style={{width:'100%',justifyContent:'space-between',height:'auto',minHeight:48,marginBottom:12,whiteSpace:'normal',textAlign:'left'}} onClick={()=>setTab('fitness')}><span style={{display:'flex',alignItems:'center',gap:10}}><Dumbbell size={19}/><span>Today's workout</span></span><ChevronRight size={18}/></button>{personalPrefs.shloka&&<section className={'gita-wisdom-card gita-compact'+(shlokaExpanded?' is-expanded':'')}><button type="button" className="gita-toggle" aria-expanded={shlokaExpanded} aria-controls="daily-shloka-content" onClick={()=>setShlokaExpanded(v=>!v)}><span className="gita-wisdom-mark" aria-hidden="true">ॐ</span><span className="gita-preview"><span className="gita-preview-title">Daily shloka <small>{dailyGitaWisdom(clockNow).reference}</small></span><span className="gita-preview-verse">{dailyGitaWisdom(clockNow).meaning}</span></span><ChevronRight size={18} className="gita-chevron"/></button><div className="gita-expand" id="daily-shloka-content" inert={!shlokaExpanded}><div className="gita-expand-inner"><p className="gita-wisdom-verse" lang="sa-Latn">{dailyGitaWisdom(clockNow).transliteration}</p><p className="gita-wisdom-meaning">“{dailyGitaWisdom(clockNow).meaning}”</p><span className="gita-wisdom-reference">{dailyGitaWisdom(clockNow).reference}</span></div></div></section>}<div className="page-heading personalized-heading"><div className="personal-heading-copy"><h1>{selectedDate===entryToday?(personalPrefs.greeting?greetingText:'Your day.'):prettyDate(selectedDate,{weekday:'long'})+'.'}</h1><p className="personal-daily-message">{prettyDate(selectedDate)}{selectedDate===entryToday&&personalPrefs.encouragement&&dailyMessage?' · '+dailyMessage:''}</p></div><div className={'entry-streak-badge'+(entryReady&&entryStreak.loggedToday?' is-logged':'')} style={{position:'relative',cursor:'pointer'}} aria-label={entryReady?entryStreak.current+' day daily entry streak':entryLog.error?'Daily entry streak unavailable':'Daily entry streak syncing'} title={entryReady?(entryStreak.loggedToday?'Today counted':'Today not counted · add an entry or complete a task or habit'):'Daily entry streak'}><Flame size={21} aria-hidden="true"/><span className="entry-streak-badge-copy"><strong>{entryReady?entryStreak.current:'—'}</strong><small>{entryReady?(entryStreak.loggedToday?'Today counted':'Today pending'):'Entry streak'}</small></span><DashboardJump label="Open progress and daily entry streak" onOpen={()=>openDashboardTab('progress')}/></div></div>
          <div className="date-switch"><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-1);setSelectedDate(dateKey(d));}}><ChevronLeft size={18}/></button><button className="date-current" onClick={()=>setSelectedDate(todayKey())}><CalendarDays size={16}/>{selectedDate===todayKey()?'Today':prettyDate(selectedDate,{month:'short',day:'numeric',year:'numeric'})}</button><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+1);setSelectedDate(dateKey(d));}}><ChevronRight size={18}/></button></div>
          {(plannedCount>0||habits.length>0)&&<section className="daily-mosaic daily-counts" aria-label="Daily summary"><div className="mosaic-tile mosaic-schedule" style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open Planner" onOpen={()=>openDashboardTab('schedule')}/><CalendarDays size={19}/><strong>{activeBlocks.length+todaysTasks.filter(t=>!!t.dueTime&&!t.completed).length}</strong><small>Planned today</small></div><div className="mosaic-tile mosaic-habits" style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open Habits" onOpen={()=>openDashboardTab('habits')}/><Flame size={19}/><strong>{todayCheckins}<small>/{habits.length}</small></strong><small>Habits done</small></div></section>}
          
          <div className="glance-grid">
            <section className={"today-agenda glance-panel"+(!plannedCount?" compact-empty-glance":"")} style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open today's schedule in Planner" onOpen={()=>openDashboardTab('schedule')}/><div className="section-heading"><h2>Schedule</h2><span className="glance-count">{activeBlocks.length+todaysTasks.filter(t=>!!t.dueTime&&!t.completed).length}</span></div>
              {[...activeBlocks.map(b=>({id:b.id,title:b.title,time:b.startTime,kind:'Commitment'})),...todaysTasks.filter(t=>!!t.dueTime&&!t.completed).map(t=>({id:t.id,title:t.title,time:t.dueTime!,kind:'Task'}))].sort((a,b)=>a.time.localeCompare(b.time)).slice(0,5).map(item=><div className="glance-row" key={item.kind+item.id}><span className={'glance-symbol '+(item.kind==='Commitment'?'glance-lavender':'glance-peach')}>{item.kind==='Commitment'?<CalendarDays size={17}/>:<ListTodo size={17}/>}</span><span className="glance-name">{item.title}</span><time>{displayTime(item.time)}</time></div>)}
              {!activeBlocks.length&&!todaysTasks.some(t=>t.dueTime&&!t.completed)&&<div className="glance-empty"><CalendarDays size={18}/> Nothing scheduled</div>}
              {activeBlocks.length+todaysTasks.filter(t=>!!t.dueTime&&!t.completed).length>5&&<div className="glance-more">+{activeBlocks.length+todaysTasks.filter(t=>!!t.dueTime&&!t.completed).length-5} more</div>}
            </section>
            <section className={"glance-panel glance-tasks"+(!todaysTasks.length?" compact-empty-glance":"")} style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open today's tasks in To-do" onOpen={()=>openDashboardTab('tasks')}/><div className="section-heading"><h2>To-do</h2><span className="glance-count">{doneCount}/{todaysTasks.length}</span></div>
              {[...todaysTasks].sort((a,b)=>Number(a.completed)-Number(b.completed)).slice(0,5).map(t=><div className={'glance-row '+(t.completed?'glance-completed':'')} key={t.id}><span className="glance-symbol glance-neutral">{t.completed?<CheckCircle2 size={17}/>:<Circle size={17}/>}</span><span className="glance-name">{t.title}</span>{t.completed?<small>Done</small>:isTaskOverdue(t,selectedDate,clockNow)?<small className="glance-overdue">Overdue</small>:null}</div>)}
              {!todaysTasks.length&&<div className="glance-empty"><CheckCircle2 size={18}/> No tasks today</div>}
              {todaysTasks.length>5&&<div className="glance-more">+{todaysTasks.length-5} more</div>}
            </section>
            <section className={"glance-panel glance-habits"+(!habits.length?" compact-empty-glance":"")} style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open Habits" onOpen={()=>openDashboardTab('habits')}/><div className="section-heading"><h2>Habits</h2><span className="glance-count">{todayCheckins}/{habits.length}</span></div>
              {habits.slice(0,5).map(h=>{const entry=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate);return <div className="glance-row" key={h.id}><span className={'glance-symbol '+(h.goalType==='quit'?'glance-peach':'glance-lavender')} aria-label={h.goalType==='quit'?'Quit habit':'Build habit'}>{h.goalType==='quit'?<ShieldCheck size={17}/>:h.emoji||'✦'}</span><span className="glance-name">{h.name}</span>{entry?.completed?<CheckCircle2 size={17} aria-label="Completed"/>:entry?.skipped?<small>Skipped</small>:isQuantityHabit(h)?<small>{entry?.value||0}/{h.targetValue||0} {h.unit||''}</small>:<Circle size={16} aria-label="Not completed"/>}</div>})}
              {!habits.length&&<div className="glance-empty"><Target size={18}/> No habits yet</div>}
              {habits.length>5&&<div className="glance-more">+{habits.length-5} more</div>}
            </section>
          </div>
          <section className="daily-mosaic momentum-only" aria-label="Daily momentum"><div className="mosaic-progress" style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open Progress" onOpen={()=>openDashboardTab('progress')}/><div className="mosaic-label"><span>Daily momentum</span><TrendingUp size={19}/></div><strong>{todaysTasks.length?completion+"%":"—"}</strong><div className="mosaic-bars" aria-label="Task completion over the last seven days">{week.map((d,i)=><div key={d.key}><span className="mosaic-bar-track"><i style={{height:(d.total?Math.max(5,d.done/d.total*100):4)+'%'}} className={i===week.length-1?'current':''}/></span><small>{d.label.slice(0,1)}</small></div>)}</div><div className="mosaic-foot">{todaysTasks.length?doneCount+" of "+todaysTasks.length+" tasks done":"Nothing planned yet"}</div></div></section>
        </>}
        {tab==='schedule'&&<><div className="page-heading"><div><h1>Planner</h1></div><button className="primary-button" title="Add commitment" aria-label="Add commitment" onClick={openBlockForm}><CalendarDays size={18}/><Plus size={14}/></button></div>
          <div className="schedule-date-row"><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-1);setSelectedDate(dateKey(d));setSmartMessage('');}}><ChevronLeft size={18}/></button><strong>{prettyDate(selectedDate,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</strong><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+1);setSelectedDate(dateKey(d));setSmartMessage('');}}><ChevronRight size={18}/></button><button className="text-button" onClick={()=>setSelectedDate(todayKey())}>Today</button></div>
          <div className="timetable-week-strip">{Array.from({length:7},(_,i)=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-d.getDay()+i);const key=dateKey(d);return <button key={key} className={key===selectedDate?'timetable-day selected':'timetable-day'} onClick={()=>setSelectedDate(key)}><span>{d.toLocaleDateString('en-IN',{weekday:'short'})}</span><strong>{d.getDate()}</strong></button>})}</div>
          <div className="desktop-planner-grid"><div className="desktop-planner-tools"><section className="schedule-planner-card timetable-tools"><div className="schedule-card-heading"><div><h2>Fill my free time</h2></div><div className="schedule-spark">✦</div></div><button className="primary-button smart-plan-button" onClick={scheduleTasks} disabled={scheduling}>{scheduling?'Finding free time…':'✦  Auto-schedule tasks'}</button>{smartMessage&&<p className="schedule-message" role="status">{smartMessage}</p>}</section>
          {overdueTasks.length>0&&<section className="content-section overdue-panel"><div className="section-heading"><div><h2><span className="overdue-heading-dot"/> Overdue <span className="task-count overdue-count">{overdueTasks.length}</span></h2></div></div><div className="task-list">{overdueTasks.map(t=><div className="task-row overdue-task-row" key={t.id}><button type="button" className={"task-check schedule-task-check"+(t.completed?" is-checked":"")} title={t.completed?"Mark incomplete":"Mark complete"} aria-label={t.completed?"Mark incomplete":"Mark complete"} aria-pressed={t.completed} onClick={()=>toggleTask(t)}><span className="schedule-checkbox-mark">{t.completed?<Check size={15}/>:null}</span></button><button className="task-main" onClick={()=>openEditTask(t)}><strong>{t.title}</strong><small><span className="overdue-label">OVERDUE</span>{t.dueDate||t.scheduledDate?prettyDate(t.dueDate||t.scheduledDate!,{month:'short',day:'numeric'}):'Past scheduled time'}{t.dueTime?' · '+displayTime(t.dueTime):''} · {t.durationMinutes||60} min</small></button><div className="task-row-actions"><button className="icon-button" title="Reschedule task" aria-label="Reschedule task" onClick={()=>{openEditTask(t);setScheduleDate(selectedDate);setDueTime('');setEndTime('');}}><CalendarDays size={18}/></button><button className="icon-button delete-button" title="Delete task" onClick={()=>handleDeleteTask(t.id)}><Trash2 size={16}/></button></div></div>)}</div></section>}
          <section className="content-section unscheduled-panel"><div className="section-heading"><div><h2>To-dos to schedule <span className="task-count">{unscheduledTasks.length}</span></h2></div></div>{unscheduledTasks.length===0?<div className="schedule-message">Nothing to schedule</div>:<div className="task-list">{unscheduledTasks.map(t=><div className="task-row" key={t.id} draggable onDragStart={()=>setDragTaskId(t.id)} onDragEnd={()=>setDragTaskId('')}><button type="button" className={"task-check schedule-task-check"+(t.completed?" is-checked":"")} title={t.completed?"Mark incomplete":"Mark complete"} aria-label={t.completed?"Mark incomplete":"Mark complete"} aria-pressed={t.completed} onClick={()=>toggleTask(t)}><span className="schedule-checkbox-mark">{t.completed?<Check size={15}/>:null}</span></button><button className="task-main" onClick={()=>openEditTask(t)}><strong>{t.title}</strong><small><i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority} priority · {t.durationMinutes||60} min</small></button><div className="task-row-actions">{!t.completed&&<button className="icon-button" title="Schedule task" aria-label="Schedule task" onClick={()=>openTaskSchedule(t)}><CalendarDays size={18}/></button>}<button className="icon-button delete-button" title="Delete task" onClick={()=>handleDeleteTask(t.id)}><Trash2 size={16}/></button></div></div>)}</div>}</section>
          </div><section className="content-section schedule-section"><div className="section-heading"><div><h2>Timeline</h2></div></div><div className="timeline-legend"><span><i className="legend-class"/> Classes & commitments</span><span><i className="legend-task"/> Tasks</span><span><i className="legend-overdue"/> Overdue</span></div><div className="full-day-timeline">{Array.from({length:24},(_,hour)=>{const hourStart=hour*60;const label=hour===0?'12 AM':hour<12?hour+' AM':hour===12?'12 PM':(hour-12)+' PM';return <div className="timetable-hour" key={hour} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragTaskId)placeTaskAt(dragTaskId,minutesToTime(hourStart));}}><div className="timetable-hour-label">{label}</div><div className="timetable-hour-content"><button className="timetable-open-slot" aria-label={"Add task at "+label} title={"Add task at "+label} onClick={()=>openNewTaskAt(minutesToTime(hourStart))}><Plus size={14} aria-hidden="true"/></button></div></div>})}{selectedDate===entryToday&&<div className="timetable-now-line" style={{top:`calc(var(--hour-height) * ${(clockNow.getHours()*60+clockNow.getMinutes())/60} + 7px)`}}><span>{displayTime(minutesToTime(clockNow.getHours()*60+clockNow.getMinutes()))}</span></div>}{todaysTasks.filter(t=>!t.completed&&!!t.dueTime&&!isTaskOverdue(t,selectedDate,clockNow)).map(t=>{const start=timeToMinutes(t.dueTime!);const duration=t.durationMinutes||30;return <div className={duration<=15?"timetable-event task-event task-event-span task-event-compact":"timetable-event task-event task-event-span"} key={t.id} draggable onDragStart={()=>setDragTaskId(t.id)} onDragEnd={()=>setDragTaskId('')} style={{top:`calc(var(--hour-height) * ${start/60} + 7px)`,height:`max(30px, calc(var(--hour-height) * ${duration/60} - 4px))`}}><button className="timetable-complete" title="Mark complete" aria-label="Mark complete" onClick={()=>toggleTask(t)}><Circle size={17}/></button><button className="timetable-event-main" onClick={()=>openEditTask(t)}><span className="timeline-type-tag task-type-tag" title={t.priority+' priority'} aria-label={t.priority+' priority'}><i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority}</span><strong>{t.title}</strong><span>{displayTime(t.dueTime!)} · {duration} min</span></button><div className="timetable-event-actions"><button title="Edit task" aria-label="Edit task" onClick={()=>openEditTask(t)}><Clock3 size={14}/></button><button title="Remove from schedule" aria-label="Remove from schedule" onClick={async()=>{try{await updatePlannerTask(t.id,{scheduledDate:'',dueTime:''});setSmartMessage('Task removed from the timetable and kept in your task list.');}catch(error){console.error(error);setSmartMessage('Could not remove this task from the timetable. Please try again.');}}}><CalendarDays size={15}/></button></div></div>})}{activeBlocks.map(x=>{const start=timeToMinutes(x.startTime);const duration=timeToMinutes(x.endTime)-start;return <div className="timetable-event fixed-event fixed-event-span" key={x.id} style={{top:`calc(var(--hour-height) * ${start/60} + 7px)`,height:`calc(var(--hour-height) * ${duration/60} - 14px)`}}><div><span className="timeline-type-tag class-type-tag" title={x.repeat==='weekly'?'Recurring commitment':'One-time commitment'}>{x.repeat==='weekly'?'Weekly':'Once'}</span><strong>{x.title}</strong><span>{displayTime(x.startTime)}–{displayTime(x.endTime)} · {x.repeat==='weekly'?'Weekly':'One-time'}</span></div><div className="timetable-event-actions"><button title="Edit commitment" aria-label="Edit commitment" onClick={()=>openEditBlock(x)}><Clock3 size={14}/></button><button title="Delete commitment" aria-label="Delete commitment" onClick={()=>handleDeleteBlock(x.id)}><Trash2 size={15}/></button></div></div>})}</div></section></div>

        </>}
        {tab==='tasks'&&<><div className="page-heading"><div><h1>To-do</h1></div><div className="list-heading-actions"><button type="button" className={"icon-button list-filter-toggle"+(taskFiltersOpen||listHasFilters?" active":"")} aria-expanded={taskFiltersOpen} aria-label="Search, filter and sort" onClick={()=>setTaskFiltersOpen(v=>!v)}><SlidersHorizontal size={20}/>{listHasFilters&&<i/>}</button><button className="primary-button desktop-list-add" title={listView==='someday'?'Add idea':'Add to-do'} aria-label={listView==='someday'?'Add idea':'Add to-do'} onClick={()=>openNewTask(selectedDate,listView)}><Plus size={20}/></button></div></div>
          <div className="todo-switch" role="group" aria-label="Choose a list"><button type="button" className={listView==='todo'?'selected':''} aria-pressed={listView==='todo'} onClick={()=>{setListView('todo');setTaskQuery('');setPriorityFilter('All');setCompletedExpanded(false);setQuickTaskTitle('');setListError('');}}><ListTodo size={18}/> To-do <span>{tasks.filter(t=>t.listKind!=='someday'&&!t.completed).length}</span></button><button type="button" className={listView==='someday'?'selected':''} aria-pressed={listView==='someday'} onClick={()=>{setListView('someday');setTaskQuery('');setPriorityFilter('All');setCompletedExpanded(false);setQuickTaskTitle('');setListError('');}}><Lightbulb size={18}/> Someday <span>{tasks.filter(t=>t.listKind==='someday'&&!t.completed).length}</span></button></div>
          
          <form className="quick-add-task list-quick-add" onSubmit={saveQuickTask}><Plus size={18}/><input aria-label={listView==='someday'?'Add an idea':'Add a to-do'} maxLength={120} placeholder={listView==='someday'?'What do you want to do someday?':'What do you want to do?'} value={quickTaskTitle} onChange={e=>setQuickTaskTitle(e.target.value)}/><button className="quick-add-submit" type="submit" disabled={!quickTaskTitle.trim()||quickTaskSaving}>{quickTaskSaving?'Adding…':'Add'}</button></form>
          {quickTaskError&&<p className="quick-add-error" role="alert">{quickTaskError}</p>}
          {taskFiltersOpen&&<div className="task-tools compact-task-tools"><label className="task-search"><Search size={17}/><input aria-label="Search list" placeholder={listView==='someday'?'Search ideas…':'Search to-dos…'} value={taskQuery} onChange={e=>setTaskQuery(e.target.value)}/>{taskQuery&&<button type="button" onClick={()=>setTaskQuery('')} aria-label="Clear search"><X size={15}/></button>}</label><label className="task-tool-select"><span>Priority</span><select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value as 'All'|'High'|'Medium'|'Low')}><option>All</option><option>High</option><option>Medium</option><option>Low</option></select></label><label className="task-tool-select"><span>Sort</span><select value={taskSort} onChange={e=>setTaskSort(e.target.value as 'Date'|'Priority'|'Title')}><option>Date</option><option>Priority</option><option>Title</option></select></label>{listHasFilters&&<button type="button" className="text-button" onClick={()=>{setTaskQuery('');setPriorityFilter('All');}}>Clear filters</button>}</div>}
          {listError&&<p className="quick-add-error" role="alert">{listError}</p>}
          <AnimatePresence mode="wait" initial={false}><motion.div key={listView} {...pageMotion}><TaskList tasks={openListItems} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} showDate={listView==='todo'} emptyAction={()=>openNewTask(selectedDate,listView)} someday={listView==='someday'} onSchedule={listView==='todo'?openTaskSchedule:undefined} onPromote={listView==='someday'?moveToTodo:undefined} movingId={movingTaskId} emptyTitle={listHasFilters?"No matching open items":completedListItems.length?"All caught up":undefined}/>{completedListItems.length>0&&<section className="completed-list"><button type="button" className="completed-list-toggle" aria-expanded={completedExpanded} onClick={()=>setCompletedExpanded(v=>!v)}><CheckCircle2 size={18}/><strong>Completed</strong><span>{completedListItems.length}</span><ChevronRight size={17} className={completedExpanded?"expanded":""}/></button>{completedExpanded&&<TaskList tasks={completedListItems} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} showDate={listView==='todo'} emptyAction={()=>openNewTask(selectedDate,listView)} someday={listView==='someday'}/>}</section>}</motion.div></AnimatePresence></>}
        {tab==='internship'&&<><div className="page-heading personalized-heading"><div className="personal-heading-copy"><h1>Internship desk</h1>{personalPrefs.greeting&&<p>{greetingText}</p>}{personalPrefs.encouragement&&<p className="personal-daily-message">{workMessage}</p>}</div><button className="primary-button" title="Add work" aria-label="Add work" onClick={()=>openInternshipForm()}><Plus size={20}/></button></div>
          <section className="internship-summary"><div style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open internship to-do" onOpen={()=>openDashboardTab('internship-todo')}/><span>Open work</span><strong>{workOpen.length}</strong></div><div style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open overdue deadlines" onOpen={()=>openDashboardTab('internship-deadlines','Overdue')}/><span>Overdue</span><strong>{workOverdue.length}</strong></div><div style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open completed internship work" onOpen={()=>openDashboardTab('internship-todo','Completed')}/><span>Completed</span><strong>{internshipTasks.length-workOpen.length}</strong></div></section>
          {internshipError&&!internshipFormOpen&&<p className="quick-add-error" role="alert">{internshipError}</p>}
          <div className="work-overview-grid"><section className="glance-panel work-glance" style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open internship deadlines" onOpen={()=>openDashboardTab('internship-deadlines')}/><div className="section-heading"><h2>Next deadlines</h2><span className="glance-count">{workDated.length}</span></div>{workDated.slice(0,5).map(t=><div className="glance-row" key={t.id}><span className="glance-symbol glance-peach"><CalendarDays size={17}/></span><span className="glance-name">{t.title}</span><small className={t.dueDate<workToday?'glance-overdue':''}>{t.dueDate<workToday?'Overdue · ':''}{prettyDate(t.dueDate,{month:'short',day:'numeric'})}</small></div>)}{!workDated.length&&<div className="glance-empty"><CalendarDays size={18}/> No upcoming deadlines</div>}{workDated.length>5&&<div className="glance-more">+{workDated.length-5} more</div>}</section>
          <section className="glance-panel work-glance" style={{position:'relative',cursor:'pointer'}}><DashboardJump label="Open internship to-do" onOpen={()=>openDashboardTab('internship-todo')}/><div className="section-heading"><h2>To-do</h2><span className="glance-count">{workOpen.length}</span></div>{[...workOpen].sort((a,b)=>priorityRank(a.priority)-priorityRank(b.priority)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,5).map(t=><div className="glance-row" key={t.id}><span className="glance-symbol glance-neutral"><Circle size={16}/></span><span className="glance-name">{t.title}</span><small>{t.priority}</small></div>)}{!workOpen.length&&<div className="glance-empty"><CheckCircle2 size={18}/> No open work</div>}{workOpen.length>5&&<div className="glance-more">+{workOpen.length-5} more</div>}</section></div></>}
        {(tab==='internship-todo'||tab==='internship-deadlines')&&<><div className="page-heading"><div><h1>{tab==='internship-todo'?'Work to-do':'Deadlines'}</h1></div><div className="list-heading-actions"><button type="button" className={'icon-button list-filter-toggle'+(workFiltersOpen||!!internshipSearch||internshipFilter!=='Open'?' active':'')} aria-label="Filter internship work" aria-expanded={workFiltersOpen} onClick={()=>setWorkFiltersOpen(v=>!v)}><SlidersHorizontal size={20}/></button><button className="primary-button desktop-list-add" title={tab==='internship-deadlines'?'Add deadline':'Add work'} aria-label={tab==='internship-deadlines'?'Add deadline':'Add work'} onClick={()=>openInternshipForm()}><Plus size={20}/></button></div></div>
          {tab==='internship-todo'&&<form className="quick-add-task work-quick-add" onSubmit={saveQuickWork}><Plus size={18}/><input aria-label="Quick add internship task" maxLength={120} placeholder="What do you need to work on?" value={workQuickTitle} onChange={e=>setWorkQuickTitle(e.target.value)}/><button className="quick-add-submit" type="submit" disabled={!workQuickTitle.trim()||workQuickBusy}>{workQuickBusy?'Adding…':'Add'}</button></form>}
          {!workFiltersOpen&&(!!internshipSearch||internshipFilter!=='Open')&&<button type="button" className="text-button active-work-filter" onClick={()=>setWorkFiltersOpen(true)}>Filtered: {internshipFilter}{internshipSearch?' · Search':''}</button>}{workFiltersOpen&&<div className="work-list-tools"><label className="task-search internship-search"><Search size={17}/><input aria-label="Search internship work" placeholder="Search work…" value={internshipSearch} onChange={e=>setInternshipSearch(e.target.value)}/>{internshipSearch&&<button type="button" onClick={()=>setInternshipSearch('')} aria-label="Clear search"><X size={15}/></button>}</label><div className="filter-row">{(['Open','Overdue','Completed','All'] as const).map(f=><button key={f} className={internshipFilter===f?'filter-pill selected':'filter-pill'} onClick={()=>setInternshipFilter(f)}>{f}<span>{workBase.filter(t=>f==='All'||(f==='Open'?!t.completed:f==='Completed'?t.completed:!t.completed&&!!t.dueDate&&t.dueDate<workToday)).length}</span></button>)}</div></div>}{internshipError&&!internshipFormOpen&&<p className="quick-add-error" role="alert">{internshipError}</p>}
          <div className="internship-work-list">{(tab==='internship-deadlines'?deadlineGroups:[{label:'',items:workVisible}]).map(group=><section className="work-date-group" key={group.label||'work'}>{group.label&&<h3>{group.label}<span>{group.items.length}</span></h3>}{group.items.map(task=><article className={'internship-work-card'+(task.completed?' completed':'')} key={task.id}><button className="task-check" type="button" aria-label={task.completed?'Mark incomplete':'Mark complete'} onClick={()=>toggleInternshipTask(task)}>{task.completed?<Check size={15}/>:<Circle size={19}/>}</button><button className="internship-work-main" type="button" onClick={()=>openInternshipForm(task)}><strong>{task.title}</strong>{task.notes&&<span>{task.notes}</span>}<small>{task.dueDate?<><CalendarDays size={13}/>{prettyDate(task.dueDate,{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</>:<><CalendarDays size={13}/>No deadline set</>}{!task.completed&&!!task.dueDate&&task.dueDate<todayKey()&&<em>OVERDUE</em>}<i className={'priority-dot '+task.priority.toLowerCase()}/>{task.priority} priority</small></button><button type="button" className="icon-button delete-button" aria-label="Delete internship work" onClick={()=>removeInternshipTask(task)}><Trash2 size={16}/></button></article>)}</section>)}{!workVisible.length&&<div className="empty-state work-empty-state"><div className="empty-icon">{tab==='internship-deadlines'?<CalendarDays size={23}/>:<BriefcaseBusiness size={23}/>}</div><strong>{secondarySync.work==='loading'?'Loading work…':secondarySync.work==='error'?'Could not load work':!workBase.length?(tab==='internship-deadlines'?'No deadlines yet':'No work yet'):(tab==='internship-deadlines'?'No matching deadlines':'No matching work')}</strong><p>{secondarySync.work==='loading'?'Syncing your workspace.':secondarySync.work==='error'?'Check your connection and reload.':!workBase.length?(tab==='internship-deadlines'?'Keep track of upcoming due dates.':'Add your first internship to-do.'):'Try a different search or filter.'}</p>{secondarySync.work==='ready'&&(!workBase.length?<button type="button" className="secondary-button" onClick={()=>openInternshipForm()}><Plus size={16}/> {tab==='internship-deadlines'?'Add deadline':'Add work'}</button>:<button type="button" className="secondary-button" onClick={()=>{setInternshipSearch('');setInternshipFilter('All');}}>Clear filters</button>)}</div>}</div></>}
        {tab==='upcoming'&&<><div className="page-heading"><div><h1>Upcoming</h1><p>Next 14 days</p></div><button className="primary-button" onClick={()=>openNewTask(todayKey())}><Plus size={18}/> Add task</button></div>{upcomingDays.length===0?<div className="empty-state"><div className="empty-icon"><CalendarRange size={23}/></div><strong>Nothing coming up</strong><button className="secondary-button" onClick={()=>openNewTask(todayKey())}><Plus size={16}/> Add a task</button></div>:upcomingDays.map(day=><section className="content-section" key={day.key}><div className="section-heading"><div><h2>{day.label}</h2><p>{day.items.length} task{day.items.length===1?'':'s'} planned</p></div></div><TaskList tasks={day.items} onToggle={toggleTask} onEdit={openEditTask} onDelete={handleDeleteTask} showDate emptyAction={()=>openNewTask(day.key)}/></section>)}</>}
        {tab==='habits'&&<><div className="page-heading"><div><h1>Habits</h1></div><button className="primary-button" title="Add habit" aria-label="Add habit" onClick={()=>{openHabitForm();}}><Plus size={20}/></button></div><div className="habit-date-note"><CalendarDays size={17}/> <strong>{prettyDate(selectedDate)}</strong>{selectedDate!==todayKey()&&<button className="icon-button" title="Go to today" aria-label="Go to today" onClick={()=>setSelectedDate(todayKey())}><CalendarDays size={18}/></button>}</div><div className="timetable-week-strip habit-week-strip">{Array.from({length:7},(_,i)=>{const d=new Date(mondayWeekStart(selectedDate)+"T12:00:00");d.setDate(d.getDate()+i);const key=dateKey(d);return <button type="button" key={key} className={key===selectedDate?"timetable-day selected":"timetable-day"} onClick={()=>setSelectedDate(key)}><span>{d.toLocaleDateString("en-IN",{weekday:"short"})}</span><strong>{d.getDate()}</strong></button>})}</div>{habitError&&<div className="habit-error-banner" role="alert">{habitError}</div>}<HabitList onCreate={()=>openHabitForm()} onTemplate={openHabitForm} habits={habits} checkins={checkins} date={selectedDate} onToggle={toggleHabit} onSkip={skipHabit} onRecord={recordHabitValue} onDelete={handleDeleteHabit}/></>}
        {tab==='progress'&&<><div className="page-heading"><div><h1>Progress</h1></div></div><section className="content-section reward-level-card"><div className="reward-level-top"><div><span>Habit rewards</span><h2>Level {Math.floor(rewardXP/100)+1}</h2></div><details className="reward-info"><summary aria-label="How XP is earned"><Info size={18}/></summary><p>Earn 10 XP per completed check-in or 15 XP per measurable target. Skips earn no XP. Every 100 XP advances a level.</p></details></div><div className="reward-progress-label"><strong>{rewardXP%100}/100 XP</strong><span>{rewardXP} total XP</span></div><div className="reward-progress-track" role="progressbar" aria-label="Level XP" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rewardXP%100}><i style={{width:(rewardXP%100)+'%'}}/></div></section><section className="content-section entry-streak-progress"><div className="section-heading"><h2>Consistency</h2></div><div className="entry-streak-totals"><div><span>Daily entry streak</span><strong>{entryReady?entryStreak.current:'—'} <small>days</small></strong><small>Best: {entryReady?entryStreak.best:'—'}</small><small>{entryReady?(entryStreak.loggedToday?'Today counted':'Today not counted yet'):'Syncing activity'}</small></div><div><span>Habit check-in streak</span><strong>{secondarySync.checkins==='ready'?habitActivityStreak:'—'} <small>days</small></strong><small>At least one habit completed</small></div></div><div className="entry-streak-days" aria-label="Daily entry activity in the last seven days">{entryStreak.recent.map(d=><span className={'entry-day'+(d.logged&&entryReady?' logged':'')+(d.key===entryToday?' current':'')} key={d.key}><span>{d.logged&&entryReady?<Check size={13}/>:<span className="entry-day-dot"/>}</span><small>{d.label.slice(0,1)}</small></span>)}</div><details className="entry-streak-explanation"><summary><Info size={14}/> Streak rules</summary><p>Add or edit an entry, complete a task, or log a habit to count today. Opening, syncing and skipping do not count. Yesterday’s streak stays visible until today ends. Older unverified markers are excluded.</p></details></section><section className="content-section achievement-section"><div className="section-heading"><h2>Achievements</h2></div>{[{name:'First win',icon:'🏅',value:rewardCheckins.length,target:1},{name:'7 active days',icon:'🔥',value:rewardDays.size,target:7},{name:'500 XP milestone',icon:'⭐',value:rewardXP,target:500}].map(a=><div className="achievement-row" key={a.name}><span className="habit-emoji">{a.icon}</span><div><strong>{a.name}</strong><div className="reward-progress-track"><i style={{width:Math.min(100,a.value/a.target*100)+'%'}}/></div></div><small>{a.value>=a.target?'Unlocked':Math.min(a.value,a.target)+'/'+a.target}</small></div>)}</section><section className="content-section chart-section"><div className="section-heading"><div><h2>Last 7 days</h2><p>Tasks completed each day.</p></div></div><div className="weekly-chart">{week.map(d=><div className="chart-column" key={d.key}><div className="chart-value">{d.done}/{d.total}</div><div className="chart-bar-area"><div className="chart-bar" style={{height:(d.total?Math.max(6,d.done/d.total*100):0)+'%'}}/></div><span>{d.label}</span></div>)}</div></section><section className="content-section chart-section"><div className="section-heading"><div><h2>Habit history · Last 90 days</h2></div></div><div className="overview-grid progress-overview"><div className="overview-card"><span className="habit-summary-label">COMPLETION RATE</span><strong className="stat-number">{history90Possible?Math.round(history90Completed/history90Possible*100)+'%':'—'}</strong><p className="stat-caption">{history90Completed} completed out of {history90Possible} habit-days.</p></div><div className="overview-card"><span className="habit-summary-label">SKIPS USED</span><strong className="stat-number">{history90Skips}</strong><p className="stat-caption">Skips protect streaks but do not earn XP.</p></div></div><div style={{display:'grid',gridTemplateColumns:'repeat(15,minmax(0,1fr))',gap:5,marginTop:16}}>{habitHistory90.map(day=><div key={day.key} title={day.key+': '+day.completed+' completed, '+day.skipped+' skipped, '+Math.max(0,day.total-day.completed-day.skipped)+' missed'} style={{aspectRatio:'1',minWidth:0,borderRadius:4,background:day.total===0?'var(--surface-muted, #e8e8e8)':day.skipped>0&&day.completed===0?'#d6ad55':day.percent>=100?'#397c59':day.percent>=50?'#83b997':day.percent>0?'#c3dfcb':'var(--surface-muted, #e8e8e8)'}} aria-label={day.key+' habit progress'} />)}</div><div style={{display:'flex',gap:14,flexWrap:'wrap',fontSize:12,marginTop:12,color:'var(--text-muted, #777)'}}><span>■ Completed</span><span style={{color:'#d6ad55'}}>■ Skip used</span><span>■ No completion</span></div></section></>}
        {tab==='settings'&&<><div className="page-heading"><div><h1>Settings</h1></div></div><section className="content-section settings-section personalization-section"><div className="section-heading"><h2>Personalization</h2></div><div className="settings-list"><form className="settings-row personal-name-form" onSubmit={e=>{e.preventDefault();const name=personalNameDraft.trim().slice(0,32);savePersonalPreferences({name});setPersonalNameDraft(name);}}><div className="settings-icon"><Sun size={19}/></div><label className="settings-copy"><strong>Preferred name</strong><input aria-label="Preferred name" placeholder={user.displayName?.trim().split(/\s+/)[0]||'Your name'} value={personalNameDraft} maxLength={32} onChange={e=>setPersonalNameDraft(e.target.value)}/></label><button type="submit" className="secondary-button" disabled={personalNameDraft.trim()===personalPrefs.name}>Save</button></form>{([{key:'greeting',title:'Time-based greeting',icon:Sun},{key:'encouragement',title:'Daily progress messages',icon:TrendingUp},{key:'shloka',title:'Daily shloka',icon:Target}] as const).map(({key,title,icon:Icon})=><label className="settings-row personal-preference-row" key={key}><span className="settings-icon"><Icon size={19}/></span><span className="settings-copy"><strong>{title}</strong></span><input type="checkbox" role="switch" checked={personalPrefs[key]} onChange={e=>savePersonalPreferences({[key]:e.target.checked})}/></label>)}</div><p className="personal-preference-note">Saved on this device.</p>{personalPrefsError&&<p role="alert" className="quick-add-error">{personalPrefsError}</p>}</section><section className="content-section settings-section"><div className="section-heading"><div><h2>Appearance</h2></div></div><div className="settings-list"><div className="settings-row"><div className="settings-icon"><Palette size={19}/></div><div className="settings-copy"><strong>Theme</strong><span>{dark?'Dark appearance':'Light appearance'}</span></div><button type="button" className="secondary-button" title={dark?'Switch to light':'Switch to dark'} aria-label={dark?'Switch to light':'Switch to dark'} onClick={()=>setDark(!dark)}>{dark?<Sun size={19}/>:<Moon size={19}/>}</button></div></div></section><section className="content-section settings-section"><div className="section-heading"><div><h2>Privacy & lock</h2></div></div><div className="settings-list"><div className="settings-row"><div className="settings-icon"><ShieldCheck size={19}/></div><div className="settings-copy"><strong>App lock</strong><span>{blockLockHash?'On':'Off'}</span></div><button type="button" className="secondary-button" onClick={startBlockLockSetup}>{blockLockHash?'Change lock':'Set up lock'}</button></div>{blockLockHash&&<button type="button" className="settings-row settings-action" onClick={startBlockLockDisable}><div className="settings-icon"><ShieldCheck size={19}/></div><div className="settings-copy"><strong>Turn off app lock</strong><span>Confirm your current block password</span></div><ChevronRight size={18}/></button>}</div></section><section className="content-section settings-section"><div className="section-heading"><div><h2>Notifications & updates</h2></div></div><div className="settings-list"><button type="button" className="settings-row settings-action" onClick={()=>{setWhatsNewOpen(true);}}><div className="settings-icon"><TrendingUp size={19}/></div><div className="settings-copy"><strong>What’s new</strong></div><ChevronRight size={18}/></button><button type="button" className="settings-row settings-action" onClick={()=>setAlertsOpen(true)}><div className="settings-icon"><BellRing size={19}/></div><div className="settings-copy"><strong>Reminder settings</strong><span>{notificationsEnabled?'Notifications enabled':'Notifications not enabled'} · Sound and vibration</span></div><ChevronRight size={18}/></button><button type="button" className="settings-row settings-action" onClick={()=>setAlertsOpen(true)}><div className="settings-icon"><Smartphone size={19}/></div><div className="settings-copy"><strong>App updates</strong><span>{Capacitor.getPlatform()==='android'?(installedVersion?'Installed v'+installedVersion:'Check installed version'):'Web version · refresh for updates'}</span></div><ChevronRight size={18}/></button></div></section><section className="content-section settings-section"><div className="section-heading"><div><h2>Account</h2></div></div><div className="settings-list"><div className="settings-row"><div className="settings-icon"><ShieldCheck size={19}/></div><div className="settings-copy"><strong>{user.displayName||'My planner'}</strong><span>{user.email}</span></div><button type="button" className="secondary-button sign-out-button" onClick={()=>{if(window.confirm('Sign out of KRAM? Your synced planner data will remain in your account.'))void signOut(auth);}}>Sign out</button></div></div></section></>}
      </motion.div></AnimatePresence>
    </main>
     {(blockLockSetup||blockLockDisable||isLocked)&&<div className="block-lock-screen" role="dialog" aria-modal="true" aria-label={blockLockDisable?'Turn off app lock':'Four-block app lock'}><div className="block-lock-glow"/><div className="block-lock-panel"><div className="block-lock-mark"><img src="/kram-icon.svg" alt="KRAM"/></div><h2>{blockLockSetup?(blockLockStage==='create'?'Create your block lock':'Confirm your block lock'):blockLockDisable?'Turn off app lock':'KRAM is locked'}</h2><p>{blockLockSetup?(blockLockStage==='create'?'Tap any sequence. Repeats allowed.':'Repeat your sequence.'):blockLockDisable?'Enter your current block password to disable the lock on this device.':'Enter your sequence.'}</p><div className="block-lock-grid" role="group" aria-label="Four block password">{[0,1,2,3].map(index=><button key={index} type="button" aria-label={['Top left block','Top right block','Bottom left block','Bottom right block'][index]} disabled={blockLockVerifying} className={((blockLockSetup?blockLockSequence:unlockSequence).includes(index)?'selected':'')} onClick={()=>tapLockBlock(index,blockLockSetup?'setup':'unlock')}/>)}</div><div className="block-lock-dots" aria-label={(blockLockSetup?blockLockSequence:unlockSequence).length+' taps entered'}>{Array.from({length:Math.max(4,(blockLockSetup?blockLockSequence:unlockSequence).length)},(_,i)=><span key={i} className={i<(blockLockSetup?blockLockSequence:unlockSequence).length?'filled':''}/>)}</div>{blockLockError&&<p className="block-lock-error" role="alert">{blockLockError}</p>}<div className="block-lock-actions"><button type="button" className="secondary-button" disabled={blockLockVerifying} onClick={()=>{if(blockLockSetup){if(blockLockStage==='confirm'){setBlockLockStage('create');setBlockLockFirst([]);}setBlockLockSequence([]);setBlockLockError('');}else{setUnlockSequence([]);setBlockLockError('');}}}>Clear</button><button type="button" className="primary-button" disabled={blockLockVerifying} onClick={()=>void finishBlockLockEntry()}>{blockLockVerifying?'Checking…':blockLockSetup?(blockLockStage==='create'?'Continue':'Save lock'):blockLockDisable?'Turn off':'Unlock'}</button></div>{(blockLockSetup||blockLockDisable)&&<button type="button" className="text-button block-lock-cancel" disabled={blockLockVerifying} onClick={()=>{if(blockLockDisable)cancelBlockLockDisable();else setBlockLockSetup(false);}}>Cancel</button>}</div></div>}
    <AnimatePresence>{alertsOpen&&<motion.div key="alertsOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)setAlertsOpen(false)}}><motion.section {...sheetMotion} className="modal-card kram-motion-sheet"><div className="modal-heading"><div><h2>Notification settings</h2></div><button type="button" className="icon-button" aria-label="Close notification settings" onClick={()=>setAlertsOpen(false)}><X size={19}/></button></div><button type="button" className="primary-button alert-enable" onClick={async()=>{let enabled=false;if(Capacitor.isNativePlatform()){const permission=await LocalNotifications.requestPermissions();enabled=permission.display==='granted';if(enabled){const exact=await LocalNotifications.checkExactNotificationSetting();if(exact.exact_alarm!=='granted'){const updated=await LocalNotifications.changeExactNotificationSetting();if(updated.exact_alarm!=='granted')setSmartMessage('Please allow KRAM under Android Settings → Alarms & reminders so reminders can run on time.');}}}else{if(!('Notification' in window)){setSmartMessage('This browser does not support notifications.');return;}enabled=(await Notification.requestPermission())==='granted';}setNotificationsEnabled(enabled);localStorage.setItem('KRAM-notifications',enabled?'on':'off');setSmartMessage(enabled?'Notifications enabled.':'Notification permission was not granted.');}}>{notificationsEnabled?'✓ ':''}{Capacitor.isNativePlatform()?'Enable Android notifications':'Enable browser notifications'}</button>{notificationsEnabled&&<button type="button" className="secondary-button alert-enable" onClick={sendTestNotification}>Send test notification</button>}<p className="alert-settings-note" role="status">{smartMessage}</p>{reminderSyncError&&<p className="alert-settings-note" role="alert">{reminderSyncError}</p>}{!Capacitor.isNativePlatform()&&<p className="alert-settings-copy">Browser reminders require KRAM to remain open. Android reminders can run when the app is closed.</p>}<label className="alert-toggle"><span><strong>Alert sound</strong><small>Reminder sound</small></span><input type="checkbox" checked={soundEnabled} onChange={e=>{setSoundEnabled(e.target.checked);localStorage.setItem('KRAM-sound',e.target.checked?'on':'off');}}/></label><label className="alert-toggle"><span><strong>Touch haptics & reminders</strong><small>Tap and reminder vibration</small></span><input type="checkbox" checked={vibrationEnabled} onChange={e=>{setVibrationEnabled(e.target.checked);localStorage.setItem('KRAM-vibration',e.target.checked?'on':'off');}}/></label><p className="alert-settings-note">Android: allow notifications in Settings. Browser reminders may pause when closed.</p>{Capacitor.getPlatform()==='android'&&<section className="app-update-panel"><div className="update-panel-heading"><strong>App updates</strong><span className={'update-status'+(latestRelease?.available?' available':'')} role="status">{updateChecking?'Checking…':latestRelease?latestRelease.available?'Update available':compareAppVersions(latestRelease.version,latestRelease.installed)<0?'Newer build installed':'Up to date':updateMessage?'Check failed':'Not checked'}</span></div><dl className="update-version-list"><div><dt>Installed version</dt><dd>{installedVersion?'v'+installedVersion:'—'}</dd></div><div><dt>Latest release</dt><dd>{latestRelease?'v'+latestRelease.version:'—'}</dd></div></dl>{latestRelease?.available&&!updateChecking&&<a className="primary-button update-release-link" href={KRAM_RELEASE_PAGE+'/tag/v'+latestRelease.version}>Open update page <ChevronRight size={17}/></a>}<button type="button" className="secondary-button" onClick={()=>void checkForKramUpdate()} disabled={updateChecking}>{updateChecking?'Checking…':'Check for updates'}</button>{updateMessage&&<p className="app-update-message" role="alert">{updateMessage}</p>}<p className="alert-settings-note">Updates open on the official GitHub release page. Installation is manual. Keep Play Protect enabled and cancel any blocked installation.</p></section>}<div className="modal-actions"><button type="button" className="primary-button" onClick={()=>setAlertsOpen(false)}>Done</button></div></motion.section></motion.div>}</AnimatePresence>
    <AnimatePresence>{taskOpen&&<motion.div key="taskOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget&&!savingTask)setTaskOpen(false)}}><motion.form {...sheetMotion} className="modal-card kram-motion-sheet task-form-card entry-sheet" onSubmit={saveTask}><div className="modal-heading"><div><h2>{editing?'Edit entry':taskListKind==='someday'?'New idea':'New to-do'}</h2></div><button type="button" disabled={savingTask} className="icon-button" aria-label="Close task form" onClick={()=>setTaskOpen(false)}><X size={19}/></button></div><div className="sheet-step-content"><div className={'entry-hero '+(taskListKind==='someday'?'entry-hero-someday':'')}><span className="entry-hero-icon">{taskListKind==='someday'?<Lightbulb size={21}/>:<ListTodo size={21}/>}</span><label className="entry-title-label"><input aria-label={taskListKind==='someday'?'Idea':'To-do name'} required maxLength={120} placeholder={taskListKind==='someday'?'What do you want to do someday?':'What do you want to do?'} value={title} onChange={e=>setTitle(e.target.value)}/></label></div>{!editing&&!scheduleRequired&&!dueTime&&tab!=='schedule'&&<div className="entry-segments" role="group" aria-label="Entry type"><button type="button" className={taskListKind==='todo'?'selected':''} aria-pressed={taskListKind==='todo'} onClick={()=>setTaskListKind('todo')}>To-do</button><button type="button" className={taskListKind==='someday'?'selected':''} aria-pressed={taskListKind==='someday'} onClick={()=>setTaskListKind('someday')}>Someday</button></div>}<details className="entry-note" open={notes?true:undefined}><summary>Add note</summary><textarea aria-label="Notes" rows={2} placeholder="Notes" value={notes} onChange={e=>setNotes(e.target.value)}/></details>{taskListKind!=='someday'&&<><details className="entry-note entry-options" open={scheduleRequired||!!dueTime||!!endTime||tab==='schedule'?true:undefined}><summary>Schedule  {!scheduleRequired&&<span className="optional">Optional</span>}</summary><div className="entry-options-fields"><div className="entry-date-chips" role="group" aria-label="Plan date"><button type="button" className={scheduleDate===todayKey()?'selected':''} onClick={()=>setScheduleDate(todayKey())}>Today</button><button type="button" className={scheduleDate===dateKey(new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()+1))?'selected':''} onClick={()=>{const d=new Date();d.setDate(d.getDate()+1);setScheduleDate(dateKey(d));}}>Tomorrow</button></div><label>Plan date <input type="date" value={scheduleDate} onChange={e=>setScheduleDate(e.target.value)}/></label><div className="form-two"><label>Start<input type="time" value={dueTime} onChange={e=>{setDueTime(e.target.value);if(e.target.value&&!scheduleDate)setScheduleDate(selectedDate);if(!e.target.value)setEndTime('');else if(!endTime||timeToMinutes(endTime)<=timeToMinutes(e.target.value))setEndTime(minutesToTime(Math.min(1439,timeToMinutes(e.target.value)+30)));}}/></label><label>End<input type="time" value={endTime} min={dueTime||undefined} disabled={!dueTime} required={!!dueTime} onChange={e=>setEndTime(e.target.value)}/></label></div></div></details><details className="entry-note entry-options" open={taskError||dueDate||repeat!=='none'||priority!=='Medium'||reminderMinutesBefore>=0?true:undefined}><summary>More options</summary><div className="entry-options-fields"><label>Deadline <span className="optional">Optional</span><input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/><DateShortcuts value={dueDate} onChange={setDueDate}/></label><label>Reminder<select value={reminderMinutesBefore} onChange={e=>setReminderMinutesBefore(Number(e.target.value))}><option value={-1}>No reminder</option><option value={0}>At task time</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option></select>{!dueTime&&reminderMinutesBefore!==-1&&<span className="optional">Set a start time above for this reminder to work.</span>}</label><label>Priority<select value={priority} onChange={e=>setPriority(e.target.value as 'High'|'Medium'|'Low')}><option>Low</option><option>Medium</option><option>High</option></select></label><label>Repeat<select value={repeat} onChange={e=>setRepeat(e.target.value as NonNullable<Task['repeat']>)}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option><option value="weekly">Every week</option></select></label></div></details></>}</div>{taskError&&<div className="auth-error" role="alert">{taskError}</div>}<div className="modal-actions entry-actions"><button type="button" className="secondary-button" disabled={savingTask} onClick={()=>setTaskOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={savingTask||!title.trim()}>{savingTask?'Saving…':scheduleRequired?'Save schedule':editing?'Save changes':taskListKind==='someday'?'Save idea':'Add to-do'}</button></div></motion.form></motion.div>}</AnimatePresence>
    <AnimatePresence>{internshipFormOpen&&<motion.div key="internshipFormOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget&&!internshipSaving)setInternshipFormOpen(false)}}><motion.form {...sheetMotion} className="modal-card kram-motion-sheet internship-form-card entry-sheet" onSubmit={saveInternshipTask}><div className="modal-heading"><div><h2>{internshipEditing?'Edit work':tab==='internship-deadlines'?'Add deadline':'Add internship work'}</h2></div><button type="button" className="icon-button" disabled={internshipSaving} aria-label="Close form" onClick={()=>setInternshipFormOpen(false)}><X size={19}/></button></div><div className="sheet-step-content"><div className="entry-hero entry-hero-work"><span className="entry-hero-icon"><BriefcaseBusiness size={21}/></span><label className="entry-title-label"><input aria-label="Work name" required maxLength={120} placeholder="What are you working on?" value={internshipTitle} onChange={e=>setInternshipTitle(e.target.value)}/></label></div><div className="form-two"><label>Deadline{(internshipEditing||tab!=='internship-deadlines')&&<span className="optional"> Optional</span>}<input type="date" required={!internshipEditing&&tab==='internship-deadlines'} value={internshipDeadline} onChange={e=>setInternshipDeadline(e.target.value)}/><DateShortcuts value={internshipDeadline} onChange={setInternshipDeadline}/></label><label>Priority<select value={internshipPriority} onChange={e=>setInternshipPriority(e.target.value as 'High'|'Medium'|'Low')}><option>Low</option><option>Medium</option><option>High</option></select></label></div><details className="entry-note" open={internshipNotes?true:undefined}><summary>Add note</summary><textarea aria-label="Work details" rows={2} placeholder="Notes" value={internshipNotes} onChange={e=>setInternshipNotes(e.target.value)}/></details></div>{internshipError&&<p className="quick-add-error" role="alert">{internshipError}</p>}<div className="modal-actions"><button type="button" disabled={internshipSaving} className="secondary-button" onClick={()=>setInternshipFormOpen(false)}>Cancel</button><button type="submit" disabled={internshipSaving||!internshipTitle.trim()||(!internshipEditing&&tab==='internship-deadlines'&&!internshipDeadline)} className="primary-button">{internshipSaving?'Saving…':internshipEditing?'Save changes':tab==='internship-deadlines'?'Add deadline':'Add work'}</button></div></motion.form></motion.div>}</AnimatePresence>
    <AnimatePresence>{blockOpen&&<motion.div key="blockOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)setBlockOpen(false)}}><motion.form {...sheetMotion} className="modal-card kram-motion-sheet compact-commitment" onSubmit={saveBlock}><div className="modal-heading"><div><h2>{editingBlock?'Edit commitment':'New commitment'}</h2></div><button type="button" className="icon-button" title="Close commitment form" aria-label="Close commitment form" onClick={()=>setBlockOpen(false)}><X size={19}/></button></div><label>Name<input required maxLength={100} placeholder="Name your commitment" value={blockTitle} onChange={e=>setBlockTitle(e.target.value)}/></label><div className="form-two"><label>Start<input type="time" required value={blockStart} onChange={e=>setBlockStart(e.target.value)}/></label><label>End<input type="time" required value={blockEnd} onChange={e=>setBlockEnd(e.target.value)}/></label></div><label>Repeat<select value={blockRepeat} onChange={e=>setBlockRepeat(e.target.value as 'weekly'|'once')}><option value="weekly">Every week</option><option value="once">Specific date only</option></select></label>{blockRepeat==='weekly'?<div className="block-day-picker"><span>Repeat on</span><div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=><button type="button" key={day} className={blockDays.includes(i)?'block-day active':'block-day'} onClick={()=>toggleBlockDay(i)}>{day}</button>)}</div></div>:<label>Date<input type="date" required value={blockDate} onChange={e=>setBlockDate(e.target.value)}/></label>}{blockError&&<div className="auth-error" role="alert">{blockError}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setBlockOpen(false)}>Cancel</button><button className="primary-button" type="submit">{editingBlock?'Save changes':'Save commitment'}</button></div></motion.form></motion.div>}</AnimatePresence>
    <AnimatePresence>{habitOpen&&<motion.div key="habitOpen" className="modal-backdrop kram-motion-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget&&!habitSaving)setHabitOpen(false)}}><motion.form {...sheetMotion} className="modal-card kram-motion-sheet habit-form-card entry-sheet" onSubmit={addHabit}><div className="modal-heading"><div><h2>New habit</h2></div><button type="button" disabled={habitSaving} className="icon-button" aria-label="Close habit form" onClick={()=>setHabitOpen(false)}><X size={19}/></button></div><div className="sheet-step-content"><div className="entry-hero entry-hero-habit" style={{background:habitGoalType==='quit'?'var(--peach)':'var(--lavender)',color:habitGoalType==='quit'?'var(--planned-ink)':'var(--lavender-ink)'}}><span className="entry-hero-icon">{habitGoalType==='quit'?<ShieldCheck size={25}/>:habitEmoji}</span><label className="entry-title-label"><input aria-label="Habit name" required maxLength={80} placeholder={habitGoalType==='build'?'Habit to build':'Habit to quit'} value={habitName} onChange={e=>setHabitName(e.target.value)}/></label></div><div role="group" aria-label="Habit goal" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>{(['build','quit'] as const).map(goal=><button key={goal} type="button" aria-pressed={habitGoalType===goal} onClick={()=>{setHabitGoalType(goal);if(goal==='quit'){setHabitTrackingType('check');setHabitTarget('');}}} style={{display:'grid',gap:5,textAlign:'left',padding:12,borderRadius:14,border:habitGoalType===goal?'2px solid currentColor':'2px solid transparent',background:goal==='build'?'var(--lavender)':'var(--peach)',color:goal==='build'?'var(--lavender-ink)':'var(--planned-ink)'}}>{goal==='build'?<Plus size={21}/>:<ShieldCheck size={21}/>}<strong>{goal==='build'?'Build':'Quit'}</strong></button>)}</div><div className="emoji-picker" role="group" aria-label="Choose a habit icon">{['✦','📚','💧','🏃','🧘','💪','🌱','🙏'].map(emoji=><button type="button" key={emoji} className={habitEmoji===emoji?'emoji-choice selected':'emoji-choice'} aria-pressed={habitEmoji===emoji} aria-label={'Choose '+emoji+' icon'} onClick={()=>setHabitEmoji(emoji)}>{emoji}</button>)}</div>{habitGoalType==='build'&&<><div className="entry-segments" role="group" aria-label="Tracking type"><button type="button" className={habitTrackingType==='check'?'selected':''} aria-pressed={habitTrackingType==='check'} onClick={()=>setHabitTrackingType('check')}>Check-in</button><button type="button" className={habitTrackingType==='measurable'?'selected':''} aria-pressed={habitTrackingType==='measurable'} onClick={()=>setHabitTrackingType('measurable')}>Quantity (optional)</button></div>{habitTrackingType==="measurable"&&<><div className="form-section-label">Daily target</div><div className="form-two"><label>Target value<input required type="number" min="0.01" step="any" value={habitTarget} onChange={e=>setHabitTarget(e.target.value)} placeholder="e.g. 30"/></label><label>Unit<select value={habitUnit} onChange={e=>setHabitUnit(e.target.value)}><option value="litres">Litres</option><option value="pages">Pages</option><option value="steps">Steps</option><option value="sessions">Sessions</option><option value="reps">Reps</option></select></label></div></>}</>}<details className="entry-note entry-options" open={habitReminderTime||habitAllowedSkips!==1?true:undefined}><summary>Reminders & skips</summary><div className="entry-options-fields"><div className="form-two"><label>Weekly skips<select value={habitAllowedSkips} onChange={e=>setHabitAllowedSkips(Number(e.target.value))}>{Array.from({length:8},(_,i)=><option key={i} value={i}>{i} {i===1?'skip':'skips'}</option>)}</select></label><label>Reminder time<input type="time" value={habitReminderTime} onChange={e=>setHabitReminderTime(e.target.value)}/></label><label>Notify<select value={habitReminderMinutesBefore} onChange={e=>setHabitReminderMinutesBefore(Number(e.target.value))} disabled={!habitReminderTime}><option value={0}>At reminder time</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option></select></label></div></div></details></div>{habitError&&<p className="quick-add-error" role="alert">{habitError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={habitSaving} onClick={()=>setHabitOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={habitSaving||!habitName.trim()}>{habitSaving?'Saving…':'Add habit'}</button></div></motion.form></motion.div>}</AnimatePresence>
    <AnimatePresence>{deleteTarget&&<motion.div key="delete-confirmation" className="modal-backdrop kram-motion-backdrop delete-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)closeDelete();}}><motion.section {...sheetMotion} className="modal-card kram-motion-sheet delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-heading" aria-describedby="delete-description" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();closeDelete();}}}><div className="delete-symbol"><Trash2 size={23}/></div><h2 id="delete-heading">Delete {deleteTarget.kind==='internship'?'work':deleteTarget.kind==='task'?'to-do':deleteTarget.kind}?</h2><p id="delete-description"><strong>{deleteTarget.title}</strong><br/>{deleteTarget.recurring?'Choose which occurrences you want to delete.':deleteTarget.kind==='habit'?'You can undo this for 20 seconds after deleting. Your check-in history will be retained if restored.':/(?:_\d{4}-\d{2}-\d{2})$/.test(deleteTarget.id)?'This will permanently remove the item. This cannot be undone.':'You can undo this for a short time after deleting.'}</p>{deleteTarget.recurring&&<fieldset className="delete-options"><legend>Delete</legend><label className={deleteScope==='one'?'selected':''}><input type="radio" name="delete-scope" checked={deleteScope==='one'} disabled={deleteBusy} onChange={()=>setDeleteScope('one')}/><span><strong>Only this occurrence</strong><small>Keep the rest of the series.</small></span></label><label className={deleteScope==='series'?'selected':''}><input type="radio" name="delete-scope" checked={deleteScope==='series'} disabled={deleteBusy} onChange={()=>setDeleteScope('series')}/><span><strong>Entire series</strong><small>Remove all saved occurrences.</small></span></label></fieldset>}{deleteError&&<p className="quick-add-error" role="alert">{deleteError}</p>}<div className="modal-actions delete-actions"><button type="button" className="secondary-button" autoFocus onClick={closeDelete} disabled={deleteBusy}>Cancel</button><button type="button" className="delete-confirm-button" onClick={()=>void confirmDelete()} disabled={deleteBusy}>{deleteBusy?'Deleting…':deleteTarget.recurring&&deleteScope==='series'?'Delete series':'Delete'}</button></div></motion.section></motion.div>}</AnimatePresence>
    <AnimatePresence>{whatsNewOpen&&!isLocked&&!blockLockSetup&&!blockLockDisable&&<motion.div key="whats-new" className="modal-backdrop kram-motion-backdrop whats-new-backdrop" {...sheetBackdropMotion} onMouseDown={e=>{if(e.target===e.currentTarget)closeWhatsNew();}}><motion.section {...sheetMotion} className="modal-card kram-motion-sheet whats-new-card" role="dialog" aria-modal="true" aria-labelledby="whats-new-title"><div className="modal-heading"><div><h2 id="whats-new-title">What's new{installedVersion?' · v'+installedVersion:''}</h2><p style={{fontSize:12,color:'var(--muted)',margin:'4px 0 0'}}>This update · {KRAM_UPDATE_REVISION}</p></div><button type="button" className="icon-button" aria-label="Close what's new" onClick={closeWhatsNew}><X size={19}/></button></div><div className="whats-new-list">{KRAM_UPDATE_NOTES.map(note=><div key={note}><Check size={16}/><span>{note}</span></div>)}</div><div className="modal-actions"><button type="button" className="primary-button" autoFocus onClick={closeWhatsNew}>Continue</button></div></motion.section></motion.div>}</AnimatePresence>
    <div className="floating-dock"><nav className="bottom-nav" aria-label="Main navigation">{navItems.filter(([id])=>id!=='settings'&&id!=='fitness').map(([id,label,Icon])=><button key={id} className={tab===id?'bottom-item active':'bottom-item'} onClick={()=>{setTab(id);if(id==='internship-todo'||id==='internship-deadlines'){setInternshipFilter('Open');setInternshipSearch('');setWorkFiltersOpen(false);}}} aria-current={tab===id?'page':undefined}>{tab===id&&<motion.span aria-hidden="true" className="dock-selection" layoutId={'dock-selection-'+workspaceMode} transition={reducedMotion?{duration:0}:{type:'spring',stiffness:380,damping:34}}/>}<Icon size={21}/><span>{label}</span></button>)}</nav><button type="button" className="floating-add" aria-label={workspaceMode==='internship'?(tab==='internship-deadlines'?'Add deadline':'Add internship work'):tab==='habits'?'Add habit':tab==='schedule'?'Add task to schedule':tab==='tasks'&&listView==='someday'?'Add idea':'Add to-do'} onClick={()=>{if(workspaceMode==='internship')openInternshipForm();else if(tab==='habits'){openHabitForm();}else openNewTask(selectedDate,tab==='tasks'?listView:'todo');}}><Plus size={27}/></button></div>
  </div>;
}

function TaskList({tasks,onToggle,onEdit,onDelete,showDate=false,emptyAction,someday=false,onSchedule,onPromote,movingId,emptyTitle}:{tasks:Task[];onToggle:(t:Task)=>void;onEdit:(t:Task)=>void;onDelete:(id:string)=>void;showDate?:boolean;emptyAction:()=>void;someday?:boolean;onSchedule?:(t:Task)=>void;onPromote?:(t:Task)=>void;movingId?:string|null;emptyTitle?:string}) {
 const reduce = useReducedMotion();
 return <div className="task-list"><AnimatePresence initial={false}>{tasks.length===0?<motion.div key="empty" className="empty-state" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduce?0:0.16}}><div className="empty-icon">{someday?<Lightbulb size={23}/>:<CheckCircle2 size={23}/>}</div><strong>{emptyTitle||(someday?'Room for future ideas':'Nothing on your list')}</strong><button className="secondary-button" onClick={emptyAction}><Plus size={16}/> {someday?'Add an idea':'Add a to-do'}</button></motion.div>:tasks.map(t=><motion.div layout={reduce||tasks.length>25?false:'position'} initial={{opacity:0,y:reduce?0:9}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduce?0:-6}} transition={{duration:reduce?0:0.13}} className={(t.completed?'task-row completed':'task-row')+(onSchedule||onPromote?' todo-list-row':'')} key={t.id}><button className="task-check" onClick={()=>onToggle(t)} aria-label={t.completed?'Mark incomplete':'Mark complete'}>{t.completed?<Check size={15}/>:<Circle size={19}/>}</button><button className="task-main" onClick={()=>onEdit(t)}><strong>{t.title}</strong>{t.notes&&<span>{t.notes}</span>}{!someday&&<small>{showDate&&t.dueDate&&<><CalendarDays size={12}/> Due {prettyDate(t.dueDate,{month:'short',day:'numeric'})} · </>}{isTaskOverdue(t)&&<span className="overdue-label">OVERDUE</span>}{t.dueTime&&<><Clock3 size={12}/>{(t.scheduledDate||t.dueDate)?prettyDate(t.scheduledDate||t.dueDate,{month:'short',day:'numeric'})+' · ':''}{displayTime(t.dueTime)}–{displayTime(minutesToTime(Math.min(1439,timeToMinutes(t.dueTime)+(t.durationMinutes||60))))} · </>}<i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority}</small>}</button><button className="icon-button delete-button" title={someday?'Delete idea':'Delete to-do'} aria-label={someday?'Delete idea':'Delete to-do'} onClick={()=>onDelete(t.id)}><Trash2 size={16}/></button>{!t.completed&&(onSchedule||onPromote)&&<div className="todo-row-actions">{onSchedule&&<button type="button" className="todo-schedule-button" title={t.dueTime?'Reschedule':'Schedule'} aria-label={t.dueTime?'Reschedule':'Schedule'} style={{minWidth:40,justifyContent:'center'}} onClick={()=>onSchedule(t)}><CalendarDays size={18}/></button>}{onPromote&&<button type="button" className="todo-schedule-button" title="Move to to-do" aria-label="Move to to-do" disabled={!!movingId} onClick={()=>onPromote(t)}><ListTodo size={17}/><span>{movingId===t.id?'Moving…':'To-do'}</span></button>}</div>}</motion.div>)}</AnimatePresence></div>;
}
function HabitList({onCreate,onTemplate,habits,checkins,date,onToggle,onSkip,onRecord,onDelete}:{onCreate:()=>void;onTemplate:(t:{name:string;emoji:string;target?:string;unit?:string})=>void;habits:Habit[];checkins:Checkin[];date:string;onToggle:(h:Habit)=>void;onSkip:(h:Habit)=>void;onRecord:(h:Habit,value:number)=>void;onDelete?:(id:string)=>void}) {
 const [values,setValues]=useState<Record<string,string>>({});
 const [expandedHabitId,setExpandedHabitId]=useState<string|null>(null);
 const active=habits;
 const done=active.filter(h=>checkins.some(c=>c.habitId===h.id&&c.date===date&&c.completed)).length;
 return <><div className="habit-list">{active.length===0?<div className="empty-state"><div className="empty-icon"><Target size={23}/></div><strong>No habits yet</strong><button type="button" className="secondary-button" onClick={onCreate}><Plus size={16}/> Create habit</button><div className="habit-template-grid">{[{name:"Workout",emoji:"💪"},{name:"Read",emoji:"📚"},{name:"Meditate",emoji:"🧘"},{name:"Drink water",emoji:"💧"}].map(t=><button type="button" key={t.name} onClick={()=>onTemplate(t)}><span>{t.emoji}</span><strong>{t.name}</strong></button>)}</div></div>:active.map(h=>{
  const entry=checkins.find(c=>c.habitId===h.id&&c.date===date);
  const isDone=!!entry?.completed;
  const isSkipped=!!entry?.skipped;
  const weekStart=mondayWeekStart(date);
  const usedSkips=checkins.filter(c=>c.habitId===h.id&&c.skipped&&c.date>=weekStart&&c.date<=date).length;
  const skipLimit=Math.max(0,Math.min(7,h.allowedSkipsPerWeek??1));
  const measurable=isQuantityHabit(h);
  const quitting=h.goalType==='quit';
  const expanded=expandedHabitId===h.id;
  const toggleDetails=()=>setExpandedHabitId(expanded?null:h.id);
  return <div className="habit-row" key={h.id} style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:10,borderInlineStart:'4px solid '+(quitting?'var(--planned-ink)':'var(--lavender-ink)')}}>
   <button type="button" className="habit-emoji" aria-label={'Details for '+h.name} onClick={toggleDetails} style={{border:0,flexShrink:0,background:quitting?'var(--peach)':'var(--lavender)',color:quitting?'var(--planned-ink)':'var(--lavender-ink)',position:'relative'}}>{h.emoji||'✦'}{quitting&&<span aria-hidden="true" style={{position:'absolute',right:-3,bottom:-3,background:'var(--surface)',border:'1px solid var(--line)',borderRadius:'50%',width:18,height:18,display:'grid',placeItems:'center'}}><ShieldCheck size={12}/></span>}</button>
   <button type="button" className="habit-info" aria-expanded={expanded} onClick={toggleDetails} style={{flex:'1 1 0',textAlign:'left',background:'transparent',border:0,padding:0,minWidth:0}}>
    <strong style={{display:'block'}}>{h.name}</strong>
    <span style={{display:'block'}}><span style={{display:'inline',fontWeight:600,color:quitting?'var(--planned-ink)':'var(--lavender-ink)'}}>{quitting?'Quit':'Build'}</span>{isSkipped?' · Skipped':measurable?' · '+(entry?.value||0)+' / '+(h.targetValue||0)+' '+(h.unit||'units')+(isDone?' · Done':''):isDone?(quitting?' · Avoided today':' · Done'):quitting?' · Stay away today':''}</span>
   </button>
   <button type="button" className={'habit-check'+(isDone?' checked':'')} aria-label={measurable?'Record progress for '+h.name:(isDone?'Undo check-in: ':quitting?'Stayed away from: ':'Complete: ')+h.name} onClick={()=>measurable?toggleDetails():onToggle(h)} style={{width:40,height:40,padding:0,justifyContent:'center',flexShrink:0}}>{isDone?<Check size={20}/>:<Circle size={20}/>}</button>
   <button type="button" className="icon-button" aria-label={(expanded?'Hide details: ':'Show details: ')+h.name} aria-expanded={expanded} onClick={toggleDetails} style={{width:30,flexShrink:0}}><ChevronRight size={18} style={{transform:expanded?'rotate(90deg)':undefined}}/></button>
   {expanded&&<div style={{flexBasis:'100%',padding:'10px 0 2px',borderTop:'1px solid var(--line)',display:'grid',gap:10}}>
    {measurable&&<><div className="habit-measure-row"><input aria-label={'Progress for '+h.name} type="number" min="0" step="any" placeholder={h.unit||'Value'} value={values[h.id]??(entry?.value!==undefined?String(entry.value):'')} onChange={e=>setValues(v=>({...v,[h.id]:e.target.value}))}/><button className="habit-check" type="button" onClick={()=>onRecord(h,Number(values[h.id]??entry?.value??0))}>Save progress</button></div><div className="habit-progress-track"><span style={{width:Math.min(100,(entry?.value||0)/Math.max(1,h.targetValue||1)*100)+'%'}}/></div></>}
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
     <span style={{fontSize:12,color:'var(--muted)',marginRight:'auto'}}>🔥 {habitStreak(h.id,checkins,date)} day streak</span>{isDone&&!measurable&&<button type="button" className="habit-check" onClick={()=>onToggle(h)}>Undo check-in</button>}
     {(isSkipped||(!isDone&&usedSkips<skipLimit))&&<button type="button" className={'habit-check'+(isSkipped?' checked':'')} onClick={()=>onSkip(h)}>{isSkipped?'Undo skip':'Skip today'}</button>}
     {onDelete&&<button type="button" className="icon-button" aria-label={'Delete '+h.name} onClick={()=>onDelete(h.id)}><Trash2 size={17}/></button>}
    </div>
   </div>}
  </div>;
 })}</div><p className="stat-caption" style={{marginTop:10}}>{done} of {active.length} habits completed</p></>;
}
function DateShortcuts({value,onChange}:{value:string;onChange:(value:string)=>void}){const today=todayKey();const next=new Date();next.setDate(next.getDate()+1);const tomorrow=dateKey(next);return <span className="deadline-shortcuts"><button type="button" aria-pressed={value===today} className={value===today?'selected':''} onClick={()=>onChange(today)}>Today</button><button type="button" aria-pressed={value===tomorrow} className={value===tomorrow?'selected':''} onClick={()=>onChange(tomorrow)}>Tomorrow</button></span>;}
