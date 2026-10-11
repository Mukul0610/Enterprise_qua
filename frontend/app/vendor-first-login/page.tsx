'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import PasswordInput from '@/app/components/PasswordInput';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { PASSWORD_MIN_LENGTH, ROLE_LANDING_ROUTE } from '@/lib/constants';

export default function VendorFirstLoginPage() {
  const router = useRouter();
  const { currentUserSession, setCurrentUserSession, setIsLoggedIn, showToast } = useApp();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!currentUserSession) router.replace('/login');
    else if (currentUserSession.role !== 'vendor' || !currentUserSession.passwordChangeRequired) {
      router.replace(ROLE_LANDING_ROUTE.vendor);
    }
  }, [currentUserSession, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`Use a password with at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new password and confirmation do not match.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('Choose a new password that is different from your temporary password.');
      return;
    }

    setSaving(true);
    try {
      const result = await authClient.changePassword(currentPassword, newPassword);
      if (!result.success || !result.user || !result.token) {
        setError(result.error || 'The password could not be changed. Please try again.');
        return;
      }
      setCurrentUserSession(result.user);
      setIsLoggedIn(true);
      showToast('Password Updated', 'Your account is ready to use.', 'success');
      router.replace(ROLE_LANDING_ROUTE.vendor);
    } catch {
      setError('The password could not be changed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!currentUserSession || currentUserSession.role !== 'vendor' || !currentUserSession.passwordChangeRequired) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-slate-500">
        Please sign in to continue.
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-first-login-heading"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 px-4 py-8"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 sm:p-8 shadow-xl space-y-5"
      >
        <div className="space-y-2 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
            <ShieldCheck size={24} />
          </span>
          <h1 id="vendor-first-login-heading" className="text-xl font-bold text-slate-900 dark:text-white">Secure your vendor account</h1>
          <p className="text-sm text-slate-500 dark:text-gray-400">
            Set a new password before entering your vendor workspace.
          </p>
        </div>

        <div className="space-y-4">
          <PasswordInput
            id="temporary-password"
            label="Temporary password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            required
          />
          <PasswordInput
            id="new-password"
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
          <PasswordInput
            id="confirm-new-password"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </p>
        )}

        <button type="submit" disabled={saving} className="btn btn-primary w-full justify-center py-2.5 font-bold disabled:opacity-60">
          {saving ? 'Updating password…' : 'Change password and continue'}
        </button>
      </form>
    </div>
  );
}
