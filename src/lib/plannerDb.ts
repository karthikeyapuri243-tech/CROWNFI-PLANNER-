import { addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
const TASKS='plannerV2Tasks', HABITS='plannerV2Habits', CHECKINS='plannerV2Checkins', BLOCKS='plannerV2Blocks';
export function subscribePlannerTasks(userId:string,cb:(items:any[])=>void){return onSnapshot(query(collection(db,TASKS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()})).sort((a:any,b:any)=>a.dueDate.localeCompare(b.dueDate))),e=>console.error(e));}
export async function createPlannerTask(userId:string,payload:any){return addDoc(collection(db,TASKS),{...payload,userId,createdAt:new Date().toISOString()});}
export async function updatePlannerTask(id:string,payload:any){return updateDoc(doc(db,TASKS,id),{...payload,updatedAt:new Date().toISOString()});}
export async function deletePlannerTask(id:string){return deleteDoc(doc(db,TASKS,id));}
export function subscribePlannerHabits(userId:string,cb:(items:any[])=>void){return onSnapshot(query(collection(db,HABITS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))),e=>console.error(e));}
export async function createPlannerHabit(userId:string,name:string){return addDoc(collection(db,HABITS),{userId,name,emoji:'✦',createdAt:new Date().toISOString()});}
export async function deletePlannerHabit(id:string){return deleteDoc(doc(db,HABITS,id));}
export function subscribePlannerCheckins(userId:string,cb:(items:any[])=>void){return onSnapshot(query(collection(db,CHECKINS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))),e=>console.error(e));}
export async function setPlannerHabitCheckin(userId:string,habitId:string,date:string,completed:boolean){const id=userId+'_'+habitId+'_'+date;return setDoc(doc(db,CHECKINS,id),{userId,habitId,date,completed,updatedAt:new Date().toISOString()});}

export function subscribePlannerBlocks(userId:string,cb:(items:any[])=>void){return onSnapshot(query(collection(db,BLOCKS),where('userId','==',userId)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))),e=>console.error(e));}
export async function createPlannerBlock(userId:string,payload:any){return addDoc(collection(db,BLOCKS),{...payload,userId,createdAt:new Date().toISOString()});}
export async function deletePlannerBlock(id:string){return deleteDoc(doc(db,BLOCKS,id));}
