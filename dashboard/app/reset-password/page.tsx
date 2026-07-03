'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Lock, Loader2, Bot, CheckCircle2 } from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';

function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) setError('Missing reset token. Please request a new reset link.');
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        setDone(true);
        setTimeout(() => router.push('/dashboard'), 2500);
      } else {
        setError(data.error || 'Reset failed. The link may have expired.');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 font-sans"
      style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl shadow-xl overflow-hidden border"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-soft)' }}
      >
        <div
          className="p-8 flex flex-col items-center"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }}
        >
          <div className="bg-white/20 p-3 rounded-xl mb-4 backdrop-blur-sm">
            <Bot className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-display tracking-tight">Set a new password</h1>
        </div>

        <div className="p-8">
          {done ? (
            <div role="status" className="text-sm flex flex-col items-center text-center">
              <CheckCircle2 className="w-12 h-12 mb-4" style={{ color: 'var(--accent)' }} />
              <p className="mb-2">Your password has been reset.</p>
              <p style={{ color: 'var(--text-secondary)' }}>Redirecting to login...</p>
            </div>
          ) : (
            <>
              {error && (
                <div
                  role="alert"
                  className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 text-red-700 dark:text-red-400 text-sm rounded-r-md"
                >
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label
                    htmlFor="reset-new-password"
                    className="block text-xs font-bold uppercase tracking-wider mb-2 ml-1"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    New password
                  </label>
                  <div className="relative">
                    <Lock
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                    />
                    <input
                      id="reset-new-password"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 border rounded-xl focus:ring-2 outline-none transition-all text-sm"
                      style={
                        {
                          backgroundColor: 'var(--bg-raised)',
                          borderColor: 'var(--border-soft)',
                          color: 'var(--text-primary)',
                          '--tw-ring-color': 'var(--accent-glow)',
                        } as React.CSSProperties
                      }
                      placeholder="At least 6 characters"
                      autoComplete="new-password"
                      disabled={!token}
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="reset-confirm-password"
                    className="block text-xs font-bold uppercase tracking-wider mb-2 ml-1"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Confirm password
                  </label>
                  <div className="relative">
                    <Lock
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                    />
                    <input
                      id="reset-confirm-password"
                      type="password"
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 border rounded-xl focus:ring-2 outline-none transition-all text-sm"
                      style={
                        {
                          backgroundColor: 'var(--bg-raised)',
                          borderColor: 'var(--border-soft)',
                          color: 'var(--text-primary)',
                          '--tw-ring-color': 'var(--accent-glow)',
                        } as React.CSSProperties
                      }
                      placeholder="Re-enter password"
                      autoComplete="new-password"
                      disabled={!token}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading || !token}
                  className="w-full py-4 text-white rounded-xl font-bold text-sm shadow-lg hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  {loading ? (
                    <>
                      <Loader2 aria-hidden="true" className="w-5 h-5 mr-2 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    'Reset password'
                  )}
                </button>
                <div className="text-center">
                  <a
                    href="/dashboard"
                    className="text-xs hover:underline"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Back to login
                  </a>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: 'var(--bg-base)' }}
        >
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
