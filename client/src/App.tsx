import { useState, useEffect } from 'react';
import { Switch, Route, useLocation, Redirect } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import WelcomePage from '@/components/WelcomePage';
import LoginCard from '@/components/LoginCard';
import ForgotPasswordModal from '@/components/ForgotPasswordModal';
import AppHeader from '@/components/AppHeader';
import AppSidebar from '@/components/AppSidebar';
import TrackerPage from '@/pages/TrackerPage';
import AchievementsPage from '@/pages/AchievementsPage';
import ApprovalPage from '@/pages/ApprovalPage';
import ReportsPage from '@/pages/ReportsPage';
import OrganisationPage from '@/pages/OrganisationPage';
import UsersPage from '@/pages/UsersPage';
import AdminPage from '@/pages/AdminPage';
import AnalyticsPage from '@/pages/AnalyticsPage';
import TaskEntryPage from '@/pages/TaskEntryPage';
import SiteEngineerTimesheet from '@/pages/SiteEngineerTimesheet';
import RejectionsPage from '@/pages/RejectionsPage';
import EODReportsPage from '@/pages/EODReportsPage';
import MissingReportsPage from '@/pages/MissingReportsPage';
import MascotDolls from '@/components/MascotDolls';
import PostponementsPage from '@/pages/admin/PostponementsPage';
import DiscussionPage from '@/pages/DiscussionPage';
import PlanForDayPage from '@/pages/PlanForDayPage';
import CalendarViewPage from '@/pages/CalendarViewPage';
import NotFound from '@/pages/not-found';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import TermsOfService from '@/pages/TermsOfService';
import type { TimeEntry } from '@shared/schema';
import ChatPanel from '@/components/ChatPanel';

function AuthenticatedApp() {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  console.log('[AuthenticatedApp] Rendering for user:', user?.id, 'role:', user?.role);

  const sidebarStyle = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3.5rem",
  };

  // Fetch pending approvals count
  const { data: allTimeEntries = [] } = useQuery<TimeEntry[]>({
    queryKey: ['/api/time-entries'],
    enabled: user?.role === 'manager' || user?.role === 'hr' || user?.role === 'admin',
  });

  const { data: employeeTimeEntries = [] } = useQuery<TimeEntry[]>({
    queryKey: ['/api/time-entries/employee', user?.id],
    enabled: user?.role === 'employee',
  });

  const relevantEntries = user?.role === 'employee' ? employeeTimeEntries : allTimeEntries;

  const entriesArray = Array.isArray(relevantEntries) ? relevantEntries : [];
  const pendingCount = entriesArray.filter(e => e && e.status === 'pending').length;
  const rejectionsCount = entriesArray.filter(e => e && e.status === 'rejected').length;
  const onHoldCount = entriesArray.filter(e => e && e.status === 'on_hold').length;

  if (!user) return null;

  return (
    <SidebarProvider
      style={sidebarStyle as React.CSSProperties}
      defaultOpen={true}
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
    >
      <div className="flex h-screen w-full bg-slate-950">
        <AppSidebar
          userRole={user.role}
          pendingApprovals={pendingCount}
          pendingRejections={rejectionsCount}
          pendingOnHold={onHoldCount}
          collapsed={!sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
        />

        <div className="flex flex-col flex-1 overflow-hidden">
          <AppHeader
            user={user}
            onLogout={logout}
            selectedDate={new Date()}
            showDatePicker={location === '/tracker'}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          />
          <main className="flex-1 overflow-auto bg-slate-950" data-testid="main-content">
            <Switch>
              <Route path="/">
                <Redirect to="/tracker" />
              </Route>
              <Route path="/tracker">
                <TrackerPage user={user} />
              </Route>
              <Route path="/calendar">
                <CalendarViewPage user={user} />
              </Route>
              <Route path="/achievements">
                <AchievementsPage />
              </Route>
              <Route path="/analytics">
                <AnalyticsPage user={user} />
              </Route>
              <Route path="/task-entry">
                <TaskEntryPage user={user} />
              </Route>
              <Route path="/task-entry/:id">
                <TaskEntryPage user={user} />
              </Route>
              {(user.role === 'manager' || user.role === 'hr' || user.role === 'admin') && (
                <Route path="/approvals">
                  <ApprovalPage user={user} />
                </Route>
              )}
              <Route path="/reports">
                <ReportsPage user={user} />
              </Route>
              <Route path="/rejections">
                <RejectionsPage user={user} />
              </Route>
              {(user.role === 'manager' || user.role === 'hr' || user.role === 'admin') && (
                <>
                  <Route path="/eod-reports">
                    <EODReportsPage user={user} />
                  </Route>
                  <Route path="/missing-reports">
                    <MissingReportsPage user={user} />
                  </Route>
                </>
              )}
              <Route path="/site-timesheet">
                <SiteEngineerTimesheet />
              </Route>
              <Route path="/discussion">
                <DiscussionPage />
              </Route>
              <Route path="/plan-for-day">
                <PlanForDayPage />
              </Route>
              {user.role === 'admin' && (
                <>
                  <Route path="/organisation">
                    <OrganisationPage user={user} />
                  </Route>
                  <Route path="/users">
                    <UsersPage user={user} />
                  </Route>
                  <Route path="/admin">
                    <AdminPage user={user} />
                  </Route>
                  <Route path="/admin/postponements">
                    <PostponementsPage />
                  </Route>
                </>
              )}
              <Route>
                <Redirect to="/tracker" />
              </Route>
            </Switch>
          </main>
        </div>
      </div>
      <ChatPanel />
    </SidebarProvider>
  );
}

function AppContent() {
  const { isAuthenticated, login, isLoading } = useAuth();
  const [showWelcome, setShowWelcome] = useState(true);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  if (isAuthenticated) {
    return <AuthenticatedApp />;
  }

  if (showWelcome) {
    return (
      <WelcomePage onComplete={() => setShowWelcome(false)} />
    );
  }

  return (
    <>
      <LoginCard
        onLogin={login}
        onForgotPassword={() => setShowForgotPassword(true)}
        isLoading={isLoading}
      />
      <ForgotPasswordModal
        open={showForgotPassword}
        onClose={() => setShowForgotPassword(false)}
      />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <ThemeProvider>
            <Switch>
              <Route path="/privacy-policy">
                <PrivacyPolicy />
              </Route>
              <Route path="/terms-of-service">
                <TermsOfService />
              </Route>
              <Route>
                <AppContent />
              </Route>
            </Switch>
            <MascotDolls />
            <Toaster />
          </ThemeProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
