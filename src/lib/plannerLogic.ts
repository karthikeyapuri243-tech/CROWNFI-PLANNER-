// Shared date and interval rules used by the UI and automated regression tests.
type DatedHabit={createdAt:string;startDate?:string|null;endDate?:string|null;archivePeriods?:{from:string;to?:string|null}[]};
export const localDateKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const habitAddedDate=(h:DatedHabit)=>{const added=new Date(h.createdAt);return h.createdAt&&Number.isFinite(added.getTime())?localDateKey(added):'';};
export const habitStarts=(h:DatedHabit)=>h.startDate||habitAddedDate(h);
export const habitArchived=(h:DatedHabit)=>!!h.archivePeriods?.some(p=>!p.to);
export const habitActiveOn=(h:DatedHabit,date:string)=>(!habitStarts(h)||date>=habitStarts(h))&&(!h.endDate||date<=h.endDate)&&!(h.archivePeriods||[]).some(p=>date>=p.from&&(!p.to||date<p.to));
export const timeIntervalsOverlap=(start:number,end:number,otherStart:number,otherEnd:number)=>start<end&&otherStart<otherEnd&&start<otherEnd&&end>otherStart;
