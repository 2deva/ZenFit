import React, { useEffect } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useLiveSessionContext } from '../contexts/LiveSessionContext';
import { useAuth } from '../contexts/AuthContext';
import { getFitnessData } from '../services/fitnessService';
import {
    syncUserProfile, getUserGoals,
    getOnboardingState, createOnboardingState
} from '../services/supabaseService';
import { getFullUserContext } from '../services/userContextService';
import { loadGuidanceState, loadAutoReconnectState } from '../services/persistenceService';
import { TIMING } from '../constants/app';
import { LiveStatus } from '../types';

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

    // Initialize fitness stats
    useEffect(() => {
        const fetchStats = async () => {
            const stats = await getFitnessData();
            setFitnessStats(stats);
        };
        fetchStats();
        const interval = setInterval(fetchStats, TIMING.FITNESS_STATS_REFRESH);

        return () => clearInterval(interval);
    }, [setFitnessStats]);

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
                }
            } else {
                setSupabaseUserId(null);
                setMemoryContext(null);
                setOnboardingState(null);
            }
        };

        syncUser();
    }, [user, setSupabaseUserId, setUserProfile, setMemoryContext, setOnboardingState]);

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
