import React, { useState, useMemo } from 'react';
import { Button } from '../ui/Button';
import {
    Dumbbell, Activity, Flame, ChevronRight, Layers, Watch, BarChart,
    Brain, Leaf, Heart, Zap, Timer, Moon, Sun, Sparkles, Wind
} from 'lucide-react';

// Icon mapping for dynamic categories
const ICON_MAP: Record<string, any> = {
    'dumbbell': Dumbbell, 'activity': Activity, 'flame': Flame, 'fire': Flame,
    'layers': Layers, 'watch': Watch, 'chart': BarChart, 'brain': Brain,
    'leaf': Leaf, 'heart': Heart, 'bolt': Zap, 'zap': Zap, 'timer': Timer,
    'moon': Moon, 'sun': Sun, 'sparkles': Sparkles, 'wind': Wind
};

const GRADIENT_MAP: Record<string, { gradient: string; color: string; active: string; border: string }> = {
    'dumbbell': { gradient: 'from-purple-100 to-purple-50', color: 'text-purple-500', active: 'from-purple-500 to-purple-600', border: 'border-purple-200/50' },
    'activity': { gradient: 'from-teal-100 to-teal-50', color: 'text-teal-500', active: 'from-teal-500 to-teal-600', border: 'border-teal-200/50' },
    'flame': { gradient: 'from-claude-100 to-claude-50', color: 'text-claude-600', active: 'from-claude-500 to-claude-600', border: 'border-claude-200/50' },
    'fire': { gradient: 'from-claude-100 to-claude-50', color: 'text-claude-600', active: 'from-claude-500 to-claude-600', border: 'border-claude-200/50' },
    'brain': { gradient: 'from-indigo-100 to-indigo-50', color: 'text-indigo-500', active: 'from-indigo-500 to-indigo-600', border: 'border-indigo-200/50' },
    'leaf': { gradient: 'from-emerald-100 to-emerald-50', color: 'text-emerald-500', active: 'from-emerald-500 to-emerald-600', border: 'border-emerald-200/50' },
    'heart': { gradient: 'from-pink-100 to-pink-50', color: 'text-pink-500', active: 'from-pink-500 to-pink-600', border: 'border-pink-200/50' },
    'moon': { gradient: 'from-indigo-100 to-indigo-50', color: 'text-indigo-400', active: 'from-indigo-400 to-indigo-500', border: 'border-indigo-200/50' },
    'sun': { gradient: 'from-amber-100 to-amber-50', color: 'text-amber-500', active: 'from-amber-500 to-amber-600', border: 'border-amber-200/50' },
    'wind': { gradient: 'from-sky-100 to-sky-50', color: 'text-sky-500', active: 'from-sky-500 to-sky-600', border: 'border-sky-200/50' },
    'sparkles': { gradient: 'from-purple-100 to-purple-50', color: 'text-purple-500', active: 'from-purple-500 to-purple-600', border: 'border-purple-200/50' },
    'default': { gradient: 'from-sand-100 to-sand-50', color: 'text-ink-500', active: 'from-ink-500 to-ink-600', border: 'border-sand-200/50' }
};

// Category definition from Gemini
interface CategoryOption {
    id: string;
    label: string;
    icon?: string;
}

interface Category {
    id: string;
    label: string;
    options: CategoryOption[];
    default?: string;
    type?: 'icons' | 'pills' | 'buttons'; // Display type
}

interface SessionBuilderProps {
    title?: string;
    subtitle?: string;
    categories?: Category[];
    submitLabel?: string;
    onGenerate: (params: Record<string, string>) => void;
    // Live Mode Integration
    isLiveMode?: boolean;
    onLiveSubmit?: (params: Record<string, string>) => void;
}

