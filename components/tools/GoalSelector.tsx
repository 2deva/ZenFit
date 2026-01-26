import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Target, Zap, Heart, Activity, Flame, Trophy, CheckCircle2, Footprints, Brain, Leaf, Timer } from 'lucide-react';

interface GoalOption {
  id?: string;
  label?: string;
  description?: string;
  icon: string;
}

interface GoalSelectorProps {
  onSave: (goals: string[]) => void;
  options?: GoalOption[];
  title?: string;
  subtitle?: string;
}

const ICON_MAP: Record<string, any> = {
  'fire': Flame, 'bolt': Zap, 'heart': Heart, 'footprints': Footprints,
  'brain': Brain, 'trophy': Trophy, 'leaf': Leaf, 'timer': Timer,
  'activity': Activity, 'target': Target
};

const COLOR_MAP: Record<string, { color: string, gradient: string }> = {
  'fire': { color: "text-claude-600", gradient: "from-claude-100 to-claude-50" },
  'bolt': { color: "text-amber-500", gradient: "from-amber-100 to-amber-50" },
  'heart': { color: "text-pink-500", gradient: "from-pink-100 to-pink-50" },
  'footprints': { color: "text-purple-500", gradient: "from-purple-100 to-purple-50" },
  'brain': { color: "text-indigo-500", gradient: "from-indigo-100 to-indigo-50" },
  'trophy': { color: "text-accent-teal", gradient: "from-teal-100 to-teal-50" },
  'leaf': { color: "text-accent-green", gradient: "from-emerald-100 to-emerald-50" },
  'timer': { color: "text-ink-500", gradient: "from-sand-200 to-sand-100" },
  'activity': { color: "text-claude-600", gradient: "from-claude-100 to-claude-50" },
  'moon': { color: "text-indigo-400", gradient: "from-indigo-100 to-indigo-50" },
  'sun': { color: "text-amber-500", gradient: "from-amber-100 to-amber-50" },
  'sparkles': { color: "text-purple-500", gradient: "from-purple-100 to-purple-50" }
};

// Safety fallback ONLY if Gemini fails to provide options
// Includes both physical and mental wellness activities
const WELLNESS_FALLBACK = [
  { id: "Strength", icon: "fire", label: "Strength", description: "Build power" },
  { id: "Cardio", icon: "activity", label: "Movement", description: "Get moving" },
  { id: "Mindfulness", icon: "brain", label: "Mindfulness", description: "Mental clarity" },
  { id: "Breathing", icon: "leaf", label: "Breathing", description: "Calm & focus" },
];

// Gemini SHOULD generate options - fallback is safety net only
export const GoalSelector: React.FC<GoalSelectorProps> = ({
  onSave,
  options,
  title = 'Focus Areas',
  subtitle = 'Select what matters most'
}) => {
  const [selected, setSelected] = useState<string[]>([]);

  // Use Gemini options if provided, otherwise use wellness fallback
  const displayOptions = (options && options.length > 0)
    ? options.map(opt => ({ ...opt, id: opt.id || opt.label || 'unknown_goal' }))
    : WELLNESS_FALLBACK;

  const toggleGoal = (goal: string) => {
    if (selected.includes(goal)) {
      setSelected(selected.filter(g => g !== goal));
    } else {
      setSelected([...selected, goal]);
    }
  };

  return (
    <div className="bg-white/90 backdrop-blur-sm p-5 sm:p-7 rounded-3xl sm:rounded-4xl shadow-soft-lg w-full max-w-sm animate-slide-up-fade border border-sand-200 relative overflow-hidden">

      <div className="absolute top-0 right-0 w-24 sm:w-32 h-24 sm:h-32 bg-gradient-radial from-claude-100/40 to-transparent rounded-full blur-2xl -mr-8 sm:-mr-12 -mt-8 sm:-mt-12 pointer-events-none"></div>

      <div className="mb-5 sm:mb-7 relative z-10">
        <h3 className="font-display font-bold text-ink-800 text-lg sm:text-xl tracking-tight">{title}</h3>
        <p className="text-ink-400 text-xs sm:text-sm mt-1 font-body">{subtitle}</p>
      </div>

      {displayOptions.length === 0 ? (
        <div className="text-center py-8 relative z-10">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-sand-100 flex items-center justify-center animate-pulse">
            <Target className="w-6 h-6 text-ink-300" />
          </div>
          <p className="text-sm text-ink-400">Zen is thinking about your goals...</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8 relative z-10">
          {displayOptions.map((option) => {
            const isSelected = selected.includes(option.id);
            const iconKey = option.icon.toLowerCase();
            const Icon = ICON_MAP[iconKey] || Activity;
            const styles = COLOR_MAP[iconKey] || { color: "text-claude-600", gradient: "from-claude-100 to-claude-50" };
            const displayText = option.label || option.id;

            return (
              <button
                key={option.id}
                onClick={() => toggleGoal(option.id)}
                className={`
                group relative flex flex-col items-start p-4 sm:p-5 rounded-2xl sm:rounded-3xl transition-all duration-300 h-28 sm:h-36 justify-between border text-left overflow-hidden
                ${isSelected
                    ? 'border-claude-400/50 bg-claude-50 shadow-glow-claude'
                    : 'border-sand-200 bg-white hover:bg-sand-50 hover:border-sand-300'}
              `}
              >
                {isSelected && (
                  <div className="absolute inset-0 bg-gradient-to-br from-claude-100/50 to-transparent pointer-events-none"></div>
                )}

                <div className="flex w-full justify-between items-start relative z-10">
                  <div className={`p-2 sm:p-3 rounded-xl sm:rounded-2xl bg-gradient-to-br ${styles.gradient} border border-sand-200/50 ${styles.color} transition-transform duration-300 group-hover:scale-110`}>
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  {isSelected && <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-claude-600 animate-in fade-in zoom-in duration-200" />}
                </div>
                <div className="flex flex-col relative z-10">
                  <span className={`font-display text-xs sm:text-sm font-bold transition-colors ${isSelected ? 'text-claude-700' : 'text-ink-700'}`}>
                    {displayText}
                  </span>
                  {option.description && (
                    <span className={`text-[10px] sm:text-[11px] font-body leading-tight mt-0.5 ${isSelected ? 'text-claude-500' : 'text-ink-400'}`}>
                      {option.description}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <Button onClick={() => onSave(selected)} disabled={selected.length === 0 || displayOptions.length === 0} variant="primary" className="w-full rounded-xl sm:rounded-2xl relative z-10" size="lg">
        Continue
      </Button>
    </div>
  );
};