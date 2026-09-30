import { useState, useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, User, KeyRound, Hash, Loader2 } from 'lucide-react';
import logoImage from '@assets/WhatsApp_Image_2025-11-11_at_11.06.02_AM_1765464690595.jpeg';

interface LoginCardProps {
  onLogin: (employeeCode: string, name: string, password: string) => Promise<boolean>;
  onForgotPassword: () => void;
  isLoading?: boolean;
}

export default function LoginCard({ onLogin, onForgotPassword, isLoading = false }: LoginCardProps) {
  const [isSignup, setIsSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSignupLoading, setIsSignupLoading] = useState(false);

  const [loginData, setLoginData] = useState({
    employeeCode: '',
    name: '',
    password: ''
  });

  const [signupData, setSignupData] = useState({
    username: '',
    employeeCode: '',
    password: '',
    confirmPassword: ''
  });

  const cardRef = useRef<HTMLDivElement>(null);

  // Initial Card Entrance Animation
  useEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(cardRef.current,
      { opacity: 0, y: 30, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power2.out' }
    );
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!loginData.employeeCode || !loginData.password) {
      setError('Please fill in all required fields');
      return;
    }

    const success = await onLogin(loginData.employeeCode, loginData.name, loginData.password);
    if (!success) {
      setError('Invalid employee code or password');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!signupData.username || !signupData.employeeCode || !signupData.password || !signupData.confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (signupData.password !== signupData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (signupData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsSignupLoading(true);
    setTimeout(() => {
      setIsSignupLoading(false);
      setSuccess('Account created successfully! Please login.');
      setTimeout(() => {
        setLoginData(prev => ({ ...prev, employeeCode: signupData.employeeCode, name: signupData.username }));
        setIsSignup(false);
        setError('');
        setSuccess('');
      }, 1500);
    }, 1000);
  };

  const toggleForm = () => {
    setError('');
    setSuccess('');
    setIsSignup(!isSignup);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent pointer-events-none" />

      {/* SVG Clip Path Definitions */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <clipPath id="panelClipRight" clipPathUnits="objectBoundingBox">
            <path d="M0.12,0 Q-0.12,0.5 0.12,1 L1,1 L1,0 Z" />
          </clipPath>
          <clipPath id="panelClipLeft" clipPathUnits="objectBoundingBox">
            <path d="M0,0 L0.88,0 Q1.12,0.5 0.88,1 L0,1 Z" />
          </clipPath>
        </defs>
      </svg>

      <div
        ref={cardRef}
        className="w-full max-w-[860px] md:h-[540px] bg-slate-900 border border-blue-500/20 rounded-[24px] shadow-2xl shadow-blue-500/5 relative flex flex-col md:flex-row overflow-hidden z-10 auth-login-card"
        data-testid="login-card-container"
      >
        {/* SIGN IN FORM (LEFT SIDE ON DESKTOP) */}
        <div
          className={`w-full md:w-1/2 h-full flex flex-col justify-center px-8 md:px-12 py-10 transition-all duration-500 z-10 bg-slate-900 ${isSignup
            ? 'opacity-0 pointer-events-none md:translate-x-[-20px]'
            : 'opacity-100 pointer-events-auto md:translate-x-0'
            }`}
        >
          <div className="w-full max-w-[320px] mx-auto space-y-6">
            <div className="space-y-4">
              <div className="flex justify-center md:hidden mb-2">
                <img src={logoImage} alt="Knockturn" className="h-10 object-contain" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold text-white tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>
                  Employee Login
                </h2>
                <p className="text-xs text-blue-200/50">
                  Enter your credentials to access the time tracker
                </p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              {error && !isSignup && (
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm" data-testid="error-message">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="employeeCode" className="text-blue-100 text-xs font-semibold">Employee Code *</Label>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                  <Input
                    id="employeeCode"
                    placeholder="EMP001"
                    value={loginData.employeeCode}
                    onChange={(e) => setLoginData({ ...loginData, employeeCode: e.target.value.toUpperCase() })}
                    className="pl-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-10 rounded-lg shadow-sm"
                    data-testid="input-employee-code"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-blue-100 text-xs font-semibold">Password *</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={loginData.password}
                    onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                    className="pl-10 pr-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-10 rounded-lg shadow-sm"
                    data-testid="input-password"
                    required
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300"
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={onForgotPassword}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                className="w-full text-white font-semibold h-10 rounded-lg shadow-sm hover:opacity-90 transition-opacity auth-btn-exclude"
                style={{ backgroundColor: '#3b4fd8' }}
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Login'
                )}
              </Button>
            </form>

            <p className="text-xs text-blue-200/50 text-center md:hidden">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={toggleForm}
                className="text-blue-400 hover:text-blue-300 font-semibold"
              >
                Sign up
              </button>
            </p>
          </div>
        </div>

        {/* SIGN UP FORM (RIGHT SIDE ON DESKTOP) */}
        <div
          className={`w-full md:w-1/2 h-full flex flex-col justify-center px-8 md:px-12 py-10 transition-all duration-500 z-10 bg-slate-900 ${isSignup
            ? 'opacity-100 pointer-events-auto md:translate-x-0'
            : 'opacity-0 pointer-events-none md:translate-x-[20px]'
            }`}
        >
          <div className="w-full max-w-[320px] mx-auto space-y-4">
            <div className="space-y-4">
              <div className="flex justify-center md:hidden mb-2">
                <img src={logoImage} alt="Knockturn" className="h-10 object-contain" />
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-bold text-white tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>
                  Create Account
                </h2>
                <p className="text-xs text-blue-200/50">
                  Register for a new employee account
                </p>
              </div>
            </div>

            <form onSubmit={handleSignup} className="space-y-3.5">
              {error && isSignup && (
                <div className="p-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  {error}
                </div>
              )}
              {success && (
                <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
                  {success}
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="signup-username" className="text-blue-100 text-xs font-semibold">Username *</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                  <Input
                    id="signup-username"
                    placeholder="Your name"
                    value={signupData.username}
                    onChange={(e) => setSignupData({ ...signupData, username: e.target.value })}
                    className="pl-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-9.5 rounded-lg shadow-sm"
                    data-testid="input-signup-username"
                    required
                    disabled={isSignupLoading}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="signup-code" className="text-blue-100 text-xs font-semibold">Employee Code *</Label>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                  <Input
                    id="signup-code"
                    placeholder="EMP001"
                    value={signupData.employeeCode}
                    onChange={(e) => setSignupData({ ...signupData, employeeCode: e.target.value.toUpperCase() })}
                    className="pl-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-9.5 rounded-lg shadow-sm"
                    data-testid="input-signup-code"
                    required
                    disabled={isSignupLoading}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="signup-password" className="text-blue-100 text-xs font-semibold">Password *</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                  <Input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Create a password"
                    value={signupData.password}
                    onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                    className="pl-10 pr-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-9.5 rounded-lg shadow-sm"
                    data-testid="input-signup-password"
                    required
                    disabled={isSignupLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="signup-confirm" className="text-blue-100 text-xs font-semibold">Confirm Password *</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                  <Input
                    id="signup-confirm"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm your password"
                    value={signupData.confirmPassword}
                    onChange={(e) => setSignupData({ ...signupData, confirmPassword: e.target.value })}
                    className="pl-10 pr-10 bg-slate-800/50 border-blue-500/20 text-white placeholder:text-slate-500 focus:border-blue-400 h-9.5 rounded-lg shadow-sm"
                    data-testid="input-signup-confirm"
                    required
                    disabled={isSignupLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-300"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full text-white font-semibold h-10 rounded-lg shadow-sm hover:opacity-90 transition-opacity auth-btn-exclude"
                style={{ backgroundColor: '#3b4fd8' }}
                disabled={isSignupLoading}
                data-testid="button-signup"
              >
                {isSignupLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Create Account'
                )}
              </Button>
            </form>

            <p className="text-xs text-blue-200/50 text-center md:hidden">
              Already have an account?{' '}
              <button
                type="button"
                onClick={toggleForm}
                className="text-blue-400 hover:text-blue-300 font-semibold"
              >
                Login
              </button>
            </p>
          </div>
        </div>

        {/* SLIDING BLUE PANEL (DESKTOP ONLY) */}
        <div
          className={`absolute top-0 h-full w-1/2 auth-sliding-panel-exclude transition-all duration-700 ease-in-out z-20 flex flex-col items-center justify-center text-center px-10 py-12 text-white hidden md:flex ${isSignup ? 'left-0' : 'left-1/2'
            }`}
          style={{
            backgroundColor: '#3b4fd8',
            clipPath: isSignup ? 'url(#panelClipLeft)' : 'url(#panelClipRight)',
          }}
        >
          {isSignup ? (
            <>
              {/* Sign Up Illustration */}
              <div className="w-[280px] h-[220px] mb-8 flex items-center justify-center relative select-none pointer-events-none">
                {/* Soft white backdrop shape (highly blurred to blend smoothly) */}
                <div className="absolute w-[200px] h-[200px] rounded-full filter blur-xl z-0 auth-illustration-glow" />
                <img
                  src="/illustrations/auth-signup.png"
                  alt="Sign Up"
                  className="max-w-[90%] max-h-[90%] object-contain z-10 auth-illustration-img"
                />
              </div>

              <h2 className="text-2xl font-extrabold text-white mb-2.5" style={{ fontFamily: 'Space Grotesk' }}>
                Welcome Aboard!
              </h2>
              <p className="text-xs text-blue-100/70 max-w-[260px] leading-relaxed mb-4">
                Create your account to get started and enjoy all the time-tracking features.
              </p>
              <button
                onClick={toggleForm}
                className="px-10 py-2.5 text-white border-2 border-white hover:bg-white/10 active:scale-95 transition-all text-xs font-semibold rounded-full tracking-wider mt-6"
                style={{ backgroundColor: '#3b4fd8' }}
              >
                Sign In
              </button>
            </>
          ) : (
            <>
              {/* Sign In Illustration */}
              <div className="w-[280px] h-[220px] mb-8 flex items-center justify-center relative select-none pointer-events-none">
                {/* Soft white backdrop shape (highly blurred to blend smoothly) */}
                <div className="absolute w-[200px] h-[200px] rounded-full filter blur-xl z-0 auth-illustration-glow" />
                <img
                  src="/illustrations/auth-signin.png"
                  alt="Sign In"
                  className="max-w-[90%] max-h-[90%] object-contain z-10 auth-illustration-img"
                />
              </div>

              <h2 className="text-2xl font-extrabold text-white mb-2.5" style={{ fontFamily: 'Space Grotesk' }}>
                Hello, Friend!
              </h2>
              <p className="text-xs text-blue-100/70 max-w-[260px] leading-relaxed mb-4">
                Enter your credentials to access your timesheet dashboard and track your projects.
              </p>
              <button
                onClick={toggleForm}
                className="px-10 py-2.5 text-white border-2 border-white hover:bg-white/10 active:scale-95 transition-all text-xs font-semibold rounded-full tracking-wider mt-6"
                style={{ backgroundColor: '#3b4fd8' }}
              >
                Sign Up
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
