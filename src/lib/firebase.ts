import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Standardize Google Auth Custom Parameters
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Use standard Firestore with ignoreUndefinedProperties to prevent iframe/sandboxing locks and handle undefined fields gracefully
const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true
}, (firebaseConfig as any).firestoreDatabaseId || '(default)');

export { auth, db, googleProvider };
export default app;
