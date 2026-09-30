import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export default function DuckAnimation() {
    const [isVisible, setIsVisible] = useState(true);

    // Duck characters
    const ducks = ['🦆', '🐥', '🐥', '🐥', '🐥'];

    return (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-100 select-none">
            <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: '110%' }}
                transition={{
                    duration: 20, // Slightly faster
                    repeat: Infinity,
                    ease: "linear"
                }}
                className="absolute bottom-48 flex items-center gap-4 text-4xl"
                style={{ filter: "drop-shadow(0 5px 15px rgba(0,0,0,0.4))" }}
            >
                {ducks.map((duck, index) => (
                    <motion.div
                        key={index}
                        animate={{
                            y: [0, -10, 0],
                            rotate: [0, 5, -5, 0]
                        }}
                        transition={{
                            duration: 0.6,
                            repeat: Infinity,
                            delay: index * 0.1,
                            ease: "easeInOut"
                        }}
                        className="relative"
                    >
                        {duck}
                        {/* Waddle effect */}
                        <div className="text-[10px] absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap font-bold text-blue-400 bg-white/10 backdrop-blur-sm px-2 py-1 rounded-full border border-blue-400/20 opacity-0 group-hover:opacity-100 transition-opacity">
                            {index === 0 && "Hello cutie!"}
                        </div>
                    </motion.div>
                ))}

                {/* Speech bubble for mother duck */}
                <motion.div
                    animate={{
                        opacity: [0, 1, 1, 0],
                        scale: [0.5, 1, 1, 0.5],
                        x: [0, 10, 10, 0]
                    }}
                    transition={{
                        duration: 4,
                        repeat: Infinity,
                        times: [0, 0.1, 0.9, 1]
                    }}
                    className="ml-4 bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-2xl rounded-bl-none text-xs font-bold text-white border border-white/20 whitespace-nowrap"
                >
                    Hello ! 🦆✨
                </motion.div>
            </motion.div>
        </div>
    );
}
