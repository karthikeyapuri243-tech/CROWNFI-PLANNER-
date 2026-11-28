import test from 'node:test';
import assert from 'node:assert/strict';
import {habitStarts,habitArchived,habitActiveOn,timeIntervalsOverlap} from '../src/lib/plannerLogic.ts';
const habit={createdAt:'2026-11-01T12:00:00',startDate:'2026-11-03',endDate:'2026-11-30'};
test('start and end dates are inclusive',()=>{
  assert.equal(habitActiveOn(habit,'2026-11-02'),false);
  assert.equal(habitActiveOn(habit,'2026-11-03'),true);
  assert.equal(habitActiveOn(habit,'2026-11-30'),true);
  assert.equal(habitActiveOn(habit,'2026-12-01'),false);
});
test('legacy habit starts on its local creation date and has no end',()=>{
  const legacy={createdAt:'2026-11-01T12:00:00'};
  assert.equal(habitStarts(legacy),'2026-11-01');
  assert.equal(habitActiveOn(legacy,'2027-01-01'),true);
  assert.equal(habitActiveOn(legacy,'2026-10-31'),false);
});
test('archiving preserves earlier eligibility and suspends future reminders',()=>{
  const archived={...habit,archivePeriods:[{from:'2026-11-12',to:null}]};
  assert.equal(habitArchived(archived),true);
  assert.equal(habitActiveOn(archived,'2026-11-11'),true);
  assert.equal(habitActiveOn(archived,'2026-11-12'),false);
  assert.equal(habitActiveOn(archived,'2026-11-20'),false);
});
test('restoring resumes the habit but does not fill missed archive days',()=>{
  const restored={...habit,archivePeriods:[{from:'2026-11-12',to:'2026-11-18'}]};
  assert.equal(habitArchived(restored),false);
  assert.equal(habitActiveOn(restored,'2026-11-17'),false);
  assert.equal(habitActiveOn(restored,'2026-11-18'),true);
});
test('overlap rejects intersecting blocks but permits touching boundaries',()=>{
  assert.equal(timeIntervalsOverlap(540,600,570,630),true);
  assert.equal(timeIntervalsOverlap(540,600,600,630),false);
  assert.equal(timeIntervalsOverlap(540,600,480,540),false);
  assert.equal(timeIntervalsOverlap(540,600,550,560),true);
  assert.equal(timeIntervalsOverlap(540,540,530,560),false);
});
