import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import knockturnLogoDark from '@/assets/animations/knockturn-logo-dark.png';
import knockturnLogoLight from '@/assets/animations/knockturn-logo-light.png';

interface WelcomePageProps {
  onComplete: () => void;
}

export default function WelcomePage({ onComplete }: WelcomePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lampRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const pulseAnimRef = useRef<gsap.core.Tween | null>(null);
  const [isPulled, setIsPulled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pullY, setPullY] = useState(0);
  const startYRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;
    
    gsap.fromTo(logoRef.current, 
      { opacity: 0, y: -30 },
      { opacity: 1, y: 0, duration: 1, ease: 'power2.out' }
    );
    
    gsap.fromTo(textRef.current,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 1, delay: 0.3, ease: 'power2.out' }
    );
    
    gsap.fromTo(lampRef.current,
      { opacity: 0, scale: 0.8 },
      { opacity: 1, scale: 1, duration: 0.8, delay: 0.6, ease: 'back.out(1.7)' }
    );

    pulseAnimRef.current = gsap.to(pullRef.current, {
      y: 8,
      duration: 1,
      repeat: -1,
      yoyo: true,
      ease: 'power1.inOut'
    });

    return () => {
      if (pulseAnimRef.current) {
        pulseAnimRef.current.kill();
      }
    };
  }, []);

  const triggerTransition = () => {
    if (isPulled) return;
    setIsPulled(true);
    
    gsap.to(glowRef.current, {
      opacity: 1,
      scale: 2,
      duration: 0.5,
      ease: 'power2.out'
    });
    
    gsap.to(containerRef.current, {
      opacity: 0,
      scale: 1.1,
      duration: 0.8,
      delay: 0.3,
      ease: 'power2.inOut',
      onComplete: onComplete
    });
  };

  const handleDragStart = (clientY: number) => {
    if (isPulled) return;
    
    if (pulseAnimRef.current) {
      pulseAnimRef.current.kill();
    }
    
    setIsDragging(true);
    startYRef.current = clientY;
    setPullY(0);
  };

  const handleDragMove = (clientY: number) => {
    if (isPulled || !isDragging) return;
    
    const delta = Math.max(0, Math.min(120, clientY - startYRef.current));
    setPullY(delta);
    
    if (glowRef.current) {
      const intensity = delta / 120;
      glowRef.current.style.opacity = String(intensity * 0.9);
    }
  };

  const handleDragEnd = () => {
    if (isPulled) return;
    setIsDragging(false);
    
    if (pullY > 50) {
      triggerTransition();
    } else {
      gsap.to({ value: pullY }, {
        value: 0,
        duration: 0.3,
        ease: 'power2.out',
        onUpdate: function() {
          setPullY(this.targets()[0].value);
        }
      });
      
      if (glowRef.current) {
        gsap.to(glowRef.current, { opacity: 0, duration: 0.3 });
      }
      
      pulseAnimRef.current = gsap.to(pullRef.current, {
        y: 8,
        duration: 1,
        repeat: -1,
        yoyo: true,
        ease: 'power1.inOut'
      });
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        handleDragMove(e.clientY);
      }
    };
    
    const handleMouseUp = () => {
      if (isDragging) {
        handleDragEnd();
      }
    };
    
    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging && e.touches[0]) {
        handleDragMove(e.touches[0].clientY);
      }
    };
    
    const handleTouchEnd = () => {
      if (isDragging) {
        handleDragEnd();
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, pullY, isPulled]);

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 overflow-hidden"
      data-testid="welcome-page"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent" />
      
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(50)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-blue-400/30 rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 2}s`
            }}
          />
        ))}
      </div>

      <div ref={logoRef} className="relative z-10 mb-8">
        {/* Dark mode logo */}
        <img 
          src={knockturnLogoDark} 
          alt="Knockturn" 
          className="h-20 md:h-24 object-contain splash-logo-dark"
          data-testid="logo-knockturn-dark"
        />
        {/* Light mode logo */}
        <img 
          src={knockturnLogoLight} 
          alt="Knockturn" 
          className="h-20 md:h-24 object-contain splash-logo-light"
          data-testid="logo-knockturn-light"
        />
      </div>

      <div ref={textRef} className="relative z-10 text-center mb-16">
        <h1 
          className="text-4xl md:text-6xl font-bold text-white mb-4"
          style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          data-testid="text-welcome-title"
        >
          Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">Time Strap</span>
        </h1>
        <p className="text-lg md:text-xl text-blue-200/70" data-testid="text-welcome-subtitle">
          Employee Time Tracking System
        </p>
      </div>

      <div 
        ref={lampRef}
        className="relative z-10 flex flex-col items-center select-none"
        data-testid="lamp-container"
      >
        <div className="relative">
          <div className="w-32 h-24 relative">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-8 bg-gradient-to-b from-zinc-600 to-zinc-700 rounded-full" />
            <div className="absolute top-6 left-1/2 -translate-x-1/2 w-20 h-16 bg-gradient-to-b from-zinc-700 via-zinc-800 to-zinc-900 rounded-b-full border-t-4 border-zinc-600" 
              style={{ clipPath: 'polygon(10% 0%, 90% 0%, 100% 100%, 0% 100%)' }}
            />
            <div 
              ref={glowRef}
              className="absolute top-10 left-1/2 w-40 h-40 rounded-full blur-xl opacity-0"
              style={{ 
                transform: 'translateX(-50%) translateY(-20%)',
                background: 'radial-gradient(circle, rgba(56, 189, 248, 0.6) 0%, rgba(34, 211, 238, 0.3) 40%, transparent 70%)'
              }}
            />
          </div>
          
          <div
            ref={pullRef}
            className="absolute left-1/2 top-20 flex flex-col items-center cursor-grab active:cursor-grabbing"
            style={{ 
              transform: `translateX(-50%) translateY(${pullY}px)`,
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              handleDragStart(e.clientY);
            }}
            onTouchStart={(e) => {
              if (e.touches[0]) {
                handleDragStart(e.touches[0].clientY);
              }
            }}
          >
            <div className="w-0.5 h-12 bg-gradient-to-b from-zinc-500 to-zinc-600" />
            <div className="w-8 h-8 rounded-full bg-gradient-to-b from-blue-400 to-blue-600 shadow-lg shadow-blue-500/50 flex items-center justify-center hover:from-blue-300 hover:to-blue-500 transition-colors">
              <div className="w-4 h-4 rounded-full bg-blue-300" />
            </div>
          </div>
        </div>

        <button
          onClick={triggerTransition}
          className="mt-24 text-blue-300/60 text-sm animate-pulse hover:text-blue-300 transition-colors cursor-pointer"
          data-testid="button-enter"
        >
          Pull down or click to enter
        </button>
      </div>
    </div>
  );
}
