-- Zenfit Workout Progress Table
-- Stores in-progress workout state for cross-device sync

CREATE TABLE IF NOT EXISTS workout_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workout_id TEXT NOT NULL, -- message ID from chat
    completed_indices INTEGER[] DEFAULT '{}',
    active_idx INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, workout_id)
);

-- Index for user queries
CREATE INDEX IF NOT EXISTS idx_workout_progress_user_id ON workout_progress(user_id);

-- Index for user+workout lookup
CREATE INDEX IF NOT EXISTS idx_workout_progress_user_workout ON workout_progress(user_id, workout_id);

-- Enable RLS
ALTER TABLE workout_progress ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations (using Firebase Auth, not Supabase Auth)
-- Note: Since Zenfit uses Firebase Auth, auth.uid() is NULL
-- Security is enforced at application level by passing user_id
CREATE POLICY "Allow all operations" ON workout_progress
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Auto-cleanup old progress (optional - run as cron)
-- DELETE FROM workout_progress WHERE updated_at < NOW() - INTERVAL '7 days';
