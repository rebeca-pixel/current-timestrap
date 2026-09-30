import { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest } from '@/lib/queryClient';

export type UserRole = 'employee' | 'manager' | 'hr' | 'admin';

export interface User {
  id: string;
  employeeCode: string;
  name: string;
  role: UserRole;
  department?: string;
  groupName?: string;
  email?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (employeeCode: string, name: string, password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem('timestrap_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setIsLoading(false);
  }, []);

  const login = async (employeeCode: string, name: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    
    try {
      const response = await apiRequest('POST', '/api/auth/login', {
        employeeCode,
        password,
      });
      
      const data = await response.json();
      
      if (data.user) {
        const userData: User = {
          id: data.user.id,
          employeeCode: data.user.employeeCode,
          name: data.user.name,
          role: data.user.role as UserRole,
          department: data.user.department,
          groupName: data.user.groupName,
          email: data.user.email,
        };
        setUser(userData);
        localStorage.setItem('timestrap_user', JSON.stringify(userData));
        setIsLoading(false);
        return true;
      }
      
      setIsLoading(false);
      return false;
    } catch (error) {
      console.error('Login error:', error);
      setIsLoading(false);
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('timestrap_user');
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
