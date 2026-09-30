import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';

const MESSAGES = [
    "Nice Job! 🚀",
    "You're Great! ✨",
    "Super! Keep It Up! 🏆",
    "Excellent Work! 🌟",
    "Achievement Unlocked! 🔥"
];

const PARTICLE_COUNT = 30;

export default function AchievementCelebration({ isVisible, onComplete }: { isVisible: boolean, onComplete: () => void }) {
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (isVisible) {
            setMessage(MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
        }
    }, [isVisible]);

    if (!isVisible) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[1000] pointer-events-none overflow-hidden bg-slate-950/40 backdrop-blur-md flex items-center justify-center">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="relative w-full h-full flex items-center justify-center"
                >
                    {/* Background Radial Glow */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.15)_0%,transparent_70%)]"></div>

                    {/* Professional Geometric Particles (GSAP Style) */}
                    {Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
                        const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
                        const radius = 200 + Math.random() * 300;
                        const x = Math.cos(angle) * radius;
                        const y = Math.sin(angle) * radius;

                        return (
                            <motion.div
                                key={i}
                                initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
                                animate={{
                                    x: x,
                                    y: y,
                                    scale: [0, 1, 0],
                                    opacity: [0, 0.8, 0],
                                    rotate: Math.random() * 360
                                }}
                                transition={{
                                    duration: 2.5,
                                    ease: [0.22, 1, 0.36, 1], // Custom smooth ease
                                    delay: Math.random() * 0.2
                                }}
                                className="absolute w-2 h-2 bg-gradient-to-tr from-blue-400 to-indigo-500 rounded-sm"
                            />
                        );
                    })}

                    {/* Main Message (GSAP-style elastic pop) */}
                    <motion.div
                        initial={{ scale: 0.2, opacity: 0, y: 50 }}
                        animate={{
                            scale: [0.2, 1.1, 1],
                            opacity: 1,
                            y: 0
                        }}
                        transition={{
                            duration: 0.8,
                            ease: [0.34, 1.56, 0.64, 1], // Elastic Out
                        }}
                        className="text-center z-10"
                    >
                        <h2 className="text-5xl md:text-7xl font-black text-white tracking-tighter drop-shadow-[0_20px_50px_rgba(59,130,246,0.5)] bg-clip-text text-transparent bg-gradient-to-b from-white via-blue-100 to-blue-400"
                            style={{ fontFamily: 'Inter, sans-serif' }}>
                            {message}
                        </h2>

                        {/* Sub-line */}
                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4, duration: 0.6 }}
                            className="text-blue-200/60 text-lg md:text-xl font-medium mt-4 tracking-widest uppercase"
                        >
                            Entry Logged Successfully
                        </motion.p>

                        {/* Animated Underline */}
                        <motion.div
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{ delay: 0.6, duration: 1, ease: "circOut" }}
                            className="h-1 w-32 bg-blue-500 mx-auto mt-6 rounded-full shadow-[0_0_20px_rgba(59,130,246,1)]"
                        />
                    </motion.div>

                    {/* Timer to auto-complete */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 3 }}
                        onAnimationComplete={onComplete}
                    />
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
