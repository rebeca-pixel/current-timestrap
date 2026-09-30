import { SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from '../AppSidebar';

export default function AppSidebarExample() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };
  
  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full bg-slate-950">
        <AppSidebar userRole="admin" pendingApprovals={5} />
        <div className="flex-1 p-6">
          <p className="text-white">Main content area</p>
        </div>
      </div>
    </SidebarProvider>
  );
}
