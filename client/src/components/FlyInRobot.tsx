import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// Prefer premium mascot if available in assets; fallback to clean version
import premiumMascot from '../assets/mascot_3d_premium.png';
import mascotImage from '../assets/mascot_3d_clean.png';
import { playSound, speak } from '@/lib/feedback';

// runtime-friendly: allow a custom mascot URL to be provided at runtime via
// `window.__CUSTOM_MASCOT_URL` so you can drop your preferred robot image into public folder
// and experiment without rebuilding.

export default function FlyInRobot() {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ right: number; top: number }>({ right: 60, top: 60 });
  const [text, setText] = useState('');

  useEffect(() => {
    let t: any;
    const handler = (e: any) => {
      const detail = e?.detail;
      if (!detail) return;
      const rect = detail.rect;
      let message = detail.text || 'Hello!';
      if (/don'?t know/i.test(String(message).trim())) {
        message = 'Not sure? Try a short note — you can do this.';
      }

      // motivational quotes to append
      const QUOTES = [
        'Keep going — progress is progress.',
        'Small steps every day add up to big wins.',
        'You’ve got this — focus and finish.',
        'One task at a time. One victory at a time.',
        'Do it for tomorrow — start today.',
        'Finish small things first and feel the momentum.',
        'Tiny wins unlock big milestones.',
        'Consistency over time beats rare bursts.',
        'Start now — the rest will follow.',
        'A short focused session beats long distraction.',
        'Close one task, claim one win.',
        'Your effort grows the garden. Keep watering.',
        'Progress is a series of small completions.',
        'Make today better than yesterday.',
        'Keep the streak — do one more task.'
      ];
      // avoid immediate repeat
      const last = (window as any).__lastFlyInQuote as number | undefined;
      let qi = Math.floor(Math.random() * QUOTES.length);
      if (typeof last === 'number' && QUOTES.length > 1) {
        let attempts = 0;
        while (qi === last && attempts < 8) { qi = Math.floor(Math.random() * QUOTES.length); attempts++; }
      }
      try { (window as any).__lastFlyInQuote = qi; } catch { }
      const q = QUOTES[qi];

      // Position robot at the top-right of the page
      const right = 60;
      const top = 60;

      setPos({ right, top });
      setText(`${message} — ${q}`);
      setVisible(true);
      try { playSound('confirm', 2); } catch { }

      clearTimeout(t);
      t = setTimeout(() => setVisible(false), 3200);
    };

    window.addEventListener('mascot:showNear', handler as EventListener);
    return () => { window.removeEventListener('mascot:showNear', handler as EventListener); clearTimeout(t); };
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: 100, scale: 0.6 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 100, scale: 0.7 }}
          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
          style={{ position: 'fixed', right: (pos as any).right, top: pos.top, zIndex: 2000, pointerEvents: 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <img src={(window as any).__CUSTOM_MASCOT_URL || premiumMascot || mascotImage} alt="robot" style={{ width: 96, height: 96, filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.6))' }} />
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18 }} style={{ background: 'rgba(17,24,39,0.9)', color: '#fff', padding: '8px 12px', borderRadius: 12, boxShadow: '0 8px 20px rgba(2,6,23,0.6)', maxWidth: 260 }}>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{text}</div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
