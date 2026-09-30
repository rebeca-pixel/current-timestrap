import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';

interface ForgotPasswordModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'request' | 'verify' | 'success';

export default function ForgotPasswordModal({ open, onClose }: ForgotPasswordModalProps) {
  const [step, setStep] = useState<Step>('request');
  const [employeeCode, setEmployeeCode] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(600); // 10 min in seconds
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Clear timer helper
  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Start countdown helper
  const startCountdown = () => {
    clearTimer();
    setCountdown(600); // Reset to 10 min
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearTimer();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  // Cleanup on unmount or close
  useEffect(() => {
    return () => clearTimer();
  }, []);

  // Step 1 — Request OTP
  const handleRequestOTP = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeCode: employeeCode.toUpperCase() })
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to request OTP');
      }
      
      setStep('verify');
      startCountdown();
    } catch (e: any) {
      setError(e.message || 'Failed to request OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — Verify OTP + Reset Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeCode: employeeCode.toUpperCase(),
          otp,
          newPassword,
          confirmPassword
        })
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }
      
      clearTimer();
      setStep('success');
    } catch (e: any) {
      setError(e.message || 'Failed to verify OTP or reset password.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    // Reset state on close
    setStep('request');
    setEmployeeCode('');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setError('');
    clearTimer();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-slate-900 border border-blue-500/20 text-white max-w-[440px] rounded-[24px] p-6 shadow-2xl overflow-hidden">
        
        {step === 'request' && (
          <form onSubmit={handleRequestOTP} className="space-y-5">
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="text-xl font-bold text-white leading-none" style={{ fontFamily: 'Space Grotesk' }}>
                Reset Password
              </DialogTitle>
              <DialogDescription className="text-blue-200/50 text-sm font-normal">
                Enter your employee code and we'll send a 6-digit OTP to your registered email.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2.5 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="req-employee-code" className="text-blue-100 text-xs font-semibold">
                Employee Code *
              </Label>
              <Input
                id="req-employee-code"
                placeholder="Employee Code (e.g. E0053)"
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                className="bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-10 rounded-lg shadow-sm"
                required
                disabled={loading}
              />
            </div>

            <DialogFooter className="pt-3 gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={loading}
                className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white rounded-lg font-semibold h-10 shrink-0"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || !employeeCode}
                className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold rounded-lg h-10 shadow-sm shrink-0"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending OTP...
                  </>
                ) : (
                  'Send OTP'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'verify' && (
          <form onSubmit={handleResetPassword} className="space-y-5">
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="text-xl font-bold text-white leading-none" style={{ fontFamily: 'Space Grotesk' }}>
                Verify OTP
              </DialogTitle>
              <DialogDescription className="text-blue-200/50 text-sm font-normal">
                OTP sent to your registered email. Enter it below along with your new password.
              </DialogDescription>
              <p className="text-xs text-amber-400 font-medium">
                Expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
              </p>
            </DialogHeader>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2.5 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="verification-otp" className="text-blue-100 text-xs font-semibold">
                  6-digit OTP *
                </Label>
                <Input
                  id="verification-otp"
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  maxLength={6}
                  className="bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-10 rounded-lg shadow-sm"
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="verification-new-password" className="text-blue-100 text-xs font-semibold">
                  New Password *
                </Label>
                <div className="relative">
                  <Input
                    id="verification-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-10 pr-10 rounded-lg shadow-sm"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="verification-confirm-password" className="text-blue-100 text-xs font-semibold">
                  Confirm Password *
                </Label>
                <div className="relative">
                  <Input
                    id="verification-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-10 pr-10 rounded-lg shadow-sm"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-3 flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleRequestOTP()}
                disabled={countdown > 0 || loading}
                className="bg-slate-800/50 hover:bg-slate-800 text-blue-400 hover:text-blue-300 rounded-lg font-semibold h-10"
              >
                {countdown > 0 ? `Resend in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}` : 'Resend OTP'}
              </Button>
              <div className="flex-1 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={loading}
                  className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white rounded-lg font-semibold h-10"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !otp || !newPassword || !confirmPassword}
                  className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold rounded-lg h-10 shadow-sm"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    'Reset Password'
                  )}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}

        {step === 'success' && (
          <div className="py-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-400" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-white text-center" style={{ fontFamily: 'Space Grotesk' }}>
                Password Reset Successfully
              </DialogTitle>
              <DialogDescription className="text-blue-200/50 text-center text-sm mt-1 px-4">
                You can now log in with your new password.
              </DialogDescription>
            </DialogHeader>
            <div className="pt-4 flex justify-center">
              <Button 
                onClick={handleClose} 
                className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white px-6 font-semibold rounded-lg"
              >
                Back to Login
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
