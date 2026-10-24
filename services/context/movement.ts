import { getFitnessData, getFitnessDataLast7Days } from '../fitnessService';
import { STORAGE_KEYS } from '../../constants/app';
import type { LifeContextMovementBaseline } from '../../types';

export async function getMovementBaseline(userId: string | null): Promise<LifeContextMovementBaseline> {
    try {
        const fitnessStats = await getFitnessData();
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.FITNESS_TOKEN) : null;
        const useFit = fitnessStats.dataSource === 'google_fit';

        if (!useFit) return {
            source: 'none', avgDailySteps: undefined, avgDailyActiveMinutes: undefined,
            last7Days: [], patternSummary: 'Movement measurements are unavailable. Ask about typical activity instead of treating sample data as real movement.'
        };

        let last7Days: Array<{ date: string; steps: number; activeMinutes: number }>;
        let avgDailySteps: number;
        let avgDailyActiveMinutes: number;

        if (useFit && token) {
            const realLast7 = await getFitnessDataLast7Days();
            if (realLast7.length > 0) {
                last7Days = realLast7;
                const sumSteps = realLast7.reduce((s, d) => s + d.steps, 0);
                const sumMins = realLast7.reduce((s, d) => s + d.activeMinutes, 0);
                avgDailySteps = Math.round(sumSteps / realLast7.length);
                avgDailyActiveMinutes = Math.round(sumMins / realLast7.length);
            } else {
                last7Days = todayMeasurement(fitnessStats.steps, fitnessStats.activeMinutes);
                avgDailySteps = fitnessStats.steps;
                avgDailyActiveMinutes = fitnessStats.activeMinutes;
            }
        } else {
            last7Days = todayMeasurement(fitnessStats.steps, fitnessStats.activeMinutes);
            avgDailySteps = fitnessStats.steps;
            avgDailyActiveMinutes = fitnessStats.activeMinutes;
        }

        let patternSummary = '';
        if (avgDailySteps === 0 && avgDailyActiveMinutes === 0) {
            patternSummary = 'Movement data unavailable or very low today. Ask the user briefly about their typical activity level before assuming sedentary behavior.';
        } else if (avgDailySteps < 4000) {
            patternSummary = 'Currently shows low daily movement (<4k steps). Favor gentle, achievable suggestions and celebrate any movement.';
        } else if (avgDailySteps < 8000) {
            patternSummary = 'Moderate daily movement (~4k–8k steps). You can nudge slightly more activity or focus on specific goals.';
        } else {
            patternSummary = 'High daily movement (>=8k steps). Consider emphasizing strength, mobility, or recovery rather than just more steps.';
        }

        return {
            source: useFit ? 'google_fit' : 'none',
            avgDailySteps,
            avgDailyActiveMinutes,
            last7Days,
            patternSummary
        };
    } catch (e) {
        console.warn('Movement baseline: falling back due to error or missing fitness data:', e);

        const today = new Date();
        const last7Days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(today);
            d.setDate(d.getDate() - (6 - i));
            return {
                date: d.toISOString().split('T')[0],
                steps: 0,
                activeMinutes: 0
            };
        });

        return {
            source: 'none',
            avgDailySteps: undefined,
            avgDailyActiveMinutes: undefined,
            last7Days,
            patternSummary: 'Movement data is currently unavailable. Ask the user a quick question about how much they move in a typical day before making strong assumptions.'
        };
    }
}

function todayMeasurement(steps: number, activeMinutes: number): Array<{ date: string; steps: number; activeMinutes: number }> {
    return [{ date: new Date().toISOString().split('T')[0], steps, activeMinutes }];
}

/**
 * Derive a coarse schedule profile from onboarding preferences and upcoming
 * scheduled events. This focuses on \"when\" to suggest activities rather than
 * exposing raw calendar details.
 */
