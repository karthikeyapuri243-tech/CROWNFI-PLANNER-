import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, runTransaction, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
const TASKS='plannerV2Tasks', HABITS='plannerV2Habits', CHECKINS='plannerV2Checkins', BLOCKS='plannerV2Blocks';
export function subscribePlannerTasks(userId:string,cb:(items:any[])=>void,onError?:(error:Error)=>void){return onSnapshot(query(collection(db,TASKS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()})).sort((a:any,b:any)=>a.dueDate.localeCompare(b.dueDate))),e=>{console.error('KRAM task sync failed:',e);onError?.(e);});}
export async function createPlannerTask(userId:string,payload:any){return addDoc(collection(db,TASKS),{...payload,userId,createdAt:new Date().toISOString()});}
export async function updatePlannerTask(id:string,payload:any){return updateDoc(doc(db,TASKS,id),{...payload,updatedAt:new Date().toISOString()});}
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
export function subscribePlannerHabits(userId:string,cb:(items:any[])=>void){return onSnapshot(query(collection(db,HABITS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))),e=>console.error(e));}
export async function createPlannerHabit(userId:string,name:string,settings:any={}){return addDoc(collection(db,HABITS),{userId,name,emoji:settings.emoji||'✦',trackingType:settings.trackingType||'check',targetValue:settings.targetValue||0,unit:settings.unit||'',reminderTime:settings.reminderTime||null,reminderMinutesBefore:settings.reminderMinutesBefore??10,allowedSkipsPerWeek:Math.max(0,Math.min(7,Number(settings.allowedSkipsPerWeek??1))),createdAt:new Date().toISOString()});}
export async function updatePlannerHabit(id:string,payload:any){return updateDoc(doc(db,HABITS,id),{...payload,updatedAt:new Date().toISOString()});}
export async function deletePlannerHabit(id:string){return deleteDoc(doc(db,HABITS,id));}
export function subscribePlannerCheckins(userId:string,cb:(items:any[])=>void){return onSnapshot(query(collection(db,CHECKINS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))),e=>console.error(e));}
export async function setPlannerHabitCheckin(userId:string,habitId:string,date:string,completed:boolean,value?:number,extra:Record<string,any>={}){const id=userId+'_'+habitId+'_'+date;return setDoc(doc(db,CHECKINS,id),{userId,habitId,date,completed,...(value!==undefined?{value}:{}),...extra,updatedAt:new Date().toISOString()},{merge:true});}

export function subscribePlannerBlocks(userId:string,cb:(items:any[])=>void){return onSnapshot(query(collection(db,BLOCKS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))),e=>console.error(e));}
export async function createPlannerBlock(userId:string,payload:any){return addDoc(collection(db,BLOCKS),{...payload,userId,createdAt:new Date().toISOString()});}
export async function updatePlannerBlock(id:string,payload:any){return updateDoc(doc(db,BLOCKS,id),{...payload,updatedAt:new Date().toISOString()});}
export async function deletePlannerBlock(id:string){return deleteDoc(doc(db,BLOCKS,id));}
