'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { LOGIN_ROUTE, ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { UserRole } from '@/lib/types';
import RoleNavigation from '@/app/components/RoleNavigation';
import SupportChatWidget from '@/app/components/SupportChatWidget';
import InitialSetupModal from '@/app/buyer/initial-setup-modal';

interface WorkspaceShellProps {
  /** Role whose routes this shell wraps; used to keep the sidebar in sync. */
  role: UserRole;
  children: React.ReactNode;
}

/**
 * Authenticated workspace shell.
 *
 * Wraps every role-scoped route with the module sidebar and enforces two rules:
 *  - an unauthenticated visitor is sent to the sign-in screen
 *  - a visitor whose account role does not own this URL is sent to their own
 *    landing route, so URLs cannot be used to reach another role's workspace
 */
export default function WorkspaceShell({ role, children }: WorkspaceShellProps) {
  const router = useRouter();
  const {
    isLoggedIn,
    currentRole,
    currentUserSession,
    setCurrentRole,
    setIsLoggedIn,
    setCurrentUserSession,
    showToast,
  } = useApp();

  const mustChangeVendorPassword =
    role === 'vendor' && currentUserSession?.passwordChangeRequired === true;
  const sessionRole = currentRole;

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace(LOGIN_ROUTE);
      return;
    }
    if (mustChangeVendorPassword) {
      router.replace('/vendor-first-login');
      return;
    }
    // Keep the sidebar aligned with the section actually being viewed.
    if (sessionRole !== role) {
      router.replace(ROLE_LANDING_ROUTE[sessionRole] || ROLE_LANDING_ROUTE.buyer);
    }
  }, [isLoggedIn, sessionRole, role, router, mustChangeVendorPassword]);

  const handleLogout = () => {
    const email = undefined;
    setIsLoggedIn(false);
    setCurrentUserSession(null);
    setCurrentRole('buyer');
    authClient.logout(email).catch(() => {});
    showToast(UI_STRINGS.auth.loggedOutTitle, UI_STRINGS.auth.loggedOutMessage, 'info');
    router.replace(LOGIN_ROUTE);
  };

  // Avoid rendering another role's screens for the frame before the redirect.
  if (!isLoggedIn || sessionRole !== role || mustChangeVendorPassword) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-xs text-slate-500 dark:text-gray-400">{UI_STRINGS.auth.redirecting}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row items-stretch min-h-[calc(100vh-4rem)]">
      <RoleNavigation onLogout={handleLogout} />

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-2 sm:px-3 py-2 sm:py-2.5">{children}</div>
      </main>

      {role === 'buyer' && <InitialSetupModal />}
      <SupportChatWidget />
    </div>
  );
}
