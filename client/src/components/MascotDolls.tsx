import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import mascotImage from '../assets/mascot_3d_premium.png';

interface Doll {
    id: string;
    text: string;
    x: number;
    y: number;
}

export default function MascotDolls() {
    const [dolls, setDolls] = useState<Doll[]>([]);

    useEffect(() => {
        const handler = (e: any) => {
            const { text, x, y } = e.detail || {};
            const id = Math.random().toString(36).substr(2, 9);
            const newDoll = {
                id,
                text: text || "Hurray!",
                x: 75 + Math.random() * 10, // Always top-right
                y: 8 + Math.random() * 8    // Always near top edge
            };
            setDolls(prev => [...prev, newDoll]);

            // Auto remove after animation
            setTimeout(() => {
                setDolls(prev => prev.filter(d => d.id !== id));
            }, 3000);
        };

        window.addEventListener('mascot:doll', handler as EventListener);
        return () => window.removeEventListener('mascot:doll', handler as EventListener);
    }, []);

    return (
        <div className="fixed inset-0 pointer-events-none z-[150] overflow-hidden">
            <AnimatePresence>
                {dolls.map(doll => (
                    <motion.div
                        key={doll.id}
                        initial={{ opacity: 0, scale: 0.2, y: 100, rotate: -20 }}
                        animate={{
                            opacity: 1,
                            scale: 1,
                            y: 0,
                            rotate: 0,
                            transition: { type: "spring", stiffness: 260, damping: 20 }
                        }}
                        exit={{ opacity: 0, scale: 0.5, y: -100, transition: { duration: 0.4 } }}
                        style={{
                            position: 'absolute',
                            left: `${doll.x}%`,
                            top: `${doll.y}%`,
                            transform: 'translate(-50%, -50%)'
                        }}
                        className="flex flex-col items-center"
                    >
                        <div className="bg-white/95 backdrop-blur-md px-4 py-2 rounded-2xl shadow-xl border border-blue-100 mb-2 relative">
                            <span className="text-sm font-black text-blue-600 whitespace-nowrap">{doll.text}</span>
                            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rotate-45 border-r border-b border-blue-50"></div>
                        </div>
                        <motion.img
                            src={mascotImage}
                            alt="Doll"
                            className="w-32 h-32 object-contain drop-shadow-2xl aria-robot-mascot"
                            animate={{
                                y: [0, -15, 0],
                                rotateZ: [-10, 10, -10],
                                scale: [1, 1.1, 1]
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                        />
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
