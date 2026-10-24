import type { LifeContextGoalType } from '../types';

export function normalizeGoalType(rawType: string | null | undefined): LifeContextGoalType {
    if (!rawType) return 'other';
    const t = rawType.toLowerCase();

    if (t.includes('strength') || t.includes('muscle') || t.includes('resistance')) return 'strength';
    if (t.includes('cardio') || t.includes('run') || t.includes('walk') || t.includes('hiit')) return 'cardio';
    if (t.includes('mobility') || t.includes('flex') || t.includes('yoga') || t.includes('stretch')) return 'mobility';
    if (t.includes('mind') || t.includes('meditat') || t.includes('focus')) return 'mindfulness';
    if (t.includes('sleep')) return 'sleep';
    if (t.includes('stress') || t.includes('anxiety') || t.includes('calm')) return 'stress';
    if (t.includes('recover') || t.includes('rest')) return 'recovery';

    return 'other';
}

