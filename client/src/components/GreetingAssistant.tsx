import { motion, AnimatePresence, useMotionValue, useTransform, useSpring, useAnimation } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { playSound } from '@/lib/feedback';
import mascotImage from '../assets/mascot_3d_clean.png';
import { X } from 'lucide-react';

interface GreetingAssistantProps {
    userName: string;
}

// 1. Expanded Motivational Library
const MOTIVATIONAL_QUOTES = [
    "Small progress is still progress.",
    "Consistency beats intensity.",
    "One step at a time leads to big changes.",
    "Action is the foundational key to all success.",
    "The expert in anything was once a beginner.",
    "Focus on being productive instead of busy.",
    "Do something today that your future self will thank you for.",
    "Slow progress is better than no progress.",
    "Consistency is the playground of giants.",
    "Don't stop until you're proud.",
    "Rivers know this: there is no hurry.",
    "Build momentum, not just to-do lists.",
    "One percent better every day adds up.",
    "Mistakes are proof that you are trying.",
    "Dream big. Start small. But most of all, start.",
    "Discipline is choosing between what you want now and what you want most.",
    "Growth happens outside of your comfort zone.",
    "Your mind is for having ideas, not holding them.",
    "Prioritize your peace, then your productivity.",
    "Stay hungry. Stay foolish.",
    "Keep showing up.",
    "Eyes on the prize.",
    "Crush those goals!",
    "Make it happen.",
    "Write your own story.",
    "Level up today.",
    "Unstoppable.",
    "Success is buried under 'one more try'.",
    "Energy flows where intention goes.",
    "Don't wish for it, work for it.",
    "The best time to start was yesterday.",
    "Your future self is watching you right now.",
    "Be the hardest worker in the room.",
    "Focus on the step, not the mountain."
];

