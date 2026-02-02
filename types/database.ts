// Database types for Supabase (auto-generated structure)
// This defines the shape of our Supabase tables

export interface Database {
    public: {
        Tables: {
            users: {
                Row: {
                    id: string;
                    firebase_uid: string;
                    name: string | null;
                    email: string | null;
                    photo_url: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    firebase_uid: string;
                    name?: string | null;
                    email?: string | null;
                    photo_url?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    firebase_uid?: string;
                    name?: string | null;
                    email?: string | null;
                    photo_url?: string | null;
                    updated_at?: string;
                };
            };
            user_goals: {
                Row: {
                    id: string;
                    user_id: string;
                    goal_type: string;
                    goal_label: string;
                    motivation: string | null;
                    target_value: number | null;
                    is_active: boolean;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    user_id: string;
                    goal_type: string;
                    goal_label: string;
                    motivation?: string | null;
                    target_value?: number | null;
                    is_active?: boolean;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    goal_type?: string;
                    goal_label?: string;
                    motivation?: string | null;
                    target_value?: number | null;
                    is_active?: boolean;
                    updated_at?: string;
                };
            };
            workout_sessions: {
                Row: {
                    id: string;
                    user_id: string;
                    workout_type: string | null;
                    duration_seconds: number | null;
                    completed: boolean;
                    exercises: any;
                    mood_before: string | null;
                    mood_after: string | null;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    user_id: string;
                    workout_type?: string | null;
                    duration_seconds?: number | null;
                    completed?: boolean;
                    exercises?: any;
                    mood_before?: string | null;
                    mood_after?: string | null;
                    created_at?: string;
                };
                Update: {
                    workout_type?: string | null;
                    duration_seconds?: number | null;
                    completed?: boolean;
                    exercises?: any;
                    mood_before?: string | null;
                    mood_after?: string | null;
                };
            };
            habit_streaks: {
                Row: {
                    id: string;
                    user_id: string;
                    habit_type: string;
                    current_streak: number;
                    longest_streak: number;
                    last_activity_date: string | null;
                    break_count: number;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    user_id: string;
                    habit_type: string;
                    current_streak?: number;
                    longest_streak?: number;
                    last_activity_date?: string | null;
                    break_count?: number;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    current_streak?: number;
                    longest_streak?: number;
                    last_activity_date?: string | null;
                    break_count?: number;
                    updated_at?: string;
                };
            };
            user_memories: {
                Row: {
                    id: string;
                    user_id: string;
                    memory_type: string;
                    content: string;
                    embedding: number[] | null;
                    importance_score: number;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    user_id: string;
                    memory_type: string;
                    content: string;
                    embedding?: number[] | null;
                    importance_score?: number;
                    created_at?: string;
                };
                Update: {
                    memory_type?: string;
                    content?: string;
                    embedding?: number[] | null;
                    importance_score?: number;
                };
            };
            scheduled_events: {
                Row: {
                    id: string;
                    user_id: string;
                    google_event_id: string | null;
                    event_type: string;
                    title: string;
                    scheduled_at: string;
                    completed: boolean;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    user_id: string;
                    google_event_id?: string | null;
                    event_type: string;
                    title: string;
                    scheduled_at: string;
                    completed?: boolean;
                    created_at?: string;
                };
                Update: {
                    google_event_id?: string | null;
                    event_type?: string;
                    title?: string;
                    scheduled_at?: string;
                    completed?: boolean;
                };
            };
            google_integrations: {
                Row: {
                    user_id: string;
                    refresh_token: string;
                    scope: string | null;
                    calendar_enabled: boolean;
                    fit_enabled: boolean;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    user_id: string;
                    refresh_token: string;
                    scope?: string | null;
                    calendar_enabled?: boolean;
                    fit_enabled?: boolean;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    refresh_token?: string;
                    scope?: string | null;
                    calendar_enabled?: boolean;
                    fit_enabled?: boolean;
                    updated_at?: string;
                };
            };
        };
        Views: {};
        Functions: {
            match_memories: {
                Args: {
                    query_embedding: number[];
                    match_threshold: number;
                    match_count: number;
                    p_user_id: string;
                };
                Returns: {
                    id: string;
                    content: string;
                    similarity: number;
                }[];
            };
        };
        Enums: {};
    };
}
