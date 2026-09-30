import { useState } from 'react';
import ForgotPasswordModal from '../ForgotPasswordModal';
import { Button } from '@/components/ui/button';

export default function ForgotPasswordModalExample() {
  const [open, setOpen] = useState(true);
  
  return (
    <div className="bg-slate-950 min-h-screen p-6 flex items-center justify-center">
      <Button onClick={() => setOpen(true)}>Open Forgot Password</Button>
      <ForgotPasswordModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
