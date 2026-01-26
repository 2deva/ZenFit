import React from 'react';
import { Trophy, Flame, Star, Zap, Award, Target, Sparkles } from 'lucide-react';

interface AchievementBadgeProps {
    type: 'streak' | 'milestone' | 'first' | 'consistency' | 'challenge' | 'special';
    title: string;
    description?: string;
    value?: number;
    unlocked?: boolean;
    celebrateOnMount?: boolean;
}

const BADGE_CONFIGS = {
    streak: {
        icon: Flame,
        gradient: 'from-claude-500 to-claude-600',
        bgGradient: 'from-claude-100 to-claude-50',
        border: 'border-claude-200',
        glow: 'shadow-glow-claude',
        accentText: 'text-claude-600'
    },
    milestone: {
        icon: Trophy,
        gradient: 'from-accent-teal to-teal-600',
        bgGradient: 'from-teal-100 to-teal-50',
        border: 'border-teal-200',
        glow: 'shadow-glow-teal',
        accentText: 'text-accent-teal'
    },
    first: {
        icon: Star,
        gradient: 'from-amber-500 to-amber-600',
        bgGradient: 'from-amber-100 to-amber-50',
        border: 'border-amber-200',
        glow: 'shadow-[0_0_30px_-5px_rgba(245,158,11,0.35)]',
        accentText: 'text-amber-600'
    },
    consistency: {
        icon: Target,
        gradient: 'from-pink-500 to-pink-600',
        bgGradient: 'from-pink-100 to-pink-50',
        border: 'border-pink-200',
        glow: 'shadow-[0_0_30px_-5px_rgba(236,72,153,0.35)]',
        accentText: 'text-pink-600'
    },
    challenge: {
        icon: Zap,
        gradient: 'from-purple-500 to-purple-600',
        bgGradient: 'from-purple-100 to-purple-50',
        border: 'border-purple-200',
        glow: 'shadow-[0_0_30px_-5px_rgba(168,85,247,0.35)]',
        accentText: 'text-purple-600'
    },
    special: {
        icon: Award,
        gradient: 'from-claude-600 to-claude-700',
        bgGradient: 'from-claude-100 to-sand-50',
        border: 'border-claude-300',
        glow: 'shadow-glow-claude',
        accentText: 'text-claude-700'
    }
};

export const AchievementBadge: React.FC<AchievementBadgeProps> = ({
    type = 'streak',
    title,
    description,
    value,
    unlocked = true,
    celebrateOnMount = false
}) => {
    const config = BADGE_CONFIGS[type];
    const Icon = config.icon;
    const [showCelebration, setShowCelebration] = React.useState(false);

    React.useEffect(() => {
        if (celebrateOnMount && unlocked) {
            setShowCelebration(true);
            const timer = setTimeout(() => setShowCelebration(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [celebrateOnMount, unlocked]);

    return (
        <div className={`
      relative bg-white/90 backdrop-blur-sm p-4 sm:p-5 rounded-2xl sm:rounded-3xl border
      ${unlocked ? `${config.border} ${config.glow}` : 'border-sand-200 opacity-60'}
      animate-slide-up-fade transition-all duration-500 overflow-hidden
    `}>
            {unlocked && (
                <div className={`absolute top-0 right-0 w-20 sm:w-24 h-20 sm:h-24 bg-gradient-radial ${config.bgGradient.replace('from-', 'from-').replace('to-', 'via-')}/30 to-transparent rounded-full blur-2xl -mr-6 sm:-mr-8 -mt-6 sm:-mt-8 pointer-events-none`}></div>
            )}

            {showCelebration && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    {[...Array(12)].map((_, i) => (
                        <div
                            key={i}
                            className="absolute w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full animate-ping"
                            style={{
                                left: `${10 + Math.random() * 80}%`,
                                top: `${10 + Math.random() * 80}%`,
                                animationDelay: `${i * 0.1}s`,
                                animationDuration: '1.5s',
                                backgroundColor: ['#E87A38', '#2A9D8F', '#F59E0B', '#EC4899'][i % 4]
                            }}
                        />
                    ))}
                </div>
            )}

            <div className="flex items-center gap-3 sm:gap-4 relative z-10">
                <div className={`
          relative w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all duration-300
          ${unlocked
                        ? `bg-gradient-to-br ${config.gradient} text-white shadow-lg`
                        : 'bg-sand-100 border border-sand-200 text-ink-300'}
        `}>
                    {unlocked && (
                        <div className="absolute inset-0 bg-white/20 rounded-xl sm:rounded-2xl animate-breathe"></div>
                    )}
                    <Icon className={`w-5 h-5 sm:w-6 sm:h-6 relative z-10 ${unlocked ? 'fill-white/30' : ''}`} />

                    {value && unlocked && (
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 sm:w-6 sm:h-6 bg-white rounded-full flex items-center justify-center text-[9px] sm:text-[10px] font-display font-bold shadow-sm border border-sand-200">
                            <span className={config.accentText}>{value}</span>
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 sm:gap-2 mb-0.5">
                        <h4 className={`font-display font-bold text-sm sm:text-base truncate ${unlocked ? 'text-ink-800' : 'text-ink-400'}`}>
                            {title}
                        </h4>
                        {unlocked && (
                            <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 text-claude-400 flex-shrink-0 animate-breathe" />
                        )}
                    </div>
                    {description && (
                        <p className={`text-[10px] sm:text-xs font-body ${unlocked ? 'text-ink-400' : 'text-ink-300'}`}>
                            {description}
                        </p>
                    )}
                </div>

                {!unlocked && (
                    <div className="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-sand-100 border border-sand-200 flex items-center justify-center">
                        <span className="text-[10px] sm:text-xs text-ink-300">🔒</span>
                    </div>
                )}
            </div>
        </div>
    );
};
