import { collection, deleteDoc, doc, getDocs, onSnapshot, query, runTransaction, where, writeBatch, type WriteBatch } from 'firebase/firestore';
import { auth, db } from './firebase';
const TASKS='plannerV2Tasks', HABITS='plannerV2Habits', CHECKINS='plannerV2Checkins', BLOCKS='plannerV2Blocks';
// A distinct, once-per-day activity record in the existing owner-protected check-in collection.
// completed:false keeps these records out of habit rewards even in older clients.
const DAILY_ENTRY_ID='__kram_daily_entry__';
const savedEntryDays=new Set<string>();
function entryDate(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
// Commit the first activity record and its planner change together. Concurrent devices
// use the same per-account/per-day document ID, so they cannot double-count a day.
async function withDailyEntry(userId:string|undefined,write:(batch:WriteBatch)=>void){
  const batch=writeBatch(db);
  write(batch);
  const date=entryDate();
  const id=userId&&auth.currentUser?.uid===userId?userId+'_'+DAILY_ENTRY_ID+'_'+date:'';
  if(id&&!savedEntryDays.has(id))batch.set(doc(db,CHECKINS,id),{userId,habitId:DAILY_ENTRY_ID,date,completed:false,recordType:'daily-entry'},{merge:true});
  await batch.commit();
  if(id)savedEntryDays.add(id);
}
async function createWithEntry(name:string,userId:string,data:any){
  const ref=doc(collection(db,name));
  await withDailyEntry(userId,batch=>batch.set(ref,data));
  return ref;
}

export function subscribePlannerTasks(userId:string,cb:(items:any[])=>void,onError?:(error:Error)=>void){return onSnapshot(query(collection(db,TASKS),where('userId','==',userId)),s=>cb(s.docs.filter(d=>d.data().workspace!=='internship').map(d=>({id:d.id,...d.data()})).sort((a:any,b:any)=>(a.dueDate||'').localeCompare(b.dueDate||''))),e=>{console.error('KRAM task sync failed:',e);onError?.(e);});}
export async function createPlannerTask(userId:string,payload:any){return createWithEntry(TASKS,userId,{...payload,userId,createdAt:new Date().toISOString()});}
export async function updatePlannerTask(id:string,payload:any){return withDailyEntry(auth.currentUser?.uid,batch=>batch.update(doc(db,TASKS,id),{...payload,updatedAt:new Date().toISOString()}));}
export async function createRecurringPlannerOccurrence(originalId:string,userId:string,nextDate:string,payload:any){
  const originalRef=doc(db,TASKS,originalId);
  const occurrenceRef=doc(db,TASKS,`${originalId}_${nextDate}`);
  return runTransaction(db,async transaction=>{
    const originalSnap=await transaction.get(originalRef);
    const occurrenceSnap=await transaction.get(occurrenceRef);
    if(!originalSnap.exists())throw new Error('Original recurring task no longer exists.');
    if(occurrenceSnap.exists()){
      if(originalSnap.data().lastGeneratedDate!==nextDate)transaction.update(originalRef,{lastGeneratedDate:nextDate,updatedAt:new Date().toISOString()});
      return false;
    }
    if(originalSnap.data().lastGeneratedDate===nextDate)return false;
    transaction.set(occurrenceRef,{...payload,userId,createdAt:new Date().toISOString()});
    transaction.update(originalRef,{lastGeneratedDate:nextDate,updatedAt:new Date().toISOString()});
    return true;
  });
}
export async function deletePlannerTask(id:string){return deleteDoc(doc(db,TASKS,id));}
export async function deletePlannerTaskSeries(userId:string,rootId:string){
  const snapshot=await getDocs(query(collection(db,TASKS),where('userId','==',userId)));
  const matches=snapshot.docs.filter(item=>item.id===rootId||item.id.startsWith(rootId+'_'));
  for(let offset=0;offset<matches.length;offset+=400){
    const batch=writeBatch(db);
    matches.slice(offset,offset+400).forEach(item=>batch.delete(item.ref));
    await batch.commit();
  }
  return matches.length;
}
export function subscribePlannerHabits(userId:string,cb:(items:any[])=>void,onError?:(error:Error)=>void){return onSnapshot(query(collection(db,HABITS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))),e=>{console.error(e);onError?.(e);});}
export async function createPlannerHabit(userId:string,name:string,settings:any={}){return createWithEntry(HABITS,userId,{userId,name,emoji:settings.emoji||'✦',goalType:settings.goalType==='quit'?'quit':'build',trackingType:settings.trackingType||'check',targetValue:settings.targetValue||0,unit:settings.unit||'',reminderTime:settings.reminderTime||null,reminderMinutesBefore:settings.reminderMinutesBefore??10,allowedSkipsPerWeek:Math.max(0,Math.min(7,Number(settings.allowedSkipsPerWeek??1))),createdAt:new Date().toISOString()});}
export async function updatePlannerHabit(id:string,payload:any){return withDailyEntry(auth.currentUser?.uid,batch=>batch.update(doc(db,HABITS,id),{...payload,updatedAt:new Date().toISOString()}));}
export async function deletePlannerHabit(id:string){return deleteDoc(doc(db,HABITS,id));}
export function subscribePlannerCheckins(userId:string,cb:(items:any[])=>void,onEntryDays?:(days:string[])=>void,onError?:(error:Error)=>void){return onSnapshot(query(collection(db,CHECKINS),where('userId','==',userId)),s=>{const entries=s.docs.filter(d=>d.data().habitId===DAILY_ENTRY_ID);cb(s.docs.filter(d=>d.data().habitId!==DAILY_ENTRY_ID).map(d=>({id:d.id,...d.data()})));onEntryDays?.(entries.map(d=>String(d.data().date)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)));if(!s.metadata.fromCache)entries.filter(d=>!d.metadata.hasPendingWrites).forEach(d=>savedEntryDays.add(d.id));},e=>{console.error(e);onError?.(e);});}
export async function setPlannerHabitCheckin(userId:string,habitId:string,date:string,completed:boolean,value?:number,extra:Record<string,any>={}){const id=userId+'_'+habitId+'_'+date;return withDailyEntry(userId,batch=>batch.set(doc(db,CHECKINS,id),{userId,habitId,date,completed,...(value!==undefined?{value}:{}),...extra,updatedAt:new Date().toISOString()},{merge:true}));}