export default function GreetingAssistant({ userName }: GreetingAssistantProps) {
    const controls = useAnimation();
    const [isVisible, setIsVisible] = useState(false);
    const [greeting, setGreeting] = useState('');
    const [quote, setQuote] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [transientMessage, setTransientMessage] = useState<string | null>(null);
    const [transientNear, setTransientNear] = useState<{ text: string; x: number; y: number } | null>(null);
    const assistantRef = useRef<HTMLDivElement>(null);

    // 3D Parallax Mouse Tracking
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    const mouseXSpring = useSpring(mouseX, { stiffness: 100, damping: 20 });
    const mouseYSpring = useSpring(mouseY, { stiffness: 100, damping: 20 });

    const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["15deg", "-15deg"]);
    const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-15deg", "15deg"]);

    useEffect(() => {
        // --- Logic: Persistent Shuffle Queue ---
        let queue: string[] = [];
        try {
            const saved = localStorage.getItem('mascot_quote_queue');
            queue = saved ? JSON.parse(saved) : [];
        } catch (e) {
            queue = [];
        }

        // Reshuffle if queue is empty
        if (queue.length === 0) {
            queue = [...MOTIVATIONAL_QUOTES].sort(() => Math.random() - 0.5);
        }

        const selectedQuote = queue.shift() || MOTIVATIONAL_QUOTES[0];
        localStorage.setItem('mascot_quote_queue', JSON.stringify(queue));

        // --- Logic: Time-based Greeting ---
        const hour = new Date().getHours();
        let timeGreeting = 'Hi';
        if (hour < 12) timeGreeting = 'Good morning';
        else if (hour < 17) timeGreeting = 'Good afternoon';
        else timeGreeting = 'Good evening';

        const messages = [
            `${timeGreeting}, ${userName}`,
            `Welcome back, ${userName}`,
            `${timeGreeting}, good to see you`
        ];

        setGreeting(messages[Math.floor(Math.random() * messages.length)]);
        setQuote(selectedQuote);

        // Show sometimes (e.g. 45% chance)
        const shouldShow = Math.random() < 0.45;

        if (shouldShow) {
            const timer = setTimeout(() => {
                setIsVisible(true);
                sessionStorage.setItem('greetingActive', 'true');
            }, 800);

            // Hide after 25 seconds
            const hideTimer = setTimeout(() => {
                setIsVisible(false);
            }, 25000);

            return () => {
                clearTimeout(timer);
                clearTimeout(hideTimer);
            };
        }
    }, [userName]);

    // Listen for mascot speak events
    useEffect(() => {
        const handler = (e: any) => {
            const msg = e?.detail?.text || String(e?.detail || '');
            if (!msg) return;
            const sanitized = /don'?t know/i.test(String(msg).trim()) ? "Not sure? Try adding a quick note — you got this." : msg;
            setTransientMessage(sanitized);
            controls.start({
                scale: [1, 1.08, 0.96, 1],
                rotateZ: [0, -10, 10, 0],
                y: [0, -8, 6, 0],
                transition: { duration: 0.9, ease: 'easeOut' }
            });
            setTimeout(() => setTransientMessage(null), 3800);
        };
        window.addEventListener('mascot:speak', handler as EventListener);
        return () => window.removeEventListener('mascot:speak', handler as EventListener);
    }, [controls]);

    const handlePoke = () => {
        controls.start({
            scale: [1, 0.5, 1.4, 0.8, 1.2, 0.95, 1],
            rotateZ: [0, -25, 25, -15, 15, -5, 5, 0],
            y: [0, 20, -30, 10, -5, 0],
            transition: { duration: 0.8, ease: "backOut" }
        });
        try { playSound('select', 1); } catch { }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!assistantRef.current || isDragging) return;
        const rect = assistantRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        mouseX.set((e.clientX - centerX) / (rect.width / 3));
        mouseY.set((e.clientY - centerY) / (rect.height / 3));
    };

    if (!isVisible && !transientNear) return null;

    return (
        <AnimatePresence>
            {isVisible && (
                <div className="fixed top-20 right-8 z-[100] select-none pointer-events-none" style={{ perspective: '2000px' }}>
                    <motion.div
                        ref={assistantRef}
                        drag
                        dragConstraints={{ left: -window.innerWidth + 200, right: 0, top: -window.innerHeight + 200, bottom: 0 }}
                        dragElastic={0.2}
                        onDragStart={() => setIsDragging(true)}
                        onDragEnd={() => setIsDragging(false)}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={() => { mouseX.set(0); mouseY.set(0); }}
                        onTap={handlePoke}
                        whileDrag={{ scale: 1.1, rotateZ: 5 }}
                        initial={{ opacity: 0, y: 100, scale: 0.5 }}
                        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 100, damping: 12 } }}
                        exit={{ opacity: 0, scale: 0.8, y: 40 }}
                        className="relative flex flex-col items-center pointer-events-auto cursor-grab active:cursor-grabbing"
                        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
                    >
                        <motion.div animate={controls} className="relative group flex flex-col items-center">

                            {/* Speech Bubble (Appears below when assistant is in top area) */}
                            <motion.div
                                initial={{ opacity: 0, y: -20, scale: 0.5 }}
                                animate={{ opacity: 1, y: 40, scale: 1, transition: { delay: 0.15, type: "spring", stiffness: 140 } }}
                                className="absolute top-24 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-2xl text-white p-5 rounded-3xl shadow-[0_25px_50px_rgba(0,0,0,0.5)] border border-white/10 min-w-[240px] z-[120] greeting-card"
                                style={{ translateZ: "120px" }}
                            >
                                <div className="flex flex-col gap-2">
                                    {transientMessage ? (
                                        <p className="text-sm font-bold italic text-center text-blue-50 tracking-wide">{transientMessage}</p>
                                    ) : (
                                        <>
                                            <p className="text-xs font-medium uppercase text-blue-400/80 tracking-widest text-center">{greeting}</p>
                                            {quote && (
                                                <motion.p
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    transition={{ delay: 0.5 }}
                                                    className="text-sm text-center text-amber-300 font-extrabold leading-relaxed"
                                                >
                                                    “{quote}”
                                                </motion.p>
                                            )}
                                        </>
                                    )}
                                </div>
                                <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-5 h-5 bg-slate-900 transform rotate-45 border-t border-l border-white/10"></div>
                            </motion.div>

                            {/* Close Button */}
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsVisible(false); }}
                                className="absolute -top-6 -right-6 bg-red-600/90 hover:bg-red-500 text-white p-2 rounded-full shadow-2xl z-[130] opacity-0 group-hover:opacity-100 transition-all duration-300 scale-0 group-hover:scale-100 pointer-events-auto"
                            >
                                <X className="w-4 h-4" />
                            </button>

                            {/* Mascot Image & Glow */}
                            <motion.div
                                className="relative pointer-events-none"
                                animate={{ y: [0, -10, 0], rotateZ: [0, 2, -2, 0] }}
                                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                            >
                                <div className="absolute inset-0 bg-blue-400/20 blur-[50px] rounded-full scale-100 animate-pulse"></div>
                                <div className="absolute inset-x-0 -bottom-8 h-5 bg-black/40 blur-lg rounded-[100%] scale-x-75"></div>

                                <motion.img
                                    src={mascotImage}
                                    alt="3D Mascot"
                                    animate={isDragging ? { rotateX: [0, -15, 15, 0], rotateY: [0, 15, -15, 0], scale: 1.15 } : {}}
                                    className="w-32 h-32 md:w-44 md:h-44 object-contain brightness-110 contrast-110 aria-robot-mascot"
                                    style={{ transform: "translateZ(60px)", filter: "drop-shadow(0 20px 30px rgba(0,0,0,0.5))" }}
                                />
                            </motion.div>
                        </motion.div>

                        <div className="mt-6 text-[10px] text-blue-400/60 font-black tracking-[0.4em] uppercase opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-2 group-hover:translate-y-0 text-center">
                            ● POKE ● DRAG ● INSPIRE ●
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}