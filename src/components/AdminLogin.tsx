import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, User, Lock, Eye, EyeOff, LayoutDashboard } from 'lucide-react';
import { adminLogin } from '../utils/api';
import { replaceHistoryEntry } from '../utils/adminAuth';

type View = 'home' | 'booking' | 'machines' | 'admin' | 'receipt' | 'track' | 'admin-login';

interface AdminLoginProps {
  setView: (v: View) => void;
}

const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;

const AdminLogin = ({ setView }: AdminLoginProps) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (username.trim().length < MIN_USERNAME_LENGTH) {
      setError(`Username must be at least ${MIN_USERNAME_LENGTH} characters`);
      return;
    }
    if (username.trim().length > MAX_USERNAME_LENGTH) {
      setError(`Username must be no more than ${MAX_USERNAME_LENGTH} characters`);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setLoading(true);

    try {
      const data = await adminLogin(username, password);
      const token = data.token;
      if (token) {
        // The session is carried by the httpOnly cookie set by the server.
        // Do not persist the JWT in browser storage.
        // Replace the login entry so the Back button can never return to the
        // login form.
        replaceHistoryEntry('#admin');
        setView('admin');
      } else {
        setError('Invalid username or password');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white p-10 rounded-[40px] shadow-2xl border-8 border-zinc-50"
      >
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="bg-blue-500 rounded-2xl p-3">
            <LayoutDashboard className="w-6 h-6 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-black text-zinc-900">ADMIN LOGIN</h1>
        </div>
        <p className="text-center text-zinc-400 text-sm mb-8">Sign in to access the dashboard</p>

        {error && (
          <div className="mb-4 p-3 bg-rose-50 text-rose-600 rounded-2xl text-sm font-bold text-center" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5" noValidate>
          <div>
            <label htmlFor="username" className="block uppercase tracking-widest font-black text-xs text-zinc-400 mb-2">
              Username
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 w-5 h-5" aria-hidden="true" />
              <input
                type="text"
                id="username"
                name="username"
                className="w-full pl-12 pr-4 py-4 bg-zinc-50 border-4 border-transparent rounded-3xl outline-none transition-all font-semibold text-base focus:bg-white focus:border-blue-500"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    passwordInputRef.current?.focus();
                  }
                }}
                disabled={loading}
                minLength={MIN_USERNAME_LENGTH}
                maxLength={MAX_USERNAME_LENGTH}
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block uppercase tracking-widest font-black text-xs text-zinc-400 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 w-5 h-5" aria-hidden="true" />
              <input
                ref={passwordInputRef}
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                className="w-full pl-12 pr-12 py-4 bg-zinc-50 border-4 border-transparent rounded-3xl outline-none transition-all font-semibold text-base focus:bg-white focus:border-blue-500"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                minLength={MIN_PASSWORD_LENGTH}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors p-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={0}
              >
                {showPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-zinc-900 text-white rounded-3xl font-black text-base hover:bg-blue-600 shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Submit admin login"
            aria-busy={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" aria-hidden="true" />
                Signing in...
              </>
            ) : (
              'Login'
            )}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setView('home')}
          className="w-full mt-6 py-3 text-zinc-400 font-semibold hover:text-zinc-700 transition-colors text-sm text-center"
        >
          ← Back to Home
        </button>
      </motion.div>
    </div>
  );
};

export default AdminLogin;
