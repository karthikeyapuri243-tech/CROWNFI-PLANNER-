import React, { useState, useRef, useEffect } from 'react';
import { Task, RecurrenceFrequency } from '../types';
import { createTask, deleteTask } from '../lib/db';
import { getWeekdayIndices, parseTimeTo24h, parseDateLocal } from '../lib/taskHelpers';
import { 
  Upload, Sparkles, AlertCircle, CheckCircle, FileText, 
  Trash2, Plus, ArrowRight, Loader2, Calendar, Layers 
} from 'lucide-react';
import { motion } from 'motion/react';
import { createPortal } from 'react-dom';

interface TimetableParserProps {
  userId: string;
  tasks: Task[];
  onImportComplete: () => void;
}

interface ExtractedEvent {
  id: string;
  title: string;
  days: string[]; // e.g. ["Monday", "Wednesday"]
  startTime: string; // e.g. "09:30"
  endTime: string; // e.g. "11:00"
  category: string; // e.g. "Study"
  notes: string;
  selected: boolean;
}

const DAYS_MAP: { [key: string]: number } = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
};

const WEEKDAYS = [
  { label: 'M', value: 'Monday' },
  { label: 'T', value: 'Tuesday' },
  { label: 'W', value: 'Wednesday' },
  { label: 'T', value: 'Thursday' },
  { label: 'F', value: 'Friday' },
  { label: 'S', value: 'Saturday' },
  { label: 'S', value: 'Sunday' }
];

// Reassuring messages for loading screen
const LOADING_MESSAGES = [
  "Analyzing timetable layout structure...",
  "Running high-resolution contrast filters...",
  "Transcribing physical timetable text...",
  "Parsing row and column grids for hours...",
  "Auto-detecting recurring classes and shifts...",
  "Categorizing parsed events into subjects..."
];

