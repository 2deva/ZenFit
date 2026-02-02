import React, { useEffect } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useLiveSessionContext } from '../contexts/LiveSessionContext';
import { useAuth } from '../contexts/AuthContext';
import { getFitnessData } from '../services/fitnessService';
import {
    syncUserProfile, getUserGoals, getStepGoalForUser,
    getOnboardingState, createOnboardingState
} from '../services/supabaseService';
import { getFullUserContext } from '../services/userContextService';
import { loadGuidanceState, loadAutoReconnectState } from '../services/persistenceService';
import { tryCalendarNudge } from '../services/calendarNudgeService';
import { TIMING } from '../constants/app';
import { LiveStatus } from '../types';
import { supabase, isSupabaseConfigured } from '../supabaseConfig';

export const GlobalEffects: React.FC = () => {
    const { user } = useAuth();
    const {
        setSupabaseUserId,
        setUserProfile,
        setMemoryContext,
        setOnboardingState,
        setUserLocation,
        setFitnessStats,
        activeWorkoutMessageId,
        supabaseUserId
    } = useAppContext();

    const { liveStatus, connectLive } = useLiveSessionContext();

    // Initialize location
    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setUserLocation({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude
                    });
                },
                (err) => console.log("Location access denied or error", err)
            );
        }
    }, [setUserLocation]);

    // Initialize fitness stats (merge personalized step goal when user is present)
    useEffect(() => {
        const fetchStats = async () => {
            const stats = await getFitnessData();
            if (supabaseUserId) {
                const stepGoal = await getStepGoalForUser(supabaseUserId);
                setFitnessStats({ ...stats, stepsGoal });
            } else {
                setFitnessStats(stats);
            }
        };
        fetchStats();
        const interval = setInterval(fetchStats, TIMING.FITNESS_STATS_REFRESH);

        return () => clearInterval(interval);
    }, [setFitnessStats, supabaseUserId]);

    // Sync user with Supabase
    useEffect(() => {
        const syncUser = async () => {
            if (user) {
                const supaUser = await syncUserProfile(
                    user.uid,
                    user.displayName,
                    user.email,
                    user.photoURL
                );

                if (supaUser) {
                    setSupabaseUserId(supaUser.id);

                    const goals = await getUserGoals(supaUser.id);
                    if (goals.length > 0) {
                        setUserProfile({ goals: goals.map(g => g.goal_label) });
                    }

                    const context = await getFullUserContext(supaUser.id);
                    setMemoryContext(context);

                    let oState = await getOnboardingState(supaUser.id);
                    if (!oState) {
                        oState = await createOnboardingState(supaUser.id);
                    }
                    setOnboardingState(oState);
                    tryCalendarNudge(supaUser.id, oState).catch(() => {});
                }
            } else {
                setSupabaseUserId(null);
                setMemoryContext(null);
                setOnboardingState(null);
            }
        };

        syncUser();
    }, [user, setSupabaseUserId, setUserProfile, setMemoryContext, setOnboardingState]);

    // Real-time subscription for goals (cross-device sync)
    useEffect(() => {
        if (!supabaseUserId || !isSupabaseConfigured) return;

        const channel = supabase
            .channel(`user_goals:${supabaseUserId}`)
            .on('postgres_changes', {
                event: '*', // INSERT, UPDATE, DELETE
                schema: 'public',
                table: 'user_goals',
                filter: `user_id=eq.${supabaseUserId}`
            }, async (payload: any) => {
                // Reload goals when they change
                const goals = await getUserGoals(supabaseUserId);
                if (goals.length > 0) {
                    setUserProfile({ goals: goals.map(g => g.goal_label) });
                } else {
                    // If all goals deleted, clear profile goals
                    setUserProfile(prev => ({ ...prev, goals: [] }));
                }
            })
            .subscribe((status, err) => {
                if (err) {
                    console.error('User goals realtime subscription error:', err);
                }
            });

        return () => {
            supabase.removeChannel(channel).catch(console.error);
        };
    }, [supabaseUserId, setUserProfile]);

    // Real-time subscription for onboarding state (cross-device sync)
    useEffect(() => {
        if (!supabaseUserId || !isSupabaseConfigured) return;

        const channel = supabase
            .channel(`onboarding_state:${supabaseUserId}`)
            .on('postgres_changes', {
                event: '*', // INSERT, UPDATE, DELETE
                schema: 'public',
                table: 'user_onboarding_state',
                filter: `user_id=eq.${supabaseUserId}`
            }, async () => {
                // Reload onboarding state when it changes
                let oState = await getOnboardingState(supabaseUserId);
                if (!oState) {
                    oState = await createOnboardingState(supabaseUserId);
                }
                setOnboardingState(oState);
            })
            .subscribe((status, err) => {
                if (err) {
                    console.error('Onboarding state realtime subscription error:', err);
                }
            });

        return () => {
            supabase.removeChannel(channel).catch(console.error);
        };
    }, [supabaseUserId, setOnboardingState]);

    // Auto-reconnect Live Mode
    useEffect(() => {
        const checkAndAutoReconnect = async () => {
            if (liveStatus !== LiveStatus.DISCONNECTED) return;

            try {
                // const { loadGuidanceState, loadAutoReconnectState } = await import('../services/persistenceService'); // Using static import

                const savedGuidance = await loadGuidanceState(supabaseUserId || undefined, activeWorkoutMessageId || undefined);
                const autoReconnect = loadAutoReconnectState();

                if (autoReconnect && autoReconnect.shouldAutoReconnect) {
                    console.log('App: Auto-reconnecting Live Mode due to auto-reconnect flag');
                    connectLive();
                }
            } catch (e) {
                console.warn('App: Failed to check for auto-reconnect:', e);
            }
        };

        const timeout = setTimeout(checkAndAutoReconnect, 1000);
        return () => clearTimeout(timeout);
    }, [liveStatus, supabaseUserId, activeWorkoutMessageId, connectLive]);

    return null;
};
