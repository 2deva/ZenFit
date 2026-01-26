-- ============================================
-- Zenfit Security Hardening: Row Level Security
-- ============================================

-- Ensure RLS is enabled on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_events ENABLE ROW LEVEL SECURITY;

-- Drop existing permissive policies (if any)
DROP POLICY IF EXISTS "Allow all operations" ON users;
DROP POLICY IF EXISTS "Allow all operations" ON user_goals;
DROP POLICY IF EXISTS "Allow all operations" ON workout_sessions;
DROP POLICY IF EXISTS "Allow all operations" ON habit_streaks;
DROP POLICY IF EXISTS "Allow all operations" ON user_memories;
DROP POLICY IF EXISTS "Allow all operations" ON scheduled_events;

-- ============================================
-- Users Table Policies
-- ============================================
-- Users can view and edit their own profile
CREATE POLICY "Users can view own profile" 
ON users FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
ON users FOR UPDATE 
USING (auth.uid() = id);

-- Allow inserting own user row (triggered by Auth hook usually, but good to have)
CREATE POLICY "Users can insert own profile" 
ON users FOR INSERT 
WITH CHECK (auth.uid() = id);

-- ============================================
-- User Goals Policies
-- ============================================
CREATE POLICY "Users can view own goals" 
ON user_goals FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own goals" 
ON user_goals FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own goals" 
ON user_goals FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own goals" 
ON user_goals FOR DELETE 
USING (auth.uid() = user_id);

-- ============================================
-- Workout Sessions Policies
-- ============================================
CREATE POLICY "Users can view own workouts" 
ON workout_sessions FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workouts" 
ON workout_sessions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workouts" 
ON workout_sessions FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own workouts" 
ON workout_sessions FOR DELETE 
USING (auth.uid() = user_id);

-- ============================================
-- Habit Streaks Policies
-- ============================================
CREATE POLICY "Users can view own streaks" 
ON habit_streaks FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own streaks" 
ON habit_streaks FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own streaks" 
ON habit_streaks FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own streaks" 
ON habit_streaks FOR DELETE 
USING (auth.uid() = user_id);

-- ============================================
-- User Memories Policies
-- ============================================
CREATE POLICY "Users can view own memories" 
ON user_memories FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own memories" 
ON user_memories FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own memories" 
ON user_memories FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own memories" 
ON user_memories FOR DELETE 
USING (auth.uid() = user_id);

-- ============================================
-- Scheduled Events Policies
-- ============================================
CREATE POLICY "Users can view own events" 
ON scheduled_events FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own events" 
ON scheduled_events FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own events" 
ON scheduled_events FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own events" 
ON scheduled_events FOR DELETE 
USING (auth.uid() = user_id);
