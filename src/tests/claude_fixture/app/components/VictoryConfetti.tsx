import { useEffect, useState } from 'react';

export default function VictoryConfetti() {
    const [particles, setParticles] = useState<any[]>([]);

    useEffect(() => {
        setParticles(Array.from({ length: 50 }).map((_, i) => ({
            id: i,
            left: Math.random() * 100,
            bg: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'][Math.floor(Math.random() * 6)],
            duration: 2 + Math.random() * 3,
            delay: Math.random() * 2, // Start immediately within 2s
        })));
    }, []);

    return (
        <div className="absolute inset-0 pointer-events-none z-[100] overflow-hidden">
            {particles.map((p) => (
                <div
                    key={p.id}
                    className="absolute w-2.5 h-2.5 rounded-sm"
                    style={{
                        left: `${p.left}%`,
                        top: '-20px',
                        backgroundColor: p.bg,
                        animation: `confetti-fall ${p.duration}s linear infinite`,
                        animationDelay: `${p.delay}s`,
                    }}
                />
            ))}
            <style>{`
                @keyframes confetti-fall {
                    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                    100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
                }
            `}</style>
        </div>
    );
}
