import React, { useEffect, useState } from 'react';
import gamification from '@/lib/gamification';
import { Star } from 'lucide-react';

export default function PointsDisplay({ className = '' }: { className?: string }) {
  const [points, setPoints] = useState<number>(0);
  const [badgesCount, setBadgesCount] = useState<number>(0);

  useEffect(() => {
    setPoints(gamification.getPoints());
    setBadgesCount(gamification.getBadges().length);
    const onStorage = () => {
      setPoints(gamification.getPoints());
      setBadgesCount(gamification.getBadges().length);
    };
    window.addEventListener('storage', onStorage);
    const t = setInterval(onStorage, 1500);
    return () => { window.removeEventListener('storage', onStorage); clearInterval(t); };
  }, []);

  return (
    <div title={`${points} points • ${badgesCount} badges`} className={`flex items-center gap-2 px-3 py-1 rounded-md bg-slate-800/60 border border-blue-500/20 text-white text-sm ${className}`}>
      <Star className="w-4 h-4 text-yellow-300" />
      <div className="flex flex-col leading-tight">
        <span className="font-bold">{points}</span>
        <span className="text-xs text-blue-200/60">pts • {badgesCount} badges</span>
      </div>
    </div>
  );
}
