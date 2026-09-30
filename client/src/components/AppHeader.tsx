import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar, Sun, Moon, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Menu } from 'lucide-react';
import { User, UserRole } from '@/context/AuthContext';
import logoImage from '@assets/WhatsApp_Image_2025-11-11_at_11.06.02_AM_1765464690595.jpeg';
import AlertsPopover from './AlertsPopover';

const THEME_STORAGE_KEY = 'timestrap_theme';

// Apply a stored theme preference to the document. Used at app boot and on
// every login/logout so the same theme sticks across sessions.
export const applyStoredTheme = () => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light') {
      document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
      document.documentElement.setAttribute('data-theme', 'light');
      if (!document.getElementById('theme-inversion')) {
        const style = document.createElement('style');
        style.id = 'theme-inversion';
        style.innerHTML = 'img:not(.auth-illustration-img), video { filter: invert(1) hue-rotate(180deg); }';
        document.head.appendChild(style);
      }
    } else {
      document.documentElement.style.filter = '';
      document.documentElement.removeAttribute('data-theme');
      const style = document.getElementById('theme-inversion');
      if (style) style.remove();
    }
  } catch {
    // ignore storage errors (e.g. SSR or private mode)
  }
};

// Run once on module load so the persisted theme is applied before the
// first paint (after a reload / fresh tab opening).
applyStoredTheme();


interface AppHeaderProps {
  user: User;
  onLogout: () => void;
  onMenuClick?: () => void;
  onToggleSidebar?: () => void;
  selectedDate?: Date;
  onDateChange?: (date: Date) => void;
  showDatePicker?: boolean;
}

const roleLabels: Record<UserRole, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr: 'HR',
  admin: 'Admin',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function AppHeader({
  user,
  onLogout,
  onMenuClick,
  onToggleSidebar,
  selectedDate = new Date(),
  onDateChange,
  showDatePicker = false
}: AppHeaderProps) {
  // Track theme so the icon reflects the actual state and we can save the
  // choice to localStorage. Initial value is read from storage (or 'dark'
  // by default) so the first render already matches what was last picked.
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem(THEME_STORAGE_KEY) as 'dark' | 'light') || 'dark';
    } catch {
      return 'dark';
    }
  });

  // Whenever the theme state changes, persist it AND reapply the visual
  // inversion. This is what guarantees the choice survives a logout/login.
  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
    applyStoredTheme();
    // Re-apply even when switching back to 'dark' because the helper also
    // clears any leftover inversion style.
    if (theme === 'dark') {
      document.documentElement.style.filter = '';
      const style = document.getElementById('theme-inversion');
      if (style) style.remove();
    }
  }, [theme]);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
  };

  const handleMenuClick = () => {
    if (onToggleSidebar) {
      onToggleSidebar();
    } else if (onMenuClick) {
      onMenuClick();
    }
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };


  return (
    <header className="h-16 bg-slate-900/80 backdrop-blur-xl border-b border-blue-500/20 px-4 md:px-6 flex items-center justify-between gap-4" data-testid="app-header">
      <div className="flex items-center gap-4">
        <Button
          size="icon"
          variant="ghost"
          onClick={handleMenuClick}
          className="text-blue-400"
          data-testid="button-menu"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {showDatePicker && (
        <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-800/50 rounded-lg border border-blue-500/20">
          <Calendar className="w-4 h-4 text-blue-400" />
          <span className="text-sm text-blue-100" data-testid="text-selected-date">
            {formatDate(selectedDate)}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* Alerts */}
        <AlertsPopover employeeId={user.id} />

        {/* Theme toggle */}
        <Button
          size="icon"
          variant="ghost"
          onClick={toggleTheme}
          className="text-slate-400 hover:text-white"
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          data-testid="button-toggle-theme"
        >
          {theme === 'dark' ? (
            <Sun className="w-5 h-5" />
          ) : (
            <Moon className="w-5 h-5" />
          )}
        </Button>

        {/* User avatar + dropdown menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="header-user-avatar-trigger"
              aria-label="User menu"
              data-testid="button-user-menu"
            >
              <div className="header-user-avatar-fallback">
                {getInitials(user.name)}
              </div>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-52">
            {/* Identity block */}
            <div className="header-user-menu-identity">
              <div className="header-user-menu-name" data-testid="text-user-name">{user.name}</div>
              <div className="header-user-menu-code" data-testid="text-user-code">{user.employeeCode}</div>
              <span className="header-user-menu-badge">{roleLabels[user.role]}</span>
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem disabled className="flex items-center justify-between text-slate-400 cursor-not-allowed">
              <span className="flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Settings
              </span>
              <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-medium">Soon</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={onLogout}
              className="header-user-menu-logout"
              data-testid="button-logout"
            >
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
