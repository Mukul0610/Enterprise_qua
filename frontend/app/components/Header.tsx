'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { ROLE_SIDEBAR_NAV, LOGIN_ROUTE } from '@/lib/constants';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import NotificationBell from '@/app/components/NotificationBell';
import AccountSecurityPanel from '@/app/components/AccountSecurityPanel';
import { deriveInitials, resolveSessionOrgName } from '@/lib/accountIdentity';
import type { UserRole } from '@/lib/types';
import {
  ShieldCheck,
  ChevronDown,
  Sun,
  Moon,
  LogOut,
  Key,
} from 'lucide-react';

/**
 * Presentation metadata per role. Deliberately contains no identity data: the
 * name, email and organisation shown in the profile dropdown come from the
 * signed-in session record, so nothing on screen is invented.
 */
interface RoleChrome {
  designation: string;
  authLabel: string;
  avatarGradient: string;
  badge: string;
  badgeClass: string;
}

const ROLE_CHROME: Record<UserRole, RoleChrome> = {
  buyer: {
    designation: 'Enterprise Buyer',
    authLabel: 'Verified against enterprise user directory',
    avatarGradient: 'from-indigo-600 to-indigo-800 text-white',
    badge: 'Buyer',
    badgeClass:
      'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
  },
  category_manager: {
    designation: 'Category Manager',
    authLabel: 'Verified against enterprise user directory',
    avatarGradient: 'from-sky-600 to-blue-700 text-white',
    badge: 'Category Desk',
    badgeClass:
      'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  },
  vendor: {
    designation: 'Vendor Partner',
    authLabel: 'Verified against enterprise user directory',
    avatarGradient: 'from-emerald-600 to-teal-700 text-white',
    badge: 'Vendor',
    badgeClass:
      'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  admin: {
    designation: 'Platform Administrator',
    authLabel: 'Verified against enterprise user directory',
    avatarGradient: 'from-purple-600 to-indigo-800 text-white',
    badge: 'Admin',
    badgeClass:
      'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800',
  },
};

/** Human label for the authentication method recorded on the session. */
function authMethodLabel(method?: string): string | null {
  if (method === 'PASSWORD') return 'Password verified';
  if (method === 'EMAIL_OTP') return 'Email OTP verified';
  return null;
}

export default function Header() {
  const {
    currentRole,
    setCurrentRole,
    isLoggedIn,
    setIsLoggedIn,
    theme,
    toggleTheme,
    showToast,
    addAuditLog,
    activeBuyerAccount,
    currentUserSession,
    setCurrentUserSession,
    remainingFreeRFQs,
    activeSubscription,
    vendorFreeCreditsRemaining,
    vendorSubscription,
  } = useApp();

  const router = useRouter();

  const [userProfileDropdownOpen, setUserProfileDropdownOpen] = useState(false);

  // Visibility of the Account & Security overlay. The forms inside it live in
  // AccountSecurityPanel, which owns its own field state.
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  // Everything shown about the user comes from the verified session record.
  const chrome = ROLE_CHROME[currentRole] || ROLE_CHROME.buyer;
  const sessionName = currentUserSession?.name?.trim() || '';
  const sessionEmail = currentUserSession?.email || '';
  const initials = deriveInitials(sessionName, sessionEmail);
  const authLabel = authMethodLabel(currentUserSession?.authMethod) || chrome.authLabel;
  const moduleCount = ROLE_SIDEBAR_NAV[currentRole]?.length ?? 0;

  // The organisation on the verified session record is authoritative; see
  // resolveSessionOrgName for why the active buyer account is only a conditional
  // fallback.
  const currentOrgName = resolveSessionOrgName(currentUserSession, activeBuyerAccount);

  const handleLogout = () => {
    setUserProfileDropdownOpen(false);
    addAuditLog('User logged out of session', undefined, sessionEmail || undefined);
    setIsLoggedIn(false);
    setCurrentUserSession(null);
    setCurrentRole('buyer');
    authClient.logout(sessionEmail || undefined).catch(() => {});
    showToast(UI_STRINGS.auth.loggedOutTitle, UI_STRINGS.auth.loggedOutMessage, 'info');
    router.replace(LOGIN_ROUTE);
  };

  if (!isLoggedIn) {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-[#0b0f19]/90 backdrop-blur-xl transition-colors">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
          {/* Brand & Logo */}
          <div className="flex items-center gap-3 py-1">
            <div className="bg-white dark:bg-white/95 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-gray-700 shadow-sm flex items-center gap-3">
              <img src="/procucev-logo.png" alt="Procucev Logo" className="h-10 sm:h-11 w-auto object-contain shrink-0" />
              <div className="h-7 w-[1px] bg-slate-200 shrink-0" />
              <img src="/qua-ai-logo.jpeg" alt="Qua AI Logo" className="h-10 sm:h-11 w-auto object-contain rounded shrink-0" />
            </div>
            <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 shrink-0 self-center">
              QUA AI 2.0
            </span>
          </div>

          {/* Minimal Login Header Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-gray-800 border border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-200 dark:hover:bg-gray-700 transition-all text-xs font-semibold shadow-sm"
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            >
              {theme === 'light' ? (
                <>
                  <Sun size={15} className="text-amber-500 fill-amber-500" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon size={15} className="text-indigo-400 fill-indigo-400" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>
            <a
              href="mailto:support@procucev.com"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-100 transition-all"
            >
              Need Support?
            </a>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0b0f19]/95 backdrop-blur-xl transition-colors">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand & Logo */}
        <div className="flex items-center gap-3 py-1">
          <div className="bg-white dark:bg-white/95 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-gray-700 shadow-sm flex items-center gap-3">
            <img src="/procucev-logo.png" alt="Procucev Logo" className="h-10 sm:h-11 w-auto object-contain shrink-0" />
            <div className="h-7 w-[1px] bg-slate-200 shrink-0" />
            <img src="/qua-ai-logo.jpeg" alt="Qua AI Logo" className="h-10 sm:h-11 w-auto object-contain rounded shrink-0" />
          </div>
          <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 shrink-0 self-center hidden sm:inline-block">
            QUA AI 2.0
          </span>
        </div>

        {/* The buyer/CM "Sourcing Mode" and vendor "Access Tier" quick-switchers
            that used to render here have been removed entirely, not just
            gated: sourcing mode is a per-RFQ decision made in the RFQ
            creation modal, and vendor tier changes go through the real,
            payment-gated vendor-subscription screen. A global, always-visible
            header toggle that could flip either independent of any specific
            RFQ or payment had no legitimate purpose once real per-mode
            entitlement existed — it was pure surface area for confusion/
            misuse, not a feature worth preserving. */}

        {/* Right Section: Buyer Credits / Active Plan, Theme Toggle, Notifications, and Sleek Corner User Profile Box */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Buyer Credits / Active Plan Display */}
          {currentRole === 'buyer' && (
            <>
              {(!activeSubscription || activeSubscription === 'free_trial') ? (
                <div
                  className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-xl bg-slate-50/80 dark:bg-gray-900/80 border border-slate-200 dark:border-gray-800 shadow-xs"
                  title={`Sourcing Credits: Total 5, Used ${Math.max(0, 5 - (remainingFreeRFQs ?? 5))}, Remaining ${remainingFreeRFQs ?? 5}`}
                >
                  <span className="text-[11px] font-bold text-slate-700 dark:text-gray-300">Sourcing Credits:</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                    Total: 5
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                    Used: {Math.max(0, 5 - (remainingFreeRFQs ?? 5))}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800">
                    Remaining: {remainingFreeRFQs ?? 5}
                  </span>
                </div>
              ) : (
                <div
                  className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 shadow-xs"
                  title={`Active Plan: ${activeSubscription === 'version_1' ? 'Version 1' : activeSubscription === 'version_2' ? 'Version 2' : activeSubscription === 'version_3' ? 'Version 3' : activeSubscription}`}
                >
                  <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">Active Plan:</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-600 text-white shadow-xs">
                    {activeSubscription === 'version_1' ? 'Version 1' : activeSubscription === 'version_2' ? 'Version 2' : activeSubscription === 'version_3' ? 'Version 3' : activeSubscription}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Vendor Free RFQ Download Credits Display */}
          {currentRole === 'vendor' && (
            <div
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-xl border shadow-xs transition-colors ${
                (vendorFreeCreditsRemaining ?? 5) > 0
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                  : 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800'
              }`}
              title={`Free RFQ Credits: ${vendorFreeCreditsRemaining ?? 5} remaining out of 5 allocated`}
            >
              <span
                className={`text-[11px] font-bold ${
                  (vendorFreeCreditsRemaining ?? 5) > 0
                    ? 'text-emerald-800 dark:text-emerald-300'
                    : 'text-rose-800 dark:text-rose-300'
                }`}
              >
                Free RFQ Credits:
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                  (vendorFreeCreditsRemaining ?? 5) > 0
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {vendorFreeCreditsRemaining ?? 5}
              </span>
            </div>
          )}

          {/* Theme Toggle (Light / Dark) */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-gray-800 border border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-200 dark:hover:bg-gray-700 transition-all text-xs font-semibold shadow-sm"
            title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
          >
            {theme === 'light' ? (
              <>
                <Sun size={15} className="text-amber-500 fill-amber-500" />
                <span className="hidden sm:inline">Light</span>
              </>
            ) : (
              <>
                <Moon size={15} className="text-indigo-400 fill-indigo-400" />
                <span className="hidden sm:inline">Dark</span>
              </>
            )}
          </button>

          {/* Notifications — real per-recipient inbox for vendor/buyer, AI chaser feed for CM/admin */}
          <NotificationBell />

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SLEEK CORNER USER PROFILE BOX & PERSONA SWITCHER */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="relative pl-1 border-l border-slate-200 dark:border-gray-800">
            <button
              onClick={() => setUserProfileDropdownOpen(!userProfileDropdownOpen)}
              className="flex items-center gap-2.5 p-1.5 pr-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-gray-800/80 transition-all border border-slate-200/80 dark:border-gray-700/60 bg-slate-50/50 dark:bg-gray-900/50 shadow-xs text-left group"
              title="Signed-in account details"
            >
              {/* Dynamic Avatar with Active Indicator */}
              <div
                className={`w-9 h-9 rounded-xl bg-gradient-to-br ${chrome.avatarGradient} flex items-center justify-center text-xs font-black shadow-sm shrink-0 relative`}
              >
                {initials}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-gray-900" />
              </div>

              {/* User Identity Details */}
              <div className="hidden lg:block text-left max-w-[150px]">
                <p className="text-xs font-black text-slate-900 dark:text-white leading-tight truncate">
                  {sessionName || sessionEmail}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-gray-400 truncate leading-tight mt-0.5 font-medium">
                  {currentOrgName}
                </p>
              </div>

              <ChevronDown
                size={14}
                className={`text-slate-400 group-hover:text-slate-600 dark:group-hover:text-gray-200 transition-transform ${
                  userProfileDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Corner Box Popover: User Details & Role Persona Switcher */}
            {userProfileDropdownOpen && (
              <div className="absolute top-full mt-2 w-84 sm:w-96 right-0 bg-white dark:bg-gray-900 border-2 border-slate-200 dark:border-gray-700 rounded-3xl shadow-2xl p-4 z-50 backdrop-blur-2xl animate-scale-up space-y-4">
                {/* Active Persona Header Card */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50/50 dark:from-gray-800/80 dark:to-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${chrome.avatarGradient} flex items-center justify-center text-sm font-black shadow-md shrink-0`}
                      >
                        {initials}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-xs font-black text-slate-900 dark:text-white">
                            {sessionName || sessionEmail}
                          </h4>
                          <span
                            className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${chrome.badgeClass}`}
                          >
                            {chrome.badge}
                          </span>
                        </div>
                        <p className="text-[11px] font-semibold text-slate-600 dark:text-gray-300 mt-0.5">
                          {chrome.designation}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Active Login Details & Organization Box */}
                  <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900/90 border border-slate-200/80 dark:border-gray-800 text-[11px] space-y-1.5">
                    <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-[10px]">
                      <span>Organization:</span>
                      <strong className="text-slate-900 dark:text-white">{currentOrgName}</strong>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-[10px]">
                      <span>User Name (Login ID):</span>
                      <strong className="mono font-bold text-indigo-600 dark:text-indigo-400">
                        {sessionEmail}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-[10px] pt-1 border-t border-slate-100 dark:border-gray-800/80">
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                        <ShieldCheck size={12} /> {authLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Workspace Summary (read-only, derived from the session) */}
                <div className="px-1 flex items-center justify-between text-[10px]">
                  <span className="font-black uppercase tracking-wider text-slate-400 dark:text-gray-500">
                    Active Workspace
                  </span>
                  <span className="font-mono text-slate-500 dark:text-gray-400">
                    {chrome.designation} · {moduleCount} modules
                  </span>
                </div>
                {/* Session Actions Footer */}
                <div className="pt-2 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between gap-2 text-xs">
                  {currentRole !== 'buyer' && (
                    <button
                      type="button"
                      onClick={() => {
                        setUserProfileDropdownOpen(false);
                        setAccountModalOpen(true);
                      }}
                      className="btn btn-ghost btn-xs font-bold text-slate-600 dark:text-gray-300 flex items-center gap-1"
                    >
                      <Key size={12} /> {UI_STRINGS.accountSecurity.menuLabel}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="btn btn-ghost btn-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1"
                  >
                    <LogOut size={12} /> Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Account Settings & Security Modal */}
      {accountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden space-y-0">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between bg-slate-50/50 dark:bg-gray-950/40">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${chrome.avatarGradient} flex items-center justify-center font-black text-sm`}
                >
                  {initials}
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    {UI_STRINGS.accountSecurity.panelTitle}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    {sessionEmail} • {currentOrgName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAccountModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 max-h-[75vh] overflow-y-auto">
              <AccountSecurityPanel />
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-950/40 flex items-center justify-end">
              <button
                onClick={() => setAccountModalOpen(false)}
                className="btn btn-secondary text-xs px-5 font-bold"
              >
                {UI_STRINGS.accountSecurity.closeAction}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