export default function TimetableParser({ userId, tasks, onImportComplete }: TimetableParserProps) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [extractedEvents, setExtractedEvents] = useState<ExtractedEvent[]>([]);
  const [importing, setImporting] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [overlapData, setOverlapData] = useState<{
    selected: ExtractedEvent[];
    overlaps: { event: ExtractedEvent; task: Task }[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scheduleMode, setScheduleMode] = useState<'permanent' | 'range'>('range');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Default schedule dates to the current week's Monday to Saturday (e.g. July 6 to July 11)
  useEffect(() => {
    const today = new Date();
    const day = today.getDay();
    const diffToMonday = day === 0 ? 1 : 1 - day;
    
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday);
    
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);
    
    const toDateStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${da}`;
    };
    
    setStartDate(toDateStr(monday));
    setEndDate(toDateStr(saturday));
  }, []);

  // Interval for changing reassurance messages
  const messageIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startMessageRotation = () => {
    setLoadingMessageIdx(0);
    messageIntervalRef.current = setInterval(() => {
      setLoadingMessageIdx((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2500);
  };

  const stopMessageRotation = () => {
    if (messageIntervalRef.current) {
      clearInterval(messageIntervalRef.current);
    }
  };

  // Convert files to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFileChange = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file (PNG, JPG, or WEBP).');
      return;
    }
    setError(null);
    setImageFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Connect to backend server API endpoint
  const handleParseTimetable = async () => {
    if (!imageFile) return;

    setParsing(true);
    setError(null);
    setExtractedEvents([]);
    startMessageRotation();

    try {
      const base64Str = await fileToBase64(imageFile);
      const res = await fetch('/api/gemini/parse-timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Str,
          mimeType: imageFile.type
        })
      });

      if (!res.ok) {
        const text = await res.text();
        let errMsg = 'Server parsing failed';
        try {
          const errData = JSON.parse(text);
          errMsg = errData.error || errMsg;
        } catch {
          // If response is HTML, try to extract body text or use a slice of the text
          const bodyMatch = text.match(/<body>\s*<pre>([\s\S]*?)<\/pre>/i) || text.match(/<body>([\s\S]*?)<\/body>/i);
          if (bodyMatch && bodyMatch[1]) {
            errMsg = bodyMatch[1].replace(/<[^>]*>/g, '').trim();
          } else {
            errMsg = text.substring(0, 200) || errMsg;
          }
        }
        throw new Error(errMsg);
      }

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        const bodyMatch = text.match(/<body>\s*<pre>([\s\S]*?)<\/pre>/i) || text.match(/<body>([\s\S]*?)<\/body>/i);
        let extractedError = '';
        if (bodyMatch && bodyMatch[1]) {
          extractedError = bodyMatch[1].replace(/<[^>]*>/g, '').trim();
        } else {
          extractedError = text.substring(0, 150);
        }
        throw new Error(`Invalid server response: ${extractedError}`);
      }
      const events: ExtractedEvent[] = (data.events || []).map((e: any, idx: number) => ({
        id: `extracted_${idx}_${Date.now()}`,
        title: e.title || 'Untitled Class',
        days: e.days || [],
        startTime: parseTimeTo24h(e.startTime || '09:00'),
        endTime: parseTimeTo24h(e.endTime || '10:00'),
        category: e.category || 'Study',
        notes: e.notes || '',
        selected: true
      }));

      setExtractedEvents(events);
      if (events.length === 0) {
        setError('Gemini parsed the image but could not identify any weekly classes or events. Please try a clearer picture.');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while calling the Gemini parser.');
    } finally {
      setParsing(false);
      stopMessageRotation();
    }
  };

  // Modify Extracted Item
  const handleEditField = (id: string, field: keyof ExtractedEvent, value: any) => {
    setExtractedEvents(
      extractedEvents.map((e) => e.id === id ? { ...e, [field]: value } : e)
    );
  };

  const toggleDay = (eventId: string, dayValue: string) => {
    setExtractedEvents((prev) =>
      prev.map((e) => {
        if (e.id !== eventId) return e;
        const lowerDay = dayValue.toLowerCase().trim();
        const exists = e.days.some((d) => {
          const dLower = d.toLowerCase().trim();
          return dLower === lowerDay || dLower.startsWith(lowerDay.substring(0, 3));
        });
        const newDays = exists
          ? e.days.filter((d) => {
              const dLower = d.toLowerCase().trim();
              return dLower !== lowerDay && !dLower.startsWith(lowerDay.substring(0, 3));
            })
          : [...e.days, dayValue];
        return { ...e, days: newDays };
      })
    );
  };

  const handleDeleteItem = (id: string) => {
    setExtractedEvents(extractedEvents.filter((e) => e.id !== id));
  };

  const handleAddBlankRow = () => {
    const newRow: ExtractedEvent = {
      id: `extracted_manual_${Date.now()}`,
      title: 'New Class/Shift',
      days: ['Monday'],
      startTime: '09:00',
      endTime: '10:00',
      category: 'Study',
      notes: '',
      selected: true
    };
    setExtractedEvents([...extractedEvents, newRow]);
  };

  const getOverlappingTasksForEvents = (selectedEvents: ExtractedEvent[], existingTasks: Task[]) => {
    const overlaps: { event: ExtractedEvent; task: Task }[] = [];
    
    for (const event of selectedEvents) {
      const eventWeekdays = getWeekdayIndices(event.days);
      const eventStart = parseTimeTo24h(event.startTime);
      const eventEnd = parseTimeTo24h(event.endTime);
      
      for (const t of existingTasks) {
        if (!t.isScheduled || t.isInbox || !t.startTime || !t.endTime) continue;
        
        // Determine what weekdays the existing task is active on
        let taskWeekdays: number[] = [];
        if (t.isRecurring && t.recurrence) {
          if (t.recurrence.frequency === 'daily') {
            taskWeekdays = [0, 1, 2, 3, 4, 5, 6];
          } else if (t.recurrence.weekdays && t.recurrence.weekdays.length > 0) {
            taskWeekdays = t.recurrence.weekdays.map(Number);
          } else {
            const startDayOfWeek = parseDateLocal(t.dueDate).getDay();
            taskWeekdays = [startDayOfWeek];
          }
        } else if (t.dueDate) {
          const dayOfWeek = parseDateLocal(t.dueDate).getDay();
          taskWeekdays = [dayOfWeek];
        }
        
        // Check if they share any weekday
        const sharesWeekday = eventWeekdays.some(day => taskWeekdays.includes(day));
        if (!sharesWeekday) continue;
        
        // Check if time intervals overlap
        const tStart = t.startTime;
        const tEnd = t.endTime;
        const timeOverlap = (tStart < eventEnd && eventStart < tEnd);
        
        if (timeOverlap) {
          const alreadyAdded = overlaps.some(o => o.event.id === event.id && o.task.id === t.id);
          if (!alreadyAdded) {
            overlaps.push({ event, task: t });
          }
        }
      }
    }
    return overlaps;
  };

  const performImport = async (selected: ExtractedEvent[], taskIdsToReplace: string[]) => {
    setImporting(true);
    setError(null);
    setOverlapData(null);
    let count = 0;

    try {
      // First, delete replaced tasks if any
      if (taskIdsToReplace.length > 0) {
        await Promise.all(taskIdsToReplace.map(id => deleteTask(id)));
      }

      const today = new Date();
      const year = today.getFullYear();
      const firstDueDateStr = `${year}-01-01`;

      for (const event of selected) {
        const weekdaysIndices = getWeekdayIndices(event.days);
        if (weekdaysIndices.length === 0) {
          weekdaysIndices.push(1);
        }

        const startTime24 = parseTimeTo24h(event.startTime);
        const endTime24 = parseTimeTo24h(event.endTime);

        const [sh, sm] = startTime24.split(':').map(Number);
        const [eh, em] = endTime24.split(':').map(Number);
        const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);

        const taskDueDate = scheduleMode === 'range' ? startDate : firstDueDateStr;
        const taskEndDate = scheduleMode === 'range' ? endDate : undefined;

        await createTask(userId, {
          title: event.title.trim(),
          notes: event.notes.trim() || 'Imported via Timetable Photo Parser',
          priority: 'Medium',
          category: event.category || 'Study',
          dueDate: taskDueDate,
          subtasks: [],
          isCompleted: false,
          isInbox: false,
          isScheduled: true,
          startTime: startTime24,
          endTime: endTime24,
          durationMinutes: durationMinutes > 0 ? durationMinutes : 60,
          isRecurring: true,
          itemType: 'class',
          recurrence: {
            frequency: 'weekly',
            weekdays: weekdaysIndices,
            endDate: taskEndDate
          }
        });
        count++;
      }

      setSuccessCount(count);
      setTimeout(() => {
        setSuccessCount(null);
        setImageFile(null);
        setImagePreview(null);
        setExtractedEvents([]);
        onImportComplete();
      }, 3000);

    } catch (err) {
      console.error(err);
      setError('Failed to import events to database. Please check connection and try again.');
    } finally {
      setImporting(false);
    }
  };

  // Commit selected events into Firestore as real-time, weekly recurring calendar time blocks!
  const handleImportSave = async () => {
    const selected = extractedEvents.filter((e) => e.selected);
    if (selected.length === 0) {
      setError('Please select at least one event to save.');
      return;
    }

    if (scheduleMode === 'range' && (!startDate || !endDate)) {
      setError('Please provide both Start and End Dates for the schedule range.');
      return;
    }

    // Check for overlapping tasks
    const overlaps = getOverlappingTasksForEvents(selected, tasks);
    if (overlaps.length > 0) {
      setOverlapData({ selected, overlaps });
      return;
    }

    // No overlaps, perform import directly
    await performImport(selected, []);
  };

  return (
    <div className="bg-cardbg border border-natborder rounded-3xl p-6 shadow-xs space-y-6" id="timetable-uploader-section">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-olive/10 text-olive">
          <Sparkles className="w-5 h-5 animate-pulse" />
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-natmuted">AI Workspace Integration</span>
          <h2 className="text-lg font-bold font-serif italic text-nattext">Timetable Photo Parser</h2>
        </div>
      </div>

      {successCount !== null ? (
        <div className="text-center py-12 space-y-3 bg-olive/5 rounded-3xl border border-olive/20 animate-fade-in" id="parser-success">
          <CheckCircle className="w-12 h-12 text-olive mx-auto animate-bounce" />
          <h3 className="text-lg font-serif italic text-nattext font-semibold">Import Succeeded!</h3>
          <p className="text-sm text-natmuted">Successfully created <strong>{successCount}</strong> recurring time blocks in your calendar schedule.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* STEP 1: UPLOAD ZONE (Drag & Drop or Manual selection) */}
          {extractedEvents.length === 0 && !parsing && (
            <div className="space-y-4">
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-natborder hover:border-olive/40 bg-paper/30 hover:bg-paper/70 rounded-3xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-3 min-h-[220px]"
                id="timetable-drag-drop-zone"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
                  className="hidden"
                  accept="image/*"
                />
                
                {imagePreview ? (
                  <div className="relative max-h-40 overflow-hidden rounded-xl border border-natborder" onClick={(e) => e.stopPropagation()}>
                    <img src={imagePreview} alt="Timetable preview" className="object-contain max-h-36 max-w-xs" referrerPolicy="no-referrer" />
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-olive/10 text-olive flex items-center justify-center">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-nattext">Drag & drop timetable photo here</p>
                      <p className="text-xs text-natmuted mt-1">or click to browse local files (PNG, JPG, WEBP)</p>
                    </div>
                  </>
                )}
              </div>

              {imageFile && (
                <div className="flex items-center justify-between p-3 bg-paper rounded-2xl border border-natborder">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4.5 h-4.5 text-olive shrink-0" />
                    <span className="text-xs font-semibold text-nattext truncate max-w-xs">{imageFile.name}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setImageFile(null); setImagePreview(null); }}
                      className="px-3 py-1.5 border border-natborder text-natmuted hover:text-clay hover:bg-clay/5 rounded-xl text-xs font-semibold cursor-pointer"
                    >
                      Clear
                    </button>
                    <button
                      onClick={handleParseTimetable}
                      className="px-4 py-1.5 bg-olive text-white rounded-xl text-xs font-bold shadow-md shadow-olive/10 flex items-center gap-1 cursor-pointer hover:bg-olive/90"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Parse with Gemini</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: GEMINI PARSING SCREEN (with reassuring messages) */}
          {parsing && (
            <div className="text-center py-16 space-y-5 bg-paper/40 border border-natborder rounded-3xl" id="parsing-loader">
              <div className="relative inline-flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-olive animate-spin" />
                <Sparkles className="w-5 h-5 text-clay absolute" />
              </div>
              <div className="space-y-1.5 animate-pulse">
                <h3 className="text-sm font-bold font-serif italic text-nattext">Gemini is transcribing your timetable...</h3>
                <p className="text-xs text-olive font-semibold">{LOADING_MESSAGES[loadingMessageIdx]}</p>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="flex items-start gap-2.5 p-4 rounded-2xl bg-clay/10 border border-clay/20 text-clay text-xs" id="parser-error">
              <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Failed parsing timetable</span>
                <p className="mt-1 leading-relaxed">{error}</p>
                {extractedEvents.length === 0 && (
                  <button
                    onClick={() => { setImageFile(null); setImagePreview(null); setError(null); }}
                    className="mt-2.5 text-xs font-bold underline cursor-pointer hover:text-clay/80"
                  >
                    Try uploading a different photo
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & EDIT EXTRACTIONS TABLE */}
          {extractedEvents.length > 0 && (
            <div className="space-y-4" id="timetable-preview-table-container">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-natborder/60">
                <div>
                  <h3 className="text-sm font-bold text-nattext">Confirm Parsed Events</h3>
                  <p className="text-xs text-natmuted">Verify and manually adjust days, hours, class names, or notes before importing.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddBlankRow}
                    className="px-3 py-1.5 border border-natborder text-natmuted hover:text-nattext hover:bg-paper rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Add Row
                  </button>
                  <button
                    onClick={() => setExtractedEvents([])}
                    className="px-3 py-1.5 border border-natborder text-natmuted hover:text-clay rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Re-upload
                  </button>
                </div>
              </div>

              {/* Import Duration / Range Settings */}
              <div className="bg-paper/40 border border-natborder rounded-2xl p-4 space-y-3" id="timetable-import-settings">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-olive" />
                  <span className="text-xs font-bold uppercase tracking-wider text-nattext">Schedule Date Range Configuration</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1.5">Schedule Duration</label>
                    <div className="grid grid-cols-2 gap-1.5 p-1 bg-paper border border-natborder/60 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setScheduleMode('range')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                          scheduleMode === 'range'
                            ? 'bg-olive text-white shadow-xs'
                            : 'text-natmuted hover:text-nattext'
                        }`}
                      >
                        Specific Range
                      </button>
                      <button
                        type="button"
                        onClick={() => setScheduleMode('permanent')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                          scheduleMode === 'permanent'
                            ? 'bg-olive text-white shadow-xs'
                            : 'text-natmuted hover:text-nattext'
                        }`}
                      >
                        Indefinite
                      </button>
                    </div>
                  </div>

                  {scheduleMode === 'range' && (
                    <>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1.5">Start Date</label>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full bg-paper border border-natborder/60 focus:border-olive/40 rounded-xl px-3 py-1.5 text-xs text-nattext focus:outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-natmuted mb-1.5">End Date (Inclusive)</label>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full bg-paper border border-natborder/60 focus:border-olive/40 rounded-xl px-3 py-1.5 text-xs text-nattext focus:outline-none transition-all"
                        />
                      </div>
                    </>
                  )}
                  
                  {scheduleMode === 'permanent' && (
                    <div className="md:col-span-2 text-xs text-natmuted italic flex items-center h-10 px-1">
                      Classes will recur weekly on specified days with no end date.
                    </div>
                  )}
                </div>
              </div>

              {/* Spreadsheet layout */}
              <div className="overflow-x-auto border border-natborder rounded-2xl max-h-[380px] overflow-y-auto">
                <table className="w-full text-left border-collapse min-w-[750px]">
                  <thead>
                    <tr className="bg-paper text-[10px] uppercase font-bold tracking-wider text-natmuted border-b border-natborder">
                      <th className="p-3 w-10 text-center">Import</th>
                      <th className="p-3 min-w-[150px]">Class/Event Title</th>
                      <th className="p-3 min-w-[190px]">Days of Week</th>
                      <th className="p-3 w-28">Start</th>
                      <th className="p-3 w-28">End</th>
                      <th className="p-3 w-32">Category</th>
                      <th className="p-3 min-w-[130px]">Notes / Room</th>
                      <th className="p-3 w-12 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extractedEvents.map((event) => (
                      <tr 
                        key={event.id}
                        className={`border-b border-natborder/60 hover:bg-paper/30 transition-colors text-xs ${
                          !event.selected ? 'opacity-40 bg-stone-50/50' : ''
                        }`}
                      >
                        {/* Toggle Import */}
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={event.selected}
                            onChange={(e) => handleEditField(event.id, 'selected', e.target.checked)}
                            className="w-4 h-4 rounded text-olive border-natborder focus:ring-olive cursor-pointer"
                            title="Select for import"
                          />
                        </td>

                        {/* Title input */}
                        <td className="p-3 font-semibold">
                          <input
                            type="text"
                            value={event.title}
                            onChange={(e) => handleEditField(event.id, 'title', e.target.value)}
                            className="w-full bg-paper/50 hover:bg-cardbg focus:bg-cardbg border border-natborder/60 focus:border-olive/40 rounded-lg px-2.5 py-1 text-xs text-nattext focus:outline-none transition-all"
                            title="Edit Event Title"
                            placeholder="e.g. Physics 101"
                          />
                        </td>

                        {/* Days of Week - Interactive toggles */}
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            {WEEKDAYS.map((day) => {
                              const isActive = event.days.some((d) => {
                                const dLower = d.toLowerCase().trim();
                                const target = day.value.toLowerCase().trim();
                                return dLower === target || dLower.startsWith(target.substring(0, 3));
                              });
                              return (
                                <button
                                  key={day.value}
                                  type="button"
                                  onClick={() => toggleDay(event.id, day.value)}
                                  className={`w-6.5 h-6.5 rounded-full text-[10px] font-bold flex items-center justify-center transition-all cursor-pointer ${
                                    isActive 
                                      ? 'bg-olive text-white shadow-xs scale-105 font-extrabold' 
                                      : 'bg-paper text-natmuted border border-natborder/60 hover:bg-sand/30 hover:text-nattext'
                                  }`}
                                  title={`Toggle ${day.value}`}
                                >
                                  {day.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>

                        {/* Start time */}
                        <td className="p-3">
                          <input
                            type="time"
                            value={event.startTime}
                            onChange={(e) => handleEditField(event.id, 'startTime', e.target.value)}
                            className="bg-paper hover:bg-cardbg focus:bg-cardbg border border-natborder/60 focus:border-olive/40 rounded-lg px-2 py-1 text-xs text-nattext focus:outline-none w-full transition-all"
                            title="Edit Start Time"
                          />
                        </td>

                        {/* End time */}
                        <td className="p-3">
                          <input
                            type="time"
                            value={event.endTime}
                            onChange={(e) => handleEditField(event.id, 'endTime', e.target.value)}
                            className="bg-paper hover:bg-cardbg focus:bg-cardbg border border-natborder/60 focus:border-olive/40 rounded-lg px-2 py-1 text-xs text-nattext focus:outline-none w-full transition-all"
                            title="Edit End Time"
                          />
                        </td>

                        {/* Category */}
                        <td className="p-3">
                          <select
                            value={event.category}
                            onChange={(e) => handleEditField(event.id, 'category', e.target.value)}
                            className="bg-paper hover:bg-cardbg focus:bg-cardbg border border-natborder/60 focus:border-olive/40 rounded-lg px-2 py-1 text-xs text-nattext focus:outline-none cursor-pointer w-full transition-all"
                            title="Edit Category"
                          >
                            <option value="Study">Study</option>
                            <option value="Work">Work</option>
                            <option value="Personal">Personal</option>
                            <option value="Business">Business</option>
                            <option value="Health">Health</option>
                            <option value="Leisure">Leisure</option>
                            <option value="Other">Other</option>
                          </select>
                        </td>

                        {/* Notes / Room */}
                        <td className="p-3">
                          <input
                            type="text"
                            value={event.notes || ''}
                            onChange={(e) => handleEditField(event.id, 'notes', e.target.value)}
                            className="w-full bg-paper/50 hover:bg-cardbg focus:bg-cardbg border border-natborder/60 focus:border-olive/40 rounded-lg px-2 py-1 text-xs text-nattext focus:outline-none transition-all"
                            placeholder="Room, instructor..."
                            title="Edit Location or Notes"
                          />
                        </td>

                        {/* Delete row */}
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleDeleteItem(event.id)}
                            className="p-1 rounded-md hover:bg-clay/10 text-clay hover:text-clay/80 transition-colors cursor-pointer"
                            title="Delete Row"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Confirm / Import submit */}
              <div className="flex justify-end gap-3.5 pt-2">
                <button
                  type="button"
                  onClick={() => setExtractedEvents([])}
                  className="px-5 py-2.5 rounded-xl border border-natborder hover:bg-paper text-natmuted hover:text-nattext text-xs font-semibold transition-all cursor-pointer"
                >
                  Clear All
                </button>
                <button
                  type="button"
                  onClick={handleImportSave}
                  disabled={importing}
                  className="px-5 py-2.5 rounded-xl bg-olive text-white hover:bg-olive/95 active:bg-olive disabled:opacity-50 text-xs font-bold shadow-md shadow-olive/10 flex items-center justify-center gap-2 transition-all cursor-pointer min-w-[120px]"
                >
                  {importing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Layers className="w-4 h-4" />
                      <span>Import into Schedule</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {overlapData && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            onClick={() => setOverlapData(null)}
            className="absolute inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
          />
          
          {/* Modal Card */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.35 }}
            className="relative bg-cardbg border border-natborder rounded-3xl p-6 shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto space-y-4"
            id="overlap-resolution-modal"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 animate-pulse">
                <AlertCircle className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Schedule Conflict Detected</span>
                <h3 className="text-base font-serif font-bold italic text-nattext">
                  Resolve Overlapping Classes
                </h3>
              </div>
            </div>

            <p className="text-xs text-natmuted leading-relaxed">
              The following classes in your roster import overlap in day and time with existing scheduled blocks. How would you like to handle these conflicts?
            </p>

            <div className="border border-natborder/60 rounded-2xl bg-paper/50 divide-y divide-natborder/40 overflow-hidden">
              {overlapData.overlaps.map((overlap, idx) => {
                const eventDays = overlap.event.days.join(', ');
                const taskDays = overlap.task.isRecurring && overlap.task.recurrence?.weekdays 
                  ? overlap.task.recurrence.weekdays.map(d => {
                      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                      return names[d];
                    }).join(', ')
                  : 'Single Occurrence';

                return (
                  <div key={idx} className="p-3.5 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="bg-olive/10 text-olive px-2 py-0.5 rounded-md font-semibold text-[10px] uppercase">
                        New
                      </div>
                      <div className="text-right text-nattext font-medium">
                        {overlap.event.title}
                      </div>
                    </div>
                    <div className="text-[11px] text-natmuted flex justify-between">
                      <span>Time: {overlap.event.startTime} - {overlap.event.endTime}</span>
                      <span>Days: {eventDays}</span>
                    </div>

                    <div className="h-px bg-dashed border-t border-natborder/20 my-1" />

                    <div className="flex items-center justify-between gap-2">
                      <div className="bg-clay/15 text-clay px-2 py-0.5 rounded-md font-semibold text-[10px] uppercase">
                        Existing
                      </div>
                      <div className="text-right text-nattext font-medium">
                        {overlap.task.title}
                      </div>
                    </div>
                    <div className="text-[11px] text-natmuted flex justify-between">
                      <span>Time: {overlap.task.startTime} - {overlap.task.endTime}</span>
                      <span>Days: {taskDays}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={async () => {
                  const toReplace = overlapData.overlaps.map(o => o.task.id).filter((v, i, a) => a.indexOf(v) === i);
                  await performImport(overlapData.selected, toReplace);
                }}
                disabled={importing}
                className="w-full py-2.5 px-4 rounded-xl bg-clay hover:bg-clay/95 text-white text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                Replace Existing with New Tasks
              </button>
              <button
                type="button"
                onClick={async () => {
                  await performImport(overlapData.selected, []);
                }}
                disabled={importing}
                className="w-full py-2.5 px-4 rounded-xl border border-natborder hover:bg-paper text-nattext text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                Keep Both (Schedule Side-by-Side)
              </button>
              <button
                type="button"
                onClick={() => setOverlapData(null)}
                disabled={importing}
                className="w-full py-2 px-4 text-natmuted hover:text-nattext text-xs font-semibold transition-all cursor-pointer flex items-center justify-center disabled:opacity-50"
              >
                Cancel Import
              </button>
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </div>
  );
}
