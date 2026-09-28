import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RoleNavigation from '@/app/components/RoleNavigation';
import * as storeModule from '@/lib/store';
import { ROLE_SIDEBAR_NAV, SIDEBAR_LAYOUT } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { UserRole } from '@/lib/types';

jest.mock('@/lib/store');

// The rail derives its active module from the URL, so the pathname hook is the
// value under test rather than an activeScreen prop.
let mockPathname = '/buyer/dashboard';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

const NAV = UI_STRINGS.navigation;

describe('RoleNavigation Sidebar Dashboard', () => {
  const mockOnLogout = jest.fn();

  const mockStore = (overrides: Record<string, unknown> = {}) => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'buyer',
      activeBuyerAccount: null,
      vendorSubscription: 'premium',
      ...overrides,
    });
  };

  beforeEach(() => {
    mockPathname = '/buyer/dashboard';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders null when the session is not authenticated', () => {
    mockStore({ isLoggedIn: false });

    const { container } = render(<RoleNavigation onLogout={mockOnLogout} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders a flush full-height rail with grouped modules and no workspace header card', () => {
    mockStore();

    render(<RoleNavigation onLogout={mockOnLogout} />);

    const rail = screen.getByRole('complementary', { name: NAV.navLandmarkLabel });
    expect(rail.className).toContain(SIDEBAR_LAYOUT.STICKY_OFFSET_CLASS);
    expect(rail.className).toContain(SIDEBAR_LAYOUT.HEIGHT_CLASS);
    expect(rail.className).toContain(SIDEBAR_LAYOUT.WIDTH_CLASS);
    // Flush edges: no rounded card shell or outer gutters
    expect(rail.className).not.toContain('rounded');
    expect(rail.className).not.toContain('lg:top-[88px]');

    // Collapse / expand affordances are removed
    expect(screen.queryByRole('button', { name: /Collapse|Expand/i })).not.toBeInTheDocument();

    expect(screen.getByText(NAV.groups.buyerSourcing)).toBeInTheDocument();
    expect(screen.getByText(NAV.groups.buyerEvaluation)).toBeInTheDocument();
    expect(screen.getByText(NAV.groups.buyerAccount)).toBeInTheDocument();
    expect(
      screen.getByText(formatString(NAV.modulesCountTemplate, { count: ROLE_SIDEBAR_NAV.buyer.length }))
    ).toBeInTheDocument();

    // Active module is derived from the pathname and flagged for assistive tech
    expect(screen.getByRole('link', { name: /Screen 1\.1/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Screen 1\.2/ })).not.toHaveAttribute('aria-current');
  });

  it('falls back to the buyer module rail when no role is resolved', () => {
    mockStore({ currentRole: undefined });

    render(<RoleNavigation />);

    expect(screen.getByRole('link', { name: /Screen 1\.1/ })).toBeInTheDocument();
    // Sign Out is omitted when no logout handler is supplied
    expect(screen.queryByRole('button', { name: NAV.signOut })).not.toBeInTheDocument();
  });

  it.each<[UserRole]>([['buyer'], ['category_manager'], ['vendor'], ['admin']])(
    'links every %s module to its own route and marks the current one active',
    (role) => {
      const items = ROLE_SIDEBAR_NAV[role];

      // Cover the active visual state for each module of the role
      items.forEach((item) => {
        mockPathname = item.route;
        mockStore({ currentRole: role });
        const { unmount } = render(<RoleNavigation onLogout={mockOnLogout} />);
        const accessibleName = item.screenTag ? `${item.screenTag}: ${item.label}` : item.label;
        expect(screen.getByRole('link', { name: accessibleName })).toHaveAttribute(
          'aria-current',
          'page'
        );
        unmount();
      });

      // With an unrelated pathname nothing is active, and every module still
      // renders with a correct href.
      mockPathname = '/unmatched-route';
      mockStore({ currentRole: role });
      render(<RoleNavigation onLogout={mockOnLogout} />);

      items.forEach((item) => {
        const accessibleName = item.screenTag ? `${item.screenTag}: ${item.label}` : item.label;
        const link = screen.getByRole('link', { name: accessibleName });
        expect(link).toHaveAttribute('href', item.route);
        expect(link).not.toHaveAttribute('aria-current');
        expect(screen.getByText(item.label)).toBeInTheDocument();
        expect(link).toHaveAttribute('title', item.description);
      });
    }
  );

  it('opens the mobile drawer and closes it via the overlay, close button and navigation', () => {
    mockStore();

    render(<RoleNavigation onLogout={mockOnLogout} />);

    const openBtn = screen.getByRole('button', { name: NAV.openMenu });
    expect(openBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: NAV.dismissOverlay })).not.toBeInTheDocument();

    // Open -> dismiss via backdrop overlay
    fireEvent.click(openBtn);
    expect(screen.getByRole('button', { name: NAV.openMenu })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: NAV.dismissOverlay }));
    expect(screen.queryByRole('button', { name: NAV.dismissOverlay })).not.toBeInTheDocument();

    // Open -> dismiss via explicit close control
    fireEvent.click(screen.getByRole('button', { name: NAV.openMenu }));
    fireEvent.click(screen.getByRole('button', { name: NAV.closeMenu }));
    expect(screen.getByRole('button', { name: NAV.openMenu })).toHaveAttribute('aria-expanded', 'false');

    // Open -> auto-dismiss after selecting a module
    fireEvent.click(screen.getByRole('button', { name: NAV.openMenu }));
    fireEvent.click(screen.getByRole('link', { name: /Screen 1\.4/ }));
    expect(screen.getByRole('button', { name: NAV.openMenu })).toHaveAttribute('aria-expanded', 'false');
  });

  it('invokes the logout handler from the rail footer', () => {
    mockPathname = '/admin/infra-control';
    mockStore({ currentRole: 'admin' });

    render(<RoleNavigation onLogout={mockOnLogout} />);

    fireEvent.click(screen.getByRole('button', { name: NAV.signOut }));
    expect(mockOnLogout).toHaveBeenCalledTimes(1);

    // The other admin module points at its own route
    expect(screen.getByRole('link', { name: /Screen 4\.2/ })).toHaveAttribute(
      'href',
      '/admin/audit-log'
    );
  });
});
