import { isPublicSupabaseKey, createFirebaseAccessTokenProvider } from './utils/supabaseAuth';
// Supabase Configuration for Zenfit
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Check if Supabase is properly configured
export const isSupabaseConfigured = !!(supabaseUrl && isPublicSupabaseKey(supabaseAnonKey));

// Create client only if properly configured, otherwise create a dummy client
let supabaseClient: SupabaseClient;

if (isSupabaseConfigured) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        ...(import.meta.env.VITE_SUPABASE_AUTH_MODE === 'firebase' ? {
            accessToken: createFirebaseAccessTokenProvider(async () => (await import('./firebaseConfig')).auth.currentUser)
        } : {}),
        realtime: {
            params: {
                eventsPerSecond: 2
            }
        }
    });
} else {
    console.warn(
        '⚠️ Supabase is not properly configured. Please check your .env file.',
        '\n  - VITE_SUPABASE_URL should be your Supabase project URL',
        '\n  - VITE_SUPABASE_ANON_KEY must be a publishable key or an anon-role JWT',
        '\n  You can find these in your Supabase Dashboard > Settings > API'
    );
    // Create a mock client that won't crash but won't work either
    supabaseClient = createClient(
        'https://placeholder.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NDk4NjIxNDIsImV4cCI6MTk2NTQzODE0Mn0.placeholder'
    );
}

export const supabase = supabaseClient;

// Export URL for external use
export const SUPABASE_URL = supabaseUrl;
