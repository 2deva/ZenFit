export interface User {
    id: string;
    firebase_uid: string;
    name: string | null;
    email: string | null;
    photo_url: string | null;
    created_at: string;
    updated_at: string;
}

export interface UserGoal {
    id: string;
    user_id: string;
    goal_type: string;
    goal_label: string;
    motivation: string | null;
    target_value: number | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface WorkoutSession {
    id: string;
    user_id: string;
    workout_type: string | null;
    duration_seconds: number | null;
    completed: boolean;
    exercises: any;
    mood_before: string | null;
    mood_after: string | null;
    goal_ids?: string[] | null;
    created_at: string;
}

export interface HabitStreak {
    id: string;
    user_id: string;
    habit_type: string;
    current_streak: number;
    longest_streak: number;
    last_activity_date: string | null;
    break_count: number;
    created_at: string;
    updated_at: string;
}

export interface UserMemory {
    id: string;
    user_id: string;
    memory_type: string;
    content: string;
    embedding: number[] | null;
    importance_score: number;
    created_at: string;
}

export interface ScheduledEvent {
    id: string;
    user_id: string;
    google_event_id: string | null;
    event_type: string;
    title: string;
    scheduled_at: string;
    completed: boolean;
    created_at: string;
}

