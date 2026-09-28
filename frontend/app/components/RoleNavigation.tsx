'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/store';
import { ROLE_SIDEBAR_NAV, ROLE_WORKSPACE_META, SIDEBAR_LAYOUT } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type {
  RoleNavigationProps,
  SidebarIconKey,
  SidebarNavItem,
  UserRole,
} from '@/lib/types';
import {
  Building2,
  SlidersHorizontal,
  Truck,
  Cpu,
  Layers,
  Sparkles,
  Kanban,
  TrendingUp,
  FileSpreadsheet,
  FileCheck,
  ShieldCheck,
  Server,
  Award,
  ClipboardList,
  Database,
  Receipt,
  Menu,
  X,
  LogOut,
  type LucideIcon,
} from 'lucide-react';

/** Icon registry resolving pure-data icon keys from constants to components. */
const SIDEBAR_ICONS: Record<SidebarIconKey, LucideIcon> = {
  Building2,
  SlidersHorizontal,
  Truck,
  Cpu,
  Layers,
  Sparkles,
  Kanban,
  TrendingUp,
  FileSpreadsheet,
  FileCheck,
  ShieldCheck,
  Server,
  Award,
  ClipboardList,
  Database,
  Receipt,
};

const NAV = UI_STRINGS.navigation;

interface NavGroup {
  group: string;
  items: SidebarNavItem[];
}

/**
 * Role Workspace Sidebar Navigation
 * Flush, full-height module rail listing every screen available to the active
 * role. Pinned directly under the application header with no top, left, or
 * bottom gutters, and collapses to an off-canvas drawer on small screens.
 */
export default function RoleNavigation({ onLogout }: RoleNavigationProps) {
  const { currentRole, isLoggedIn } = useApp();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const role: UserRole = currentRole ?? 'buyer';
  const workspace = ROLE_WORKSPACE_META[role];
  const navItems = ROLE_SIDEBAR_NAV[role];

  const navGroups = useMemo<NavGroup[]>(
    () =>
      navItems.reduce<NavGroup[]>((groups, item) => {
        const bucket = groups.find((entry) => entry.group === item.group);
        if (bucket) {
          bucket.items.push(item);
          return groups;
        }
        return [...groups, { group: item.group, items: [item] }];
      }, []),
    [navItems]
  );

  if (!isLoggedIn) {
    return null;
  }

  return (
    <>
      {/* ── Mobile Drawer Trigger (hidden on large screens) ── */}
      <div className="lg:hidden w-full flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 dark:border-gray-800/90 bg-white dark:bg-[#0b0f19]">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={NAV.openMenu}
          aria-expanded={mobileOpen}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-bold text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800/60 transition-all"
        >
          <Menu size={15} className={workspace.accentText} />
          {NAV.sidebarHeading}
        </button>
      </div>

      {/* ── Off-canvas Backdrop (mobile only) ── */}
      {mobileOpen && (
        <button
          type="button"
          aria-label={NAV.dismissOverlay}
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm animate-fade-in"
        />
      )}

      {/* ── Flush Full-Height Module Rail ── */}
      <aside
        aria-label={NAV.navLandmarkLabel}
        className={`fixed lg:sticky top-0 ${SIDEBAR_LAYOUT.STICKY_OFFSET_CLASS} left-0 z-50 h-full ${
          SIDEBAR_LAYOUT.HEIGHT_CLASS
        } w-[262px] ${
          SIDEBAR_LAYOUT.WIDTH_CLASS
        } shrink-0 flex flex-col overflow-y-auto border-r border-slate-200 dark:border-gray-800/90 bg-white dark:bg-[#0b0f19] transition-transform duration-300 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        {/* Drawer dismiss control (small screens only) */}
        <div className="lg:hidden flex justify-end px-2 pt-2">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label={NAV.closeMenu}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800/80 transition-all"
          >
            <X size={15} />
          </button>
        </div>

        {/* Module Groups */}
        <nav className="flex-1 px-2 pb-2">
          {navGroups.map((group) => (
            <div key={group.group} className="space-y-0.5">
              <p className="px-2 pt-3 pb-1 text-[9px] font-black uppercase tracking-[0.08em] text-slate-400 dark:text-gray-500">
                {group.group}
              </p>

              {group.items.map((item) => {
                const ItemIcon = SIDEBAR_ICONS[item.icon];
                // The URL is the single source of truth for which module is
                // active, so deep links and browser back/forward stay in sync.
                const isActive = pathname === item.route;

                return (
                  <Link
                    key={item.id}
                    href={item.route}
                    onClick={() => setMobileOpen(false)}
                    aria-label={item.screenTag ? `${item.screenTag}: ${item.label}` : item.label}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.description}
                    className={`group w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all text-left ${
                      isActive
                        ? `${workspace.accentActive} border-transparent shadow-xs`
                        : `border-transparent text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/60 ${workspace.accentRing}`
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 border transition-all ${
                        isActive
                          ? 'bg-white/20 border-white/30 text-white'
                          : 'bg-slate-100 dark:bg-gray-800/70 border-slate-200 dark:border-gray-700/60'
                      }`}
                    >
                      <ItemIcon size={14} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="truncate text-[12px] font-semibold block">{item.label}</span>
                    </span>

                    {isActive && (
                      <span
                        aria-hidden="true"
                        title={NAV.activeModuleIndicator}
                        className="w-1.5 h-1.5 rounded-full bg-white shrink-0"
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Rail Footer: Module Counter & Session Exit */}
        <div className="mt-auto px-2 py-2 border-t border-slate-100 dark:border-gray-800/80 bg-white dark:bg-[#0b0f19] space-y-1.5">
          <p className="px-2 text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">
            {formatString(NAV.modulesCountTemplate, { count: navItems.length })}
          </p>

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              aria-label={NAV.signOut}
              title={NAV.signOutHint}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl font-bold text-[11.5px] text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all"
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/40 shrink-0">
                <LogOut size={14} />
              </span>
              {NAV.signOut}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
