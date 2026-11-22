import { useState, FormEvent } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup,
  updateProfile
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, User, LogIn, ArrowRight, Sparkles, Check, AlertCircle } from 'lucide-react';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [iframeWarning, setIframeWarning] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        if (!displayName.trim()) {
          setError('Name is required');
          setLoading(false);
          return;
        }
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCred.user, { displayName });
      }
    } catch (err: any) {
      console.error(err);
      let msg = 'Authentication failed. Please try again.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        msg = 'Invalid email or password.';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = 'Email is already registered.';
      } else if (err.code === 'auth/weak-password') {
        msg = 'Password should be at least 6 characters.';
      } else if (err.code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    setIframeWarning(false);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Google Sign-In Error:', err);
      if (err.code === 'auth/unauthorized-domain') {
        setError(`This domain (${window.location.hostname}) is not authorized in your Firebase Project. Please add it to your Authorized Domains list in the Firebase Console.`);
      } else if (err.code === 'auth/popup-blocked' || err.code === 'auth/internal-error' || err.code === 'auth/network-request-failed') {
        setIframeWarning(true);
        setError('Google Sign-In popup was blocked or failed inside the iframe. Please try using Email/Password, or open this application in a new tab.');
      } else {
        setError(`Could not complete Google Sign-In (${err.message || err.code}). Please use Email/Password.`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md" id="auth-container">
        {/* Logo/Brand Header */}
        <div className="text-center mb-8" id="brand-header">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-olive text-white mb-4 shadow-sm"
          >
            <Sparkles className="w-6 h-6" />
          </motion.div>
          <motion.h1 
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl serif font-semibold tracking-tight text-nattext italic"
          >
            Crown Planner
          </motion.h1>
          <motion.p 
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-sm sans text-natmuted mt-2"
          >
            A calm, minimal space to shape your life's daily rhythm.
          </motion.p>
        </div>

        {/* Auth Card */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="bg-cardbg border border-natborder rounded-[32px] p-8 shadow-xs"
        >
          {/* Toggle Tabs */}
          <div className="flex border-b border-natborder pb-4 mb-6" id="auth-tabs">
            <button
              id="tab-login"
              onClick={() => { setIsLogin(true); setError(null); }}
              className={`flex-1 text-center py-2 text-sm font-semibold transition-colors ${
                isLogin 
                  ? 'text-olive border-b-2 border-olive' 
                  : 'text-natmuted hover:text-nattext'
              }`}
            >
              Log In
            </button>
            <button
              id="tab-signup"
              onClick={() => { setIsLogin(false); setError(null); }}
              className={`flex-1 text-center py-2 text-sm font-semibold transition-colors ${
                !isLogin 
                  ? 'text-olive border-b-2 border-olive' 
                  : 'text-natmuted hover:text-nattext'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" id="auth-form">
            <AnimatePresence mode="wait">
              {!isLogin && (
                <motion.div
                  key="signup-name"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-1.5 overflow-hidden"
                >
                  <label htmlFor="name-input" className="text-xs font-semibold uppercase tracking-wider text-natmuted">Your Name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-3.5 h-4 w-4 text-natmuted" />
                    <input
                      id="name-input"
                      type="text"
                      placeholder="Jane Doe"
                      required={!isLogin}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 text-sm bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-1.5">
              <label htmlFor="email-input" className="text-xs font-semibold uppercase tracking-wider text-natmuted">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3.5 h-4 w-4 text-natmuted" />
                <input
                  id="email-input"
                  type="email"
                  placeholder="name@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-sm bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password-input" className="text-xs font-semibold uppercase tracking-wider text-natmuted">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-natmuted" />
                <input
                  id="password-input"
                  type="password"
                  placeholder="••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-sm bg-paper border border-natborder rounded-xl focus:outline-none focus:ring-2 focus:ring-olive/20 focus:border-olive text-nattext transition-all"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3.5 rounded-xl bg-clay/10 border border-clay/20 text-clay text-xs" id="auth-error">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {iframeWarning && (
              <div className="p-3.5 rounded-xl bg-sand/40 border border-natborder text-nattext text-xs space-y-1" id="iframe-warning">
                <p className="font-semibold text-olive">Having issues with Google Login in the preview?</p>
                <p className="text-natmuted">Click the "Open in new tab" icon at the top right of the application preview, then retry Google Login, or register with Email and Password.</p>
              </div>
            )}

            <button
              id="btn-auth-submit"
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-olive hover:bg-olive/90 active:bg-olive disabled:opacity-50 text-white font-semibold text-sm py-3 px-4 rounded-xl shadow-md shadow-olive/10 transition-all cursor-pointer"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>{isLogin ? 'Log In' : 'Sign Up'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Separator */}
          <div className="relative my-6 flex items-center justify-center text-xs text-natmuted" id="auth-separator">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-natborder"></div></div>
            <span className="relative bg-cardbg px-3">or continue with</span>
          </div>

          {/* Google Login Button */}
          <button
            id="btn-google-signin"
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full min-h-[44px] flex items-center justify-center gap-3 border border-natborder hover:bg-paper active:bg-sand/30 text-nattext font-medium text-sm py-3 px-4 rounded-xl transition-all cursor-pointer"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#EA4335"
                d="M12 5.04c1.62 0 3.08.56 4.22 1.65l3.15-3.15C17.45 1.84 14.93 1 12 1 7.37 1 3.4 3.66 1.45 7.55l3.77 2.92C6.12 7.02 8.84 5.04 12 5.04z"
              />
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.43c-.28 1.47-1.11 2.71-2.36 3.55l3.66 2.84c2.14-1.98 3.39-4.88 3.39-8.54z"
              />
              <path
                fill="#FBBC05"
                d="M5.22 14.77c-.24-.71-.38-1.47-.38-2.27s.14-1.56.38-2.27L1.45 7.31C.53 9.16 0 11.23 0 13.43s.53 4.27 1.45 6.12l3.77-2.78z"
              />
              <path
                fill="#34A853"
                d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.66-2.84c-1.11.74-2.52 1.19-4.3 1.19-3.16 0-5.88-1.98-6.83-4.96L1.4 16.2c1.95 3.89 5.92 6.55 10.6 6.55z"
              />
            </svg>
            <span>Google Accounts</span>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
