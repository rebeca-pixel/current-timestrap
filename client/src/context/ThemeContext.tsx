import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface ThemeContextType {
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'timestrap-theme-preference';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load theme preference from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    
    if (savedTheme) {
      const prefersDark = savedTheme === 'dark';
      setIsDark(prefersDark);
      applyTheme(prefersDark);
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDark(prefersDark);
      applyTheme(prefersDark);
      localStorage.setItem(THEME_STORAGE_KEY, prefersDark ? 'dark' : 'light');
    }
    
    setIsLoaded(true);
  }, []);

  const applyTheme = (dark: boolean) => {
    if (dark) {
      document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
      const style = document.getElementById('theme-inversion');
      if (!style) {
        const newStyle = document.createElement('style');
        newStyle.id = 'theme-inversion';
        newStyle.innerHTML = 'img, video { filter: invert(1) hue-rotate(180deg); }';
        document.head.appendChild(newStyle);
      }
    } else {
      document.documentElement.style.filter = '';
      const style = document.getElementById('theme-inversion');
      if (style) {
        style.remove();
      }
    }
  };

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    applyTheme(newIsDark);
    localStorage.setItem(THEME_STORAGE_KEY, newIsDark ? 'dark' : 'light');
  };

  if (!isLoaded) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
