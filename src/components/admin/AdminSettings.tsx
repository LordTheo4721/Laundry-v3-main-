import React, { useState, useEffect } from 'react';
import { 
  User, 
  Lock, 
  Eye, 
  EyeOff, 
  Save, 
  Loader2, 
  AlertCircle, 
  CheckCircle,
  Shield,
  ArrowLeft,
  ArrowRight
} from 'lucide-react';
import { getAuthFetchOptions } from '../../utils/api';
import { exitAdminPortal } from '../../utils/adminAuth';
import AdminNavbar from './AdminNavbar';
import type { AdminProfile } from '../../types';

const API_BASE = '/api';

type View = 'home' | 'booking' | 'machines' | 'admin' | 'receipt' | 'track' | 'reviews' | 'admin-login' | 'admin-settings';

interface AdminSettingsProps {
  setView: (v: View) => void;
  /** Optional externally supplied profile. When omitted the profile is fetched. */
  user?: AdminProfile | null;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ setView, user }) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'security'>('profile');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Profile form state
  const [username, setUsername] = useState('');
  const [currentPasswordForUsername, setCurrentPasswordForUsername] = useState('');
  // The signed-in admin profile (username, role, last login) for the session card
  const [profile, setProfile] = useState<AdminProfile | null>(user ?? null);
  
  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Error/Success states
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordStrength, setPasswordStrength] = useState<{ score: number; feedback: string[] }>({ score: 0, feedback: [] });

  // Fetch user profile on mount
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/profile`, {
          ...getAuthFetchOptions(),
        });
        const json = await res.json();
        if (json.success && json.data) {
          setUsername(json.data.username);
          // Keep the whole profile so the "Current Session" card shows the real
          // username, role and last login instead of "N/A".
          setProfile(json.data as AdminProfile);
        }
      } catch (error) {
        console.error('Failed to fetch profile:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  // Calculate password strength
  useEffect(() => {
    if (!newPassword) {
      setPasswordStrength({ score: 0, feedback: [] });
      return;
    }
    
    const feedback: string[] = [];
    let score = 0;
    
    if (newPassword.length >= 8) score += 1;
    else feedback.push('At least 8 characters');
    
    if (/[A-Z]/.test(newPassword)) score += 1;
    else feedback.push('One uppercase letter');
    
    if (/[a-z]/.test(newPassword)) score += 1;
    else feedback.push('One lowercase letter');
    
    if (/[0-9]/.test(newPassword)) score += 1;
    else feedback.push('One number');
    
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) score += 1;
    else feedback.push('One special character');
    
    setPasswordStrength({ score, feedback });
  }, [newPassword]);

  const handleUpdateUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setProfileError('');
    setProfileSuccess('');
    
    try {
      const res = await fetch(`${API_BASE}/admin/profile`, {
        method: 'PATCH',
        ...getAuthFetchOptions(),
        body: JSON.stringify({
          username,
          currentPassword: currentPasswordForUsername,
        }),
      });
      
      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update username');
      }
      
      setProfileSuccess('Username updated successfully');
      setCurrentPasswordForUsername('');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Failed to update username');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setPasswordError('');
    setPasswordSuccess('');
    
    // Validate password strength
     const strength = passwordStrength;
     if (strength.score < 3) {
       setPasswordError('Password does not meet strength requirements');
       setSaving(false);
       return;
     }
    
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      setSaving(false);
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/admin/change-password`, {
        method: 'PATCH',
        ...getAuthFetchOptions(),
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      
      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error || 'Failed to change password');
      }
      
      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStrength({ score: 0, feedback: [] });
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  const getStrengthColor = (score: number) => {
    if (score <= 1) return 'bg-rose-500';
    if (score <= 2) return 'bg-amber-500';
    if (score <= 3) return 'bg-yellow-500';
    if (score <= 4) return 'bg-lime-500';
    return 'bg-emerald-500';
  };

  const getStrengthLabel = (score: number) => {
    if (score <= 1) return 'Very Weak';
    if (score <= 2) return 'Weak';
    if (score <= 3) return 'Fair';
    if (score <= 4) return 'Good';
    return 'Strong';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <AdminNavbar setView={setView} />
        <div className="flex items-center justify-center h-64 pt-20">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" role="region" aria-label="Admin settings">
      <AdminNavbar setView={setView} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <button
            onClick={() => setView('admin')}
            aria-label="Back to dashboard"
            className="text-xs font-black text-zinc-400 uppercase tracking-widest hover:text-blue-500 mb-2 flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" aria-hidden="true" /> Back to Dashboard
          </button>
          <h2 className="text-3xl font-extrabold text-zinc-900 tracking-tighter flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-600" aria-hidden="true" /> Admin Settings
          </h2>
          <p className="text-zinc-500 font-medium">Manage your admin account settings</p>
        </div>
        <button
          onClick={async () => {
            if (window.confirm('Are you sure you want to exit the Admin Dashboard?')) {
              // Ends the session, wipes the admin state and replaces the current
              // history entry so Back cannot return to an admin page.
              await exitAdminPortal(() => setView('home'));
            }
          }}
          className="self-start md:self-auto text-xs font-black text-zinc-400 uppercase tracking-widest hover:text-zinc-900 transition-colors flex items-center gap-1"
        >
          <ArrowRight className="w-3 h-3 rotate-180" aria-hidden="true" /> Exit Admin
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 bg-zinc-100 p-1 rounded-2xl" role="tablist" aria-label="Settings tabs">
        <button
          role="tab"
          aria-selected={activeTab === 'profile'}
          aria-controls="profile-panel"
          id="profile-tab"
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
            activeTab === 'profile'
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <User className="w-4 h-4" aria-hidden="true" /> Profile
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'security'}
          aria-controls="security-panel"
          id="security-tab"
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
            activeTab === 'security'
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <Lock className="w-4 h-4" aria-hidden="true" /> Security
        </button>
      </div>

      {/* Profile Tab */}
      <div role="tabpanel" id="profile-panel" aria-labelledby="profile-tab" hidden={activeTab !== 'profile'}>
        <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
          <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600" aria-hidden="true" /> Profile Information
          </h3>
          
          <form onSubmit={handleUpdateUsername} className="space-y-6 max-w-md">
            <div className="space-y-3">
              <label htmlFor="username" className="text-xs font-black text-zinc-400 uppercase tracking-widest block">
                Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full p-5 bg-zinc-50 border-4 border-zinc-100 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-base"
                placeholder="Enter username"
                aria-describedby="username-hint"
                disabled={saving}
              />
              <p id="username-hint" className="text-xs text-zinc-400">Username can only contain letters, numbers, and underscores (3-50 characters)</p>
            </div>

            <div className="space-y-3">
              <label htmlFor="currentPasswordForUsername" className="text-xs font-black text-zinc-400 uppercase tracking-widest block">
                Current Password (required to confirm changes)
              </label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  id="currentPasswordForUsername"
                  value={currentPasswordForUsername}
                  onChange={(e) => setCurrentPasswordForUsername(e.target.value)}
                  className="w-full p-5 bg-zinc-50 border-4 border-zinc-100 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-base pr-12"
                  placeholder="Enter current password"
                  aria-describedby="current-password-hint"
                  disabled={saving}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                  aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showCurrentPassword}
                >
                  {showCurrentPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {profileError && (
              <div className="p-4 bg-rose-50 text-rose-600 rounded-2xl font-bold text-sm text-center flex items-center gap-2" role="alert">
                <AlertCircle className="w-4 h-4" aria-hidden="true" />
                {profileError}
              </div>
            )}

            {profileSuccess && (
              <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl font-bold text-sm text-center flex items-center gap-2" role="status">
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                {profileSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={saving || !username || !currentPasswordForUsername}
              className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl flex items-center justify-center gap-2 disabled:bg-blue-300 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" /> : <Save className="w-5 h-5" aria-hidden="true" />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>
      </div>

      {/* Security Tab */}
      <div role="tabpanel" id="security-panel" aria-labelledby="security-tab" hidden={activeTab !== 'security'}>
        <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
          <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
            <Lock className="w-5 h-5 text-rose-600" aria-hidden="true" /> Change Password
          </h3>
          
          <form onSubmit={handleChangePassword} className="space-y-6 max-w-md">
            <div className="space-y-3">
              <label htmlFor="currentPassword" className="text-xs font-black text-zinc-400 uppercase tracking-widest block">
                Current Password
              </label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  id="currentPassword"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full p-5 bg-zinc-50 border-4 border-zinc-100 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-base pr-12"
                  placeholder="Enter current password"
                  disabled={saving}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                  aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showCurrentPassword}
                >
                  {showCurrentPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label htmlFor="newPassword" className="text-xs font-black text-zinc-400 uppercase tracking-widest block">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  id="newPassword"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-5 bg-zinc-50 border-4 border-zinc-100 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-base pr-12"
                  placeholder="Enter new password"
                  disabled={saving}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showNewPassword}
                >
                  {showNewPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
                </button>
              </div>
              
              {/* Password Strength Meter */}
              {newPassword && (
                <div className="space-y-2" role="group" aria-label="Password strength">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-500">Password Strength</span>
                    <span className="text-xs font-bold" style={{ color: getStrengthColor(passwordStrength.score) }}>
                      {getStrengthLabel(passwordStrength.score)}
                    </span>
                  </div>
                  <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300 rounded-full"
                      style={{
                        width: `${(passwordStrength.score / 5) * 100}%`,
                        backgroundColor: getStrengthColor(passwordStrength.score),
                      }}
                    />
                  </div>
                  <ul className="text-[10px] text-zinc-400 space-y-1" aria-label="Password requirements">
                    <li className={`flex items-center gap-1 ${passwordStrength.feedback.includes('At least 8 characters') ? 'text-rose-500' : 'text-emerald-500'}`}>
                      <span className="w-3 h-3 rounded-full border border-current" style={{ backgroundColor: passwordStrength.feedback.includes('At least 8 characters') ? 'transparent' : 'currentColor' }} aria-hidden="true" />
                      At least 8 characters
                    </li>
                    <li className={`flex items-center gap-1 ${passwordStrength.feedback.includes('One uppercase letter') ? 'text-rose-500' : 'text-emerald-500'}`}>
                      <span className="w-3 h-3 rounded-full border border-current" style={{ backgroundColor: passwordStrength.feedback.includes('One uppercase letter') ? 'transparent' : 'currentColor' }} aria-hidden="true" />
                      One uppercase letter
                    </li>
                    <li className={`flex items-center gap-1 ${passwordStrength.feedback.includes('One lowercase letter') ? 'text-rose-500' : 'text-emerald-500'}`}>
                      <span className="w-3 h-3 rounded-full border border-current" style={{ backgroundColor: passwordStrength.feedback.includes('One lowercase letter') ? 'transparent' : 'currentColor' }} aria-hidden="true" />
                      One lowercase letter
                    </li>
                    <li className={`flex items-center gap-1 ${passwordStrength.feedback.includes('One number') ? 'text-rose-500' : 'text-emerald-500'}`}>
                      <span className="w-3 h-3 rounded-full border border-current" style={{ backgroundColor: passwordStrength.feedback.includes('One number') ? 'transparent' : 'currentColor' }} aria-hidden="true" />
                      One number
                    </li>
                    <li className={`flex items-center gap-1 ${passwordStrength.feedback.includes('One special character') ? 'text-rose-500' : 'text-emerald-500'}`}>
                      <span className="w-3 h-3 rounded-full border border-current" style={{ backgroundColor: passwordStrength.feedback.includes('One special character') ? 'transparent' : 'currentColor' }} aria-hidden="true" />
                      One special character (!@#$%^&*...)
                    </li>
                  </ul>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label htmlFor="confirmPassword" className="text-xs font-black text-zinc-400 uppercase tracking-widest block">
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full p-5 bg-zinc-50 border-4 border-zinc-100 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-base pr-12"
                  placeholder="Confirm new password"
                  disabled={saving}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showConfirmPassword}
                >
                  {showConfirmPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
                </button>
              </div>
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-rose-500 font-medium">Passwords do not match</p>
              )}
            </div>

            {passwordError && (
              <div className="p-4 bg-rose-50 text-rose-600 rounded-2xl font-bold text-sm text-center flex items-center gap-2" role="alert">
                <AlertCircle className="w-4 h-4" aria-hidden="true" />
                {passwordError}
              </div>
            )}

            {passwordSuccess && (
              <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl font-bold text-sm text-center flex items-center gap-2" role="status">
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                {passwordSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={saving || !currentPassword || !newPassword || !confirmPassword || passwordStrength.score < 3 || newPassword !== confirmPassword}
              className="w-full py-5 bg-rose-600 text-white rounded-2xl font-black text-lg hover:bg-rose-700 transition-all shadow-xl flex items-center justify-center gap-2 disabled:bg-rose-300 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" /> : <Save className="w-5 h-5" aria-hidden="true" />}
              {saving ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* Current Session Info */}
        <div className="mt-6 bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
          <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-600" aria-hidden="true" /> Current Session
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Username</p>
              <p className="font-bold text-zinc-900">{profile?.username || 'N/A'}</p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Role</p>
              <p className="font-bold text-zinc-900 capitalize">{profile?.role || 'N/A'}</p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Last Login</p>
              <p className="font-bold text-zinc-900">{profile?.last_login ? new Date(profile.last_login).toLocaleString() : 'Never'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;