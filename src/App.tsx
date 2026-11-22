import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import Auth from './components/Auth';
import { createPlannerTask, updatePlannerTask, deletePlannerTask, subscribePlannerTasks, createPlannerHabit, deletePlannerHabit, subscribePlannerHabits, setPlannerHabitCheckin, subscribePlannerCheckins } from './lib/plannerDb';
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Flame, LayoutDashboard, ListTodo, LogOut, Menu, Moon, Plus, Sun, Target, Trash2, TrendingUp, X } from 'lucide-react';

type Task = { id:string; userId:string; title:string; notes?:string; dueDate:string; dueTime?:string; priority:'High'|'Medium'|'Low'; completed:boolean; createdAt:string };
type Habit = { id:string; userId:string; name:string; emoji:string; createdAt:string };
type Checkin = { id:string; userId:string; habitId:string; date:string; completed:boolean };
type Tab = 'today'|'tasks'|'habits'|'progress';

const dateKey = (d:Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayKey = () => dateKey(new Date());
const prettyDate = (value:string, options:Intl.DateTimeFormatOptions = {weekday:'long',month:'long',day:'numeric'}) => new Date(value+'T12:00:00').toLocaleDateString('en-IN', options);

export default function App() {
  const [user,setUser] = useState<User|null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [tasks,setTasks] = useState<Task[]>([]);
  const [habits,setHabits] = useState<Habit[]>([]);
  const [checkins,setCheckins] = useState<Checkin[]>([]);
  const [tab,setTab] = useState<Tab>('today');
  const [selectedDate,setSelectedDate] = useState(todayKey());
  const [dark,setDark] = useState(() => localStorage.getItem('KRAM-theme') === 'dark');
  const [taskOpen,setTaskOpen] = useState(false);
  const [taskError,setTaskError] = useState('');
  const [savingTask,setSavingTask] = useState(false);
  const [habitOpen,setHabitOpen] = useState(false);
  const [editing,setEditing] = useState<Task|null>(null);
  const [title,setTitle] = useState('');
  const [notes,setNotes] = useState('');
  const [dueDate,setDueDate] = useState(todayKey());
  const [dueTime,setDueTime] = useState('');
  const [priority,setPriority] = useState<'High'|'Medium'|'Low'>('Medium');
  const [habitName,setHabitName] = useState('');
  const [mobileMenu,setMobileMenu] = useState(false);
  const [filter,setFilter] = useState<'All'|'Open'|'Completed'>('All');

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); }),[]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark',dark);
    localStorage.setItem('KRAM-theme',dark?'dark':'light');
  },[dark]);
  useEffect(() => {
    if(!user) return;
    const a=subscribePlannerTasks(user.uid,setTasks);
    const b=subscribePlannerHabits(user.uid,setHabits);
    const c=subscribePlannerCheckins(user.uid,setCheckins);
    return () => {a();b();c();};
  },[user]);

  const todaysTasks = useMemo(() => tasks.filter(t=>t.dueDate===selectedDate).sort((a,b)=>(a.dueTime||'').localeCompare(b.dueTime||'')),[tasks,selectedDate]);
  const doneCount = todaysTasks.filter(t=>t.completed).length;
  const completion = todaysTasks.length ? Math.round(doneCount/todaysTasks.length*100) : 0;
  const todayCheckins = habits.filter(h=>checkins.some(c=>c.habitId===h.id&&c.date===selectedDate&&c.completed)).length;
  const week = useMemo(()=>Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const key=dateKey(d);const day=tasks.filter(t=>t.dueDate===key);return {key,label:d.toLocaleDateString('en-IN',{weekday:'short'}),total:day.length,done:day.filter(t=>t.completed).length};}),[tasks]);

  const openNewTask = (date=selectedDate) => {setEditing(null);setTitle('');setNotes('');setDueDate(date);setDueTime('');setPriority('Medium');setTaskError('');setTaskOpen(true);};
  const openEditTask = (t:Task) => {setEditing(t);setTitle(t.title);setNotes(t.notes||'');setDueDate(t.dueDate);setDueTime(t.dueTime||'');setPriority(t.priority);setTaskError('');setTaskOpen(true);};
  const saveTask = async (e:FormEvent) => {
    e.preventDefault();
    if (savingTask) return;
    if (!user) { setTaskError('You are signed out. Please sign in again.'); return; }
    if (!title.trim()) { setTaskError('Please enter a task name.'); return; }
    setSavingTask(true);
    setTaskError('');
    try {
      const payload={title:title.trim(),notes:notes.trim(),dueDate,dueTime,priority,completed:editing?.completed||false};
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
  const toggleTask = async (t:Task) => updatePlannerTask(t.id,{completed:!t.completed});
  const addHabit = async (e:React.FormEvent) => {e.preventDefault();if(!user||!habitName.trim())return;await createPlannerHabit(user.uid,habitName.trim());setHabitName('');setHabitOpen(false);};
  const toggleHabit = async (h:Habit) => {const existing=checkins.find(c=>c.habitId===h.id&&c.date===selectedDate);await setPlannerHabitCheckin(user!.uid,h.id,selectedDate,!existing?.completed);};

  if(authLoading) return <div className="loading-screen"><div className="loader-mark">c</div><p>Opening your planner…</p></div>;
  if(!user) return <Auth/>;

  const navItems:[Tab,string,typeof LayoutDashboard][]=[['today','Today',LayoutDashboard],['tasks','Tasks',ListTodo],['habits','Habits',Target],['progress','Progress',TrendingUp]];
  const visibleTasks = (tab==='tasks'?tasks:todaysTasks).filter(t=>filter==='All'||(filter==='Open'?!t.completed:t.completed)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||(a.dueTime||'').localeCompare(b.dueTime||''));

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon">c</div><div><strong>KRAM</strong><span>PERSONAL PLANNER</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'nav-item active':'nav-item'} onClick={()=>setTab(id)}><Icon size={19}/><span>{label}</span>{id==='tasks'&&<small>{tasks.filter(t=>!t.completed).length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{(user.displayName||user.email||'U').charAt(0).toUpperCase()}</div><div className="user-details"><strong>{user.displayName||'My planner'}</strong><span>{user.email}</span></div><button className="icon-button" title="Sign out" onClick={()=>signOut(auth)}><LogOut size={17}/></button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="mobile-brand" onClick={()=>setMobileMenu(!mobileMenu)}><Menu size={20}/><b>KRAM</b></button><div className="breadcrumb">My workspace <span>/</span> <strong>{navItems.find(n=>n[0]===tab)?.[1]}</strong></div><div className="top-actions"><span className="sync-label"><span className="sync-dot"/> Synced</span><button className="icon-button theme-button" onClick={()=>setDark(!dark)} title="Toggle theme">{dark?<Sun size={18}/>:<Moon size={18}/>}</button><button className="icon-button mobile-logout" onClick={()=>signOut(auth)} title="Sign out"><LogOut size={18}/></button></div></header>
      {mobileMenu&&<div className="mobile-menu">{navItems.map(([id,label,Icon])=><button key={id} onClick={()=>{setTab(id);setMobileMenu(false)}}><Icon size={18}/>{label}</button>)}</div>}
      <div className="page-content page-transition" key={tab}>
        {tab==='today'&&<><div className="page-heading"><div><div className="eyebrow">YOUR DAY, YOUR PACE</div><h1>Make today count.</h1><p>{prettyDate(selectedDate)} <span className="muted-dot">·</span> One step at a time.</p></div><button className="primary-button" onClick={()=>openNewTask()}><Plus size={18}/> Add task</button></div>
          <div className="date-switch"><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-1);setSelectedDate(dateKey(d));}}><ChevronLeft size={18}/></button><button className="date-current" onClick={()=>setSelectedDate(todayKey())}><CalendarDays size={16}/>{selectedDate===todayKey()?'Today':prettyDate(selectedDate,{month:'short',day:'numeric',year:'numeric'})}</button><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+1);setSelectedDate(dateKey(d));}}><ChevronRight size={18}/></button></div>
          <section className="overview-grid"><div className="overview-card progress-card"><div className="card-topline"><span>DAILY PROGRESS</span><TrendingUp size={17}/></div><div className="progress-main"><div><strong>{completion}%</strong><p>{doneCount} of {todaysTasks.length} tasks completed</p></div><div className="ring" style={{'--progress':completion} as CSSProperties}><div>{completion}%</div></div></div><div className="progress-track"><span style={{width:completion+'%'}}/></div></div><div className="overview-card"><div className="card-topline"><span>TASKS LEFT</span><ListTodo size={17}/></div><strong className="stat-number">{Math.max(0,todaysTasks.length-doneCount)}</strong><p className="stat-caption">A clear next step is all you need.</p></div><div className="overview-card"><div className="card-topline"><span>HABITS TODAY</span><Flame size={17}/></div><strong className="stat-number">{todayCheckins}<em> / {habits.length}</em></strong><p className="stat-caption">Small actions build consistency.</p></div></section>
          <section className="week-glance">
            <div className="week-glance-heading"><div><span className="eyebrow">THE BIG PICTURE</span><h2>Your week, at a glance</h2></div><span className="week-total">{week.reduce((sum,d)=>sum+d.done,0)} <i>done this week</i></span></div>
            <div className="week-glance-bars">{week.map(d=><div className="week-glance-day" key={d.key}><div className="week-glance-track"><span style={{height:(d.total?Math.max(8,d.done/d.total*100):0)+'%'}}/></div><span className="week-glance-label">{d.label.slice(0,1)}</span></div>)}</div>
          </section>
          <section className="content-section"><div className="section-heading"><div><h2>Today's tasks</h2><p>Keep it simple. Focus on what matters.</p></div><button className="text-button" onClick={()=>setTab('tasks')}>View all <ChevronRight size={16}/></button></div><TaskList tasks={todaysTasks} onToggle={toggleTask} onEdit={openEditTask} onDelete={deletePlannerTask} emptyAction={()=>openNewTask()}/></section>
          <section className="content-section"><div className="section-heading"><div><h2>Daily habits</h2><p>Show up for the small things.</p></div><button className="text-button" onClick={()=>setTab('habits')}>Manage habits <ChevronRight size={16}/></button></div><HabitList habits={habits} checkins={checkins} date={selectedDate} onToggle={toggleHabit}/></section>
        </>}
        {tab==='tasks'&&<><div className="page-heading"><div><div className="eyebrow">STAY ON TOP OF IT</div><h1>Your tasks</h1><p>Everything you need to do, in one place.</p></div><button className="primary-button" onClick={()=>openNewTask(todayKey())}><Plus size={18}/> Add task</button></div><div className="filter-row">{(['All','Open','Completed'] as const).map(f=><button key={f} className={filter===f?'filter-pill selected':'filter-pill'} onClick={()=>setFilter(f)}>{f}{f==='All'&&<span>{tasks.length}</span>}</button>)}</div><TaskList tasks={visibleTasks} onToggle={toggleTask} onEdit={openEditTask} onDelete={deletePlannerTask} showDate emptyAction={()=>openNewTask(todayKey())}/></>}
        {tab==='habits'&&<><div className="page-heading"><div><div className="eyebrow">CONSISTENCY OVER PERFECTION</div><h1>Your habits</h1><p>Build routines that make your days better.</p></div><button className="primary-button" onClick={()=>setHabitOpen(true)}><Plus size={18}/> Add habit</button></div><div className="habit-date-note"><CalendarDays size={17}/> Check in for <strong>{prettyDate(selectedDate)}</strong><button className="text-button" onClick={()=>setSelectedDate(todayKey())}>Go to today</button></div><HabitList habits={habits} checkins={checkins} date={selectedDate} onToggle={toggleHabit} onDelete={deletePlannerHabit}/></>}
        {tab==='progress'&&<><div className="page-heading"><div><div className="eyebrow">NOTICE YOUR MOMENTUM</div><h1>Your progress</h1><p>Look back, learn, and keep moving forward.</p></div></div><section className="overview-grid progress-overview"><div className="overview-card"><div className="card-topline"><span>TOTAL TASKS DONE</span><CheckCircle2 size={17}/></div><strong className="stat-number">{tasks.filter(t=>t.completed).length}</strong><p className="stat-caption">Every completed task counts.</p></div><div className="overview-card"><div className="card-topline"><span>ACTIVE HABITS</span><Target size={17}/></div><strong className="stat-number">{habits.length}</strong><p className="stat-caption">Routines you're building.</p></div><div className="overview-card"><div className="card-topline"><span>HABIT CHECK-INS</span><Flame size={17}/></div><strong className="stat-number">{checkins.filter(c=>c.completed).length}</strong><p className="stat-caption">Small wins, added up.</p></div></section><section className="content-section chart-section"><div className="section-heading"><div><h2>Last 7 days</h2><p>Tasks completed each day.</p></div></div><div className="weekly-chart">{week.map(d=><div className="chart-column" key={d.key}><div className="chart-value">{d.done}/{d.total}</div><div className="chart-bar-area"><div className="chart-bar" style={{height:(d.total?Math.max(6,d.done/d.total*100):0)+'%'}}/></div><span>{d.label}</span></div>)}</div></section></>}
      </div>
    </main>
    {taskOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setTaskOpen(false)}}><form className="modal-card" onSubmit={saveTask}><div className="modal-heading"><div><div className="eyebrow">{editing?'UPDATE TASK':'MAKE IT HAPPEN'}</div><h2>{editing?'Edit task':'New task'}</h2></div><button type="button" className="icon-button" onClick={()=>setTaskOpen(false)}><X size={19}/></button></div><label>Task name<input autoFocus required maxLength={120} placeholder="What do you need to do?" value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Notes <span className="optional">Optional</span><textarea rows={3} placeholder="Add a little detail…" value={notes} onChange={e=>setNotes(e.target.value)}/></label><div className="form-two"><label>Due date<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} required/></label><label>Time <span className="optional">Optional</span><input type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)}/></label></div><label>Priority<select value={priority} onChange={e=>setPriority(e.target.value as 'High'|'Medium'|'Low')}><option>Low</option><option>Medium</option><option>High</option></select></label>{taskError&&<div className="auth-error" role="alert">{taskError}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setTaskOpen(false)} disabled={savingTask}>Cancel</button><button className="primary-button" type="submit" disabled={savingTask}>{savingTask?'Saving…':editing?'Save changes':'Add task'}</button></div></form></div>}
    {habitOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setHabitOpen(false)}}><form className="modal-card" onSubmit={addHabit}><div className="modal-heading"><div><div className="eyebrow">BUILD A ROUTINE</div><h2>Add a habit</h2></div><button type="button" className="icon-button" onClick={()=>setHabitOpen(false)}><X size={19}/></button></div><label>Habit name<input autoFocus required maxLength={80} placeholder="e.g. Read for 20 minutes" value={habitName} onChange={e=>setHabitName(e.target.value)}/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setHabitOpen(false)}>Cancel</button><button className="primary-button" type="submit">Add habit</button></div></form></div>}
    <nav className="bottom-nav">{navItems.map(([id,label,Icon])=><button key={id} className={tab===id?'bottom-item active':'bottom-item'} onClick={()=>setTab(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
  </div>;
}

function TaskList({tasks,onToggle,onEdit,onDelete,showDate=false,emptyAction}:{tasks:Task[];onToggle:(t:Task)=>void;onEdit:(t:Task)=>void;onDelete:(id:string)=>void;showDate?:boolean;emptyAction:()=>void}) {
 return <div className="task-list">{tasks.length===0?<div className="empty-state"><div className="empty-icon"><CheckCircle2 size={23}/></div><strong>Nothing on your list</strong><p>Enjoy the breathing room, or add a task when you're ready.</p><button className="secondary-button" onClick={emptyAction}><Plus size={16}/> Add your first task</button></div>:tasks.map(t=><div className={t.completed?'task-row completed':'task-row'} key={t.id}><button className="task-check" onClick={()=>onToggle(t)} aria-label={t.completed?'Mark incomplete':'Complete task'}>{t.completed?<Check size={15}/>:<Circle size={19}/>}</button><button className="task-main" onClick={()=>onEdit(t)}><strong>{t.title}</strong>{t.notes&&<span>{t.notes}</span>}<small>{showDate&&<><CalendarDays size={12}/>{prettyDate(t.dueDate,{month:'short',day:'numeric'})} · </>}{t.dueTime&&<><Clock3 size={12}/>{t.dueTime} · </>}<i className={'priority-dot '+t.priority.toLowerCase()}/>{t.priority} priority</small></button><button className="icon-button delete-button" title="Delete task" onClick={()=>onDelete(t.id)}><Trash2 size={16}/></button></div>)}</div>;
}
function HabitList({habits,checkins,date,onToggle,onDelete}:{habits:Habit[];checkins:Checkin[];date:string;onToggle:(h:Habit)=>void;onDelete?:(id:string)=>void}) {
 return <div className="habit-list">{habits.length===0?<div className="empty-state"><div className="empty-icon"><Target size={23}/></div><strong>No habits yet</strong><p>Start with one small routine you want to build.</p></div>:habits.map(h=>{const done=checkins.some(c=>c.habitId===h.id&&c.date===date&&c.completed);return <div className="habit-row" key={h.id}><div className="habit-emoji">{h.emoji||'✦'}</div><div className="habit-info"><strong>{h.name}</strong><span>{done?'Completed for today':'A small step, every day.'}</span></div><button className={done?'habit-check checked':'habit-check'} onClick={()=>onToggle(h)}>{done?<><Check size={16}/> Done</>:'Check in'}</button>{onDelete&&<button className="icon-button delete-button" title="Delete habit" onClick={()=>onDelete(h.id)}><Trash2 size={16}/></button>}</div>})}</div>;
}
