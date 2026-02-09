import React, { useEffect, useRef } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useAuth } from '../contexts/AuthContext';
import { getFitnessData } from '../services/fitnessService';
import {
    syncUserProfile, getUserGoals, getStepGoalForUser,
    getOnboardingState, createOnboardingState, getRecentWorkouts
} from '../services/supabaseService';
import { getFullUserContext } from '../services/userContextService';
import { loadGuidanceState, loadAutoReconnectState } from '../services/persistenceService';
import { tryCalendarNudge, RETURN_WORKOUT_PARAM, trackNudgeAction } from '../services/calendarNudgeService';
import { TIMING } from '../constants/app';
import { supabase, isSupabaseConfigured } from '../supabaseConfig';
import { useLiveSessionContext } from '../contexts/LiveSessionContext';
import { LiveStatus } from '../types';

export const GlobalEffects: React.FC = () => {
    const { user, accessToken } = useAuth();
    const {
        setSupabaseUserId,
        setUserProfile,
        setMemoryContext,
        setOnboardingState,
        setUserLocation,
        setFitnessStats,
        activeWorkoutMessageId,
        supabaseUserId,
        isMessagesInitialized,
        handleSendMessage
    } = useAppContext();

    const { liveStatus, connectLive } = useLiveSessionContext();

    // Deep link: ?start=return-workout from calendar nudge — show dynamic message based on gap
    const returnWorkoutHandledRef = useRef(false);
    const hasReturnWorkoutParam = useRef(false);

    // Build return message based on gap length (matches nudge config)
    const getReturnMessage = async (): Promise<string> => {
        if (!supabaseUserId) return "I'm ready for my return workout.";
        try {
            const recentWorkouts = await getRecentWorkouts(supabaseUserId, 14);
            const completed = recentWorkouts.filter(w => w.completed);
            if (completed.length === 0) return "I'm ready to start my first workout.";

            const today = new Date().toISOString().split('T')[0];
            const lastDate = new Date(completed[0].created_at || '').toISOString().split('T')[0];
            const daysMissed = Math.floor(
                (new Date(today).getTime() - new Date(lastDate).getTime()) / (24 * 60 * 60 * 1000)
            );

            if (daysMissed <= 2) return "I'm ready for my 10-minute return workout.";
            if (daysMissed <= 7) return "I'd like a quick 5-minute stretch.";
            return "Hey, I'm back! Let's do a quick check-in.";
        } catch {
            return "I'm ready for my return workout.";
        }
    };

    // Detect param and clean URL immediately (before any async loading)
    useEffect(() => {
        const [paramKey, paramValue] = RETURN_WORKOUT_PARAM.split('=');
        const params = new URLSearchParams(window.location.search);
        if (params.get(paramKey) !== paramValue) return;
        if (hasReturnWorkoutParam.current) return;
        hasReturnWorkoutParam.current = true;

        // Clean URL immediately
        const cleanUrl = window.location.pathname || '/';
        window.history.replaceState({}, '', cleanUrl);
    }, []);

    // Wait for messages to initialize before sending the return workout message
    // Also wait for supabaseUserId sync if user is logged in (prevents Supabase load from overwriting)
    useEffect(() => {
        if (!hasReturnWorkoutParam.current) return;
        if (!isMessagesInitialized) return;
        if (user && !supabaseUserId) return; // Wait for auth sync
        if (returnWorkoutHandledRef.current) return;
        returnWorkoutHandledRef.current = true;

        // Track that user clicked the nudge deep link (feedback loop)
        if (supabaseUserId) {
            trackNudgeAction(supabaseUserId, 'deep_link_clicked').catch(() => { });
        }

        // Send dynamic return message
        getReturnMessage().then(msg => handleSendMessage(msg));
    }, [isMessagesInitialized, user, supabaseUserId, handleSendMessage]);

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
                setFitnessStats({ ...stats, stepsGoal: stepGoal });
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
                    tryCalendarNudge(supaUser.id, oState, accessToken).catch(() => { });
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