// NO defaults - Gemini MUST provide categories dynamically
export const WorkoutBuilder: React.FC<SessionBuilderProps> = React.memo(({
    title = "Design Session",
    subtitle = "Customize your experience",
    categories = [],
    submitLabel = "Begin Session",
    onGenerate,
    isLiveMode = false,
    onLiveSubmit
}) => {
    // Initialize selections from category defaults
    const initialSelections = useMemo(() => {
        const selections: Record<string, string> = {};
        categories.forEach(cat => {
            selections[cat.id] = cat.default || cat.options[0]?.id || '';
        });
        return selections;
    }, [categories]);

    const [selections, setSelections] = useState<Record<string, string>>(initialSelections);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleSelect = (categoryId: string, optionId: string) => {
        setSelections(prev => ({ ...prev, [categoryId]: optionId }));
    };

    const handleGenerate = () => {
        setIsGenerating(true);
        setTimeout(() => {
            // If in Live Mode and handler provided, route through Live Mode
            if (isLiveMode && onLiveSubmit) {
                onLiveSubmit(selections);
            } else {
                onGenerate(selections);
            }
        }, 400);
    };

    // Empty state if no categories provided
    if (categories.length === 0) {
        return (
            <div className="bg-white/90 backdrop-blur-sm p-5 sm:p-7 rounded-3xl sm:rounded-4xl shadow-soft-lg w-full max-w-sm animate-slide-up-fade border border-sand-200 overflow-hidden relative">
                <div className="text-center py-8">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-sand-100 flex items-center justify-center animate-pulse">
                        <Layers className="w-6 h-6 text-ink-300" />
                    </div>
                    <p className="text-sm text-ink-400">Zen is designing your session...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white/90 backdrop-blur-sm p-5 sm:p-7 rounded-3xl sm:rounded-4xl shadow-soft-lg w-full max-w-sm animate-slide-up-fade border border-sand-200 overflow-hidden relative">

            <div className="absolute top-0 right-0 w-36 sm:w-48 h-36 sm:h-48 bg-gradient-radial from-claude-100/30 to-transparent rounded-full blur-3xl -mr-16 sm:-mr-20 -mt-16 sm:-mt-20 pointer-events-none"></div>

            {/* Header */}
            <div className="flex items-center space-x-3 sm:space-x-4 mb-5 sm:mb-7 relative z-10">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-claude-100 to-claude-50 border border-claude-200/50 flex items-center justify-center">
                    <Layers className="w-5 h-5 sm:w-6 sm:h-6 text-claude-600" />
                </div>
                <div>
                    <h3 className="font-display font-bold text-ink-800 text-base sm:text-lg leading-tight">{title}</h3>
                    <p className="text-[10px] sm:text-xs text-ink-400 font-body">{subtitle}</p>
                </div>
            </div>

            {/* Dynamic Categories */}
            <div className="space-y-5 sm:space-y-7 relative z-10">
                {categories.map((category) => (
                    <div key={category.id} className="space-y-2 sm:space-y-3">
                        <label className="text-[9px] sm:text-[10px] font-display font-bold text-ink-400 uppercase tracking-widest pl-1">
                            {category.label}
                        </label>

                        {/* Icon-based options (for focus categories) */}
                        {category.type === 'icons' || category.options.some(opt => opt.icon) ? (
                            <div className={`grid gap-2 sm:gap-3`} style={{ gridTemplateColumns: `repeat(${Math.min(category.options.length, 3)}, 1fr)` }}>
                                {category.options.map((option) => {
                                    const isSelected = selections[category.id] === option.id;
                                    const iconKey = option.icon?.toLowerCase() || 'activity';
                                    const Icon = ICON_MAP[iconKey] || Activity;
                                    const styles = GRADIENT_MAP[iconKey] || GRADIENT_MAP.default;

                                    return (
                                        <button
                                            key={option.id}
                                            onClick={() => handleSelect(category.id, option.id)}
                                            className={`
                                                group flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl sm:rounded-2xl transition-all duration-300 border min-h-[72px] sm:min-h-[84px]
                                                ${isSelected
                                                    ? `bg-gradient-to-br ${styles.active} text-white shadow-md border-transparent`
                                                    : `bg-gradient-to-br ${styles.gradient} ${styles.color} ${styles.border} hover:scale-105`}
                                            `}
                                        >
                                            <Icon className={`w-5 h-5 sm:w-6 sm:h-6 mb-1 ${isSelected ? 'text-white' : ''}`} />
                                            <span className={`text-[10px] sm:text-xs font-display font-bold ${isSelected ? 'text-white' : 'text-ink-600'}`}>
                                                {option.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            /* Pill-based options (for levels, durations, etc.) */
                            <div className="flex flex-wrap gap-2">
                                {category.options.map((option) => {
                                    const isSelected = selections[category.id] === option.id;
                                    return (
                                        <button
                                            key={option.id}
                                            onClick={() => handleSelect(category.id, option.id)}
                                            className={`
                                                px-4 py-2 rounded-full text-xs sm:text-sm font-display font-bold transition-all duration-200 border
                                                ${isSelected
                                                    ? 'bg-ink-800 text-white border-ink-800'
                                                    : 'bg-white text-ink-600 border-sand-200 hover:border-ink-300'}
                                            `}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Submit Button */}
            <div className="mt-6 sm:mt-8 relative z-10">
                <Button
                    onClick={handleGenerate}
                    className={`w-full rounded-xl sm:rounded-2xl group transition-all duration-300 ${isGenerating ? 'scale-[0.98] opacity-90' : ''}`}
                    variant="primary"
                    size="lg"
                    disabled={isGenerating}
                >
                    {isGenerating ? 'Preparing...' : submitLabel}
                    {!isGenerating && <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 ml-1 group-hover:translate-x-1 transition-transform" />}
                </Button>
            </div>
        </div>
    );
});

// Display name for debugging
WorkoutBuilder.displayName = 'WorkoutBuilder';