export function subscribePlannerBlocks(userId:string,cb:(items:any[])=>void,onError?:(error:Error)=>void){return onSnapshot(query(collection(db,BLOCKS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))),e=>{console.error(e);onError?.(e);});}
export async function createPlannerBlock(userId:string,payload:any){return createWithEntry(BLOCKS,userId,{...payload,userId,createdAt:new Date().toISOString()});}
export async function updatePlannerBlock(id:string,payload:any){return withDailyEntry(auth.currentUser?.uid,batch=>batch.update(doc(db,BLOCKS,id),{...payload,updatedAt:new Date().toISOString()}));}
export async function deletePlannerBlock(id:string){return deleteDoc(doc(db,BLOCKS,id));}

export function subscribeInternshipTasks(userId:string,cb:(items:any[])=>void,onError?:(error:Error)=>void){return onSnapshot(query(collection(db,TASKS),where('userId','==',userId)),s=>cb(s.docs.filter(d=>d.data().workspace==='internship').map(d=>({id:d.id,...d.data()}))),e=>{console.error('KRAM internship sync failed:',e);onError?.(e);});}
export async function createInternshipTask(userId:string,payload:any){return createWithEntry(TASKS,userId,{...payload,workspace:'internship',userId,createdAt:new Date().toISOString()});}
export async function updateInternshipTask(id:string,payload:any){return withDailyEntry(auth.currentUser?.uid,batch=>batch.update(doc(db,TASKS,id),{...payload,updatedAt:new Date().toISOString()}));}
export async function deleteInternshipTask(id:string){return deleteDoc(doc(db,TASKS,id));}

export type DeletedPlannerTask = { userId:string; restoreId:string; data:Record<string,any> };
// Capture the latest server version before deleting. Only standalone items have Undo.
export async function deletePlannerTaskWithUndo(id:string,userId:string):Promise<DeletedPlannerTask>{
  if(auth.currentUser?.uid!==userId)throw new Error('Account changed');
  const original=doc(db,TASKS,id);
  const restoreId=doc(collection(db,TASKS)).id;
  const data=await runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(original);
    if(!snapshot.exists()||snapshot.data().userId!==userId)throw new Error('Item unavailable');
    const data=snapshot.data();
    if((data.repeat&&data.repeat!=='none')||/(?:_\d{4}-\d{2}-\d{2})$/.test(id))throw new Error('Recurring items cannot use Undo');
    transaction.delete(original);
    return data;
  });
  return {userId,restoreId,data};
}
export async function restoreDeletedPlannerTask(item:DeletedPlannerTask){
  if(auth.currentUser?.uid!==item.userId||item.data.userId!==item.userId)throw new Error('Account changed');
  // A fresh, preallocated ID avoids overwriting another device's record and makes retries idempotent.
  const batch=writeBatch(db);
  batch.set(doc(db,TASKS,item.restoreId),item.data);
  await batch.commit();
}

export type DeletedPlannerRoutine = { userId:string; id:string; kind:'habit'|'commitment'; data:Record<string,any> };
// Keep the original habit ID so historical check-ins and streaks remain linked.
export async function deletePlannerRoutineWithUndo(id:string,userId:string,kind:'habit'|'commitment'):Promise<DeletedPlannerRoutine>{
  if(auth.currentUser?.uid!==userId)throw new Error('Account changed');
  const ref=doc(db,kind==='habit'?HABITS:BLOCKS,id);
  const data=await runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(ref);
    if(!snapshot.exists()||snapshot.data().userId!==userId)throw new Error('Item unavailable');
    const original=snapshot.data();
    transaction.delete(ref);
    return original;
  });
  return {userId,id,kind,data};
}
export async function restoreDeletedPlannerRoutine(item:DeletedPlannerRoutine){
  if(auth.currentUser?.uid!==item.userId||item.data.userId!==item.userId)throw new Error('Account changed');
  // Restore the same ID. The owner-only Firestore rules continue to apply.
  const batch=writeBatch(db);
  batch.set(doc(db,item.kind==='habit'?HABITS:BLOCKS,item.id),item.data);
  await batch.commit();
}
