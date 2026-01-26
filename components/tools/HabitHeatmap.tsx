import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';

interface HeatmapDay {
    date: string;
    value: number;
}

interface HabitHeatmapProps {
    habitName?: string;
    weeks?: number;
    data?: HeatmapDay[];
}

export const HabitHeatmap: React.FC<HabitHeatmapProps> = React.memo(({
    habitName = "Activity",
    weeks = 12,
    data = []
}) => {
    // Memoize heatmap data to prevent recalculation on every render
    // Generate stable fallback data (no Math.random!)
    const heatmapData = useMemo(() => {
        if (data.length > 0) return data;

        // Generate stable empty data when no real data provided
        const days: HeatmapDay[] = [];
        for (let i = weeks * 7 - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            days.push({
                date: date.toISOString().split('T')[0],
                value: 0 // No activity when no data - stable, not random
            });
        }
        return days;
    }, [data, weeks]);

    // Memoize week groups
    const weekGroups = useMemo(() => {
        const groups: HeatmapDay[][] = [];
        for (let i = 0; i < heatmapData.length; i += 7) {
            groups.push(heatmapData.slice(i, i + 7));
        }
        return groups;
    }, [heatmapData]);

    const getIntensityClass = (value: number) => {
        if (value === 0) return 'bg-sand-100 border-sand-200';
        if (value === 1) return 'bg-claude-200 border-claude-300';
        if (value === 2) return 'bg-claude-300 border-claude-400';
        if (value === 3) return 'bg-claude-400 border-claude-500';
        return 'bg-claude-500 border-claude-600';
    };

    // Memoize computed values
    const { activeDays, activityPercentage } = useMemo(() => {
        const active = heatmapData.filter(d => d.value > 0).length;
        return {
            activeDays: active,
            activityPercentage: Math.round((active / heatmapData.length) * 100) || 0
        };
    }, [heatmapData]);

    const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    return (
        <div className="bg-white/90 backdrop-blur-sm p-4 sm:p-6 rounded-3xl sm:rounded-4xl shadow-soft-lg w-full max-w-sm animate-slide-up-fade border border-sand-200 relative overflow-hidden">

            <div className="absolute top-0 right-0 w-32 sm:w-40 h-32 sm:h-40 bg-gradient-radial from-claude-100/30 to-transparent rounded-full blur-3xl -mr-12 sm:-mr-16 -mt-12 sm:-mt-16 pointer-events-none"></div>

            <div className="flex items-center justify-between mb-4 sm:mb-6 relative z-10">
                <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-gradient-to-br from-claude-100 to-claude-50 border border-claude-200/50 flex items-center justify-center">
                        <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-claude-600" />
                    </div>
                    <div>
                        <h4 className="font-display font-bold text-ink-800 text-sm sm:text-base">{habitName} Heatmap</h4>
                        <p className="text-[10px] sm:text-xs text-ink-400 font-body">Last {weeks} weeks</p>
                    </div>
                </div>
                <div className="text-right">
                    <span className="block font-display font-bold text-claude-600 text-base sm:text-lg">{activityPercentage}%</span>
                    <span className="text-[9px] sm:text-[10px] text-ink-400 font-body uppercase tracking-wide">Active</span>
                </div>
            </div>

            <div className="relative z-10 flex">
                <div className="flex flex-col justify-between mr-1.5 sm:mr-2 pt-0.5 sm:pt-1">
                    {dayLabels.map((label, idx) => (
                        <span key={idx} className="text-[7px] sm:text-[9px] font-display font-bold text-ink-300 h-2 sm:h-3 leading-none">{label}</span>
                    ))}
                </div>

                <div className="flex gap-0.5 sm:gap-1 overflow-x-auto no-scrollbar flex-1">
                    {weekGroups.map((week, weekIdx) => (
                        <div key={weekIdx} className="flex flex-col gap-0.5 sm:gap-1">
                            {week.map((day) => (
                                <div
                                    key={day.date}
                                    className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-[2px] sm:rounded-sm border transition-all duration-200 hover:scale-125 ${getIntensityClass(day.value)}`}
                                    title={`${day.date}: ${day.value > 0 ? `Level ${day.value}` : 'No activity'}`}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-end gap-1.5 sm:gap-2 mt-3 sm:mt-4 pt-2 sm:pt-3 border-t border-sand-200 relative z-10">
                <span className="text-[8px] sm:text-[10px] text-ink-400 font-body mr-1">Less</span>
                {[0, 1, 2, 3, 4].map((level) => (
                    <div
                        key={level}
                        className={`w-2 h-2 sm:w-3 sm:h-3 rounded-[2px] sm:rounded-sm border ${getIntensityClass(level)}`}
                    />
                ))}
                <span className="text-[8px] sm:text-[10px] text-ink-400 font-body ml-1">More</span>
            </div>
        </div>
    );
});

// Display name for debugging
HabitHeatmap.displayName = 'HabitHeatmap';
