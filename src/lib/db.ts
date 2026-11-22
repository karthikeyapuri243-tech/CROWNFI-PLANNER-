import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  updateDoc, 
  getDoc,
  getDocFromServer,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { Task, UserSettings, Habit, HabitLog } from '../types';

// Error Handler conformant with FirestoreErrorInfo
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error details: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Bootstrap Verification
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

// Subscribe to Tasks
export const subscribeTasks = (userId: string, onUpdate: (tasks: Task[]) => void) => {
  const path = 'tasks';
  const tasksRef = collection(db, path);
  const q = query(
    tasksRef, 
    where('userId', '==', userId)
  );

  return onSnapshot(q, (snapshot) => {
    const tasks: Task[] = [];
    snapshot.forEach((doc) => {
      tasks.push({ id: doc.id, ...doc.data() } as Task);
    });
    // Sort by createdAt descending in memory
    tasks.sort((a, b) => {
      const dateA = a.createdAt || '';
      const dateB = b.createdAt || '';
      return dateB.localeCompare(dateA);
    });
    onUpdate(tasks);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, path);
  });
};



// Create a Task
export const createTask = async (
  userId: string, 
  task: Omit<Task, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'rescheduleCount'>
) => {
  const path = 'tasks';
  const tasksRef = collection(db, path);
  const now = new Date().toISOString();
  
  const newTask = {
    ...task,
    userId,
    rescheduleCount: 0,
    createdAt: now,
    updatedAt: now
  };

  try {
    const docRef = await addDoc(tasksRef, newTask);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
};

// Update a Task
export const updateTask = async (taskId: string, taskUpdate: Partial<Task>) => {
  const path = `tasks/${taskId}`;
  const taskDocRef = doc(db, 'tasks', taskId);
  const updatePayload = {
    ...taskUpdate,
    updatedAt: new Date().toISOString()
  };

  try {
    await updateDoc(taskDocRef, updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
};

// Delete a Task
export const deleteTask = async (taskId: string) => {
  const path = `tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};



// Subscribe to User Settings
export const subscribeSettings = (userId: string, onUpdate: (settings: UserSettings) => void) => {
  const path = `settings/${userId}`;
  const settingsDocRef = doc(db, 'settings', userId);

  return onSnapshot(settingsDocRef, (docSnap) => {
    if (docSnap.exists()) {
      onUpdate(docSnap.data() as UserSettings);
    } else {
      // Return default settings
      onUpdate({
        darkMode: false,
        timelineStartHour: 6,
        timelineEndHour: 24,
        createdAt: new Date().toISOString()
      });
    }
  }, (error) => {
    // Fallback if settings collection rules deny access
    console.warn("Settings subscription denied or failed, using defaults:", error.message);
  });
};

// Save User Settings
export const saveSettings = async (userId: string, settings: Partial<UserSettings>) => {
  const path = `settings/${userId}`;
  const settingsDocRef = doc(db, 'settings', userId);
  try {
    await setDoc(settingsDocRef, {
      ...settings,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
};

// Subscribe to Habits
export const subscribeHabits = (userId: string, onUpdate: (habits: Habit[]) => void) => {
  const path = 'habits';
  const habitsRef = collection(db, path);
  const q = query(
    habitsRef, 
    where('userId', '==', userId)
  );

  return onSnapshot(q, (snapshot) => {
    const habits: Habit[] = [];
    snapshot.forEach((doc) => {
      habits.push({ id: doc.id, ...doc.data() } as Habit);
    });
    // Sort by createdAt descending in memory
    habits.sort((a, b) => {
      const dateA = a.createdAt || '';
      const dateB = b.createdAt || '';
      return dateB.localeCompare(dateA);
    });
    onUpdate(habits);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, path);
  });
};

// Subscribe to Habit Logs
export const subscribeHabitLogs = (userId: string, onUpdate: (logs: HabitLog[]) => void) => {
  const path = 'habitLogs';
  const logsRef = collection(db, path);
  const q = query(
    logsRef, 
    where('userId', '==', userId)
  );

  return onSnapshot(q, (snapshot) => {
    const logs: HabitLog[] = [];
    snapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() } as HabitLog);
    });
    // Sort by createdAt descending in memory
    logs.sort((a, b) => {
      const dateA = a.createdAt || '';
      const dateB = b.createdAt || '';
      return dateB.localeCompare(dateA);
    });
    onUpdate(logs);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, path);
  });
};

// Create a Habit
export const createHabit = async (
  userId: string, 
  habit: Omit<Habit, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
) => {
  const path = 'habits';
  const habitsRef = collection(db, path);
  const now = new Date().toISOString();
  
  const newHabit = {
    ...habit,
    userId,
    createdAt: now,
    updatedAt: now
  };

  try {
    const docRef = await addDoc(habitsRef, newHabit);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
};

// Update a Habit
export const updateHabit = async (habitId: string, habitUpdate: Partial<Habit>) => {
  const path = `habits/${habitId}`;
  const habitDocRef = doc(db, 'habits', habitId);
  const updatePayload = {
    ...habitUpdate,
    updatedAt: new Date().toISOString()
  };

  try {
    await updateDoc(habitDocRef, updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
};

// Delete a Habit
export const deleteHabit = async (habitId: string) => {
  const path = `habits/${habitId}`;
  try {
    await deleteDoc(doc(db, 'habits', habitId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};

// Save a Habit Log (check-in)
export const saveHabitLog = async (
  userId: string,
  habitId: string,
  date: string,
  status: 'completed' | 'skipped' | 'missed' | 'rest' | 'recovery',
  note: string = '',
  value: number = 0,
  failureReason?: string
) => {
  const logId = `${userId}_${habitId}_${date}`;
  const path = `habitLogs/${logId}`;
  const logDocRef = doc(db, 'habitLogs', logId);
  
  const data: HabitLog = {
    id: logId,
    userId,
    habitId,
    date,
    status,
    note,
    value,
    createdAt: new Date().toISOString(),
    ...(failureReason ? { failureReason } : {})
  };

  try {
    await setDoc(logDocRef, data);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

// Delete a Habit Log
export const deleteHabitLog = async (userId: string, habitId: string, date: string) => {
  const logId = `${userId}_${habitId}_${date}`;
  const path = `habitLogs/${logId}`;
  try {
    await deleteDoc(doc(db, 'habitLogs', logId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};

// Clear Whole User Data (Tasks, Habits, Habit Logs, Settings)
export const clearWholeUserData = async (userId: string) => {
  const collectionsToClear = ['tasks', 'habits', 'habitLogs'];
  
  try {
    // Delete settings doc
    try {
      await deleteDoc(doc(db, 'settings', userId));
    } catch (e) {
      console.warn("Failed to delete settings doc during whole data clear:", e);
    }

    // Delete documents in collections
    for (const colName of collectionsToClear) {
      const colRef = collection(db, colName);
      const q = query(colRef, where('userId', '==', userId));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const batch = writeBatch(db);
        querySnapshot.forEach((docSnap) => {
          batch.delete(docSnap.ref);
        });
        await batch.commit();
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `all_collections_for_${userId}`);
  }
};

