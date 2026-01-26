import React, { useMemo } from 'react';
import { Flame, TrendingUp, Calendar } from 'lucide-react';

interface StreakDay {
    date: string;
    completed: boolean;
}

interface StreakTimelineProps {
    habitName?: string;
    currentStreak: number;
    longestStreak: number;
    days?: StreakDay[];
}

export const StreakTimeline: React.FC<StreakTimelineProps> = React.memo(({
    habitName = "Workout",
    currentStreak = 0,
    longestStreak = 0,
    days = []
}) => {
    // Memoize timeline days to prevent recalculating on every render
    // Use stable fallback instead of Math.random()
    const timelineDays = useMemo(() => {
        if (days.length > 0) return days.slice(-14);

        // Generate stable fallback based on currentStreak (no randomness!)
        return Array.from({ length: 14 }, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (13 - i));
            // Mark the most recent `currentStreak` days as completed
            const daysFromEnd = 13 - i;
            return {
                date: date.toISOString().split('T')[0],
                completed: daysFromEnd < currentStreak
            };
        });
    }, [days, currentStreak]);

    const formatDay = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0);
    };

    const isToday = (dateStr: string) => {
        return new Date(dateStr).toDateString() === new Date().toDateString();
    };

    // Memoize computed values
    const thisWeekCount = useMemo(() =>
        timelineDays.slice(-7).filter(d => d.completed).length
        , [timelineDays]);

    return (
        <div className="bg-white/90 backdrop-blur-sm p-4 sm:p-6 rounded-3xl sm:rounded-4xl shadow-soft-lg w-full max-w-sm animate-slide-up-fade border border-sand-200 relative overflow-hidden">

            <div className="absolute top-0 right-0 w-32 sm:w-40 h-32 sm:h-40 bg-gradient-radial from-claude-200/30 to-transparent rounded-full blur-3xl -mr-12 sm:-mr-16 -mt-12 sm:-mt-16 pointer-events-none"></div>

            <div className="flex items-center justify-between mb-4 sm:mb-6 relative z-10">
                <div className="flex items-center gap-2 sm:gap-3">
                    <div className="relative">
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center border ${currentStreak > 0 ? 'bg-gradient-to-br from-claude-500 to-claude-600 border-claude-400/50 text-white' : 'bg-sand-100 border-sand-200 text-ink-400'}`}>
                            <Flame className={`w-5 h-5 sm:w-6 sm:h-6 ${currentStreak > 0 ? 'fill-white' : ''}`} />
                        </div>
                        {currentStreak > 0 && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-accent-teal rounded-full flex items-center justify-center text-[8px] sm:text-[10px] font-bold text-white shadow-sm">
                                {currentStreak}
                            </div>
                        )}
                    </div>
                    <div>
                        <h4 className="font-display font-bold text-ink-800 text-base sm:text-lg">{habitName} Streak</h4>
                        <p className="text-[10px] sm:text-xs text-ink-400 font-body">
                            {currentStreak > 0 ? `${currentStreak} day${currentStreak > 1 ? 's' : ''} and counting!` : 'Start your streak today'}
                        </p>
                    </div>
                </div>
            </div>

            <div className="relative z-10">
                <div className="flex items-center justify-between gap-0.5 sm:gap-1 mb-1.5 sm:mb-2">
                    {timelineDays.map((day) => (
                        <div key={day.date} className="flex flex-col items-center">
                            <div
                                className={`
                  w-4 h-4 sm:w-5 sm:h-5 rounded-full transition-all duration-300 border-2
                  ${day.completed
                                        ? 'bg-gradient-to-br from-claude-500 to-claude-600 border-claude-400 shadow-sm'
                                        : 'bg-sand-100 border-sand-200'}
                  ${isToday(day.date) ? 'ring-2 ring-claude-300 ring-offset-1 sm:ring-offset-2 ring-offset-white' : ''}
                `}
                            >
                                {day.completed && (
                                    <div className="w-full h-full flex items-center justify-center text-white text-[6px] sm:text-[8px]">✓</div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex items-center justify-between gap-0.5 sm:gap-1">
                    {timelineDays.map((day) => (
                        <span key={`label-${day.date}`} className="text-[7px] sm:text-[9px] text-ink-300 font-display font-bold w-4 sm:w-5 text-center">
                            {formatDay(day.date)}
                        </span>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-between mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-sand-200 relative z-10">
                <div className="flex items-center gap-1.5 sm:gap-2">
                    <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent-teal" />
                    <div>
                        <span className="text-[10px] sm:text-xs text-ink-400 font-body">Best</span>
                        <span className="block font-display font-bold text-ink-700 text-xs sm:text-sm">{longestStreak} days</span>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                    <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-claude-500" />
                    <div className="text-right">
                        <span className="text-[10px] sm:text-xs text-ink-400 font-body">This week</span>
                        <span className="block font-display font-bold text-ink-700 text-xs sm:text-sm">
                            {thisWeekCount}/7
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
});

// Display name for debugging
StreakTimeline.displayName = 'StreakTimeline';
