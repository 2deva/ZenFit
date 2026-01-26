-- ============================================================================
-- FIX RLS POLICIES FOR FIREBASE AUTH
-- ============================================================================
-- The previous security policies required Supabase Auth (auth.uid()), which fails
-- because you are using Firebase Auth. This script reverts to permissive policies
-- that allow your application to function with the Supabase Anon Key.
-- ============================================================================

-- 1. Enable RLS (Ensure it's on)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_events ENABLE ROW LEVEL SECURITY;

-- 2. Drop Strict Policies (The ones causing "new row violates..." errors)
DROP POLICY IF EXISTS "Users can view own profile" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Users can insert own profile" ON users;
DROP POLICY IF EXISTS "Allow all operations" ON users; -- Drop old one if exists to avoid conflict

DROP POLICY IF EXISTS "Users can view own goals" ON user_goals;
DROP POLICY IF EXISTS "Users can insert own goals" ON user_goals;
DROP POLICY IF EXISTS "Users can update own goals" ON user_goals;
DROP POLICY IF EXISTS "Users can delete own goals" ON user_goals;
DROP POLICY IF EXISTS "Allow all operations" ON user_goals;

DROP POLICY IF EXISTS "Users can view own workouts" ON workout_sessions;
DROP POLICY IF EXISTS "Users can insert own workouts" ON workout_sessions;
DROP POLICY IF EXISTS "Users can update own workouts" ON workout_sessions;
DROP POLICY IF EXISTS "Users can delete own workouts" ON workout_sessions;
DROP POLICY IF EXISTS "Allow all operations" ON workout_sessions;

DROP POLICY IF EXISTS "Users can view own streaks" ON habit_streaks;
DROP POLICY IF EXISTS "Users can insert own streaks" ON habit_streaks;
DROP POLICY IF EXISTS "Users can update own streaks" ON habit_streaks;
DROP POLICY IF EXISTS "Users can delete own streaks" ON habit_streaks;
DROP POLICY IF EXISTS "Allow all operations" ON habit_streaks;

DROP POLICY IF EXISTS "Users can view own memories" ON user_memories;
DROP POLICY IF EXISTS "Users can insert own memories" ON user_memories;
DROP POLICY IF EXISTS "Users can update own memories" ON user_memories;
DROP POLICY IF EXISTS "Users can delete own memories" ON user_memories;
DROP POLICY IF EXISTS "Allow all operations" ON user_memories;

DROP POLICY IF EXISTS "Users can view own events" ON scheduled_events;
DROP POLICY IF EXISTS "Users can insert own events" ON scheduled_events;
DROP POLICY IF EXISTS "Users can update own events" ON scheduled_events;
DROP POLICY IF EXISTS "Users can delete own events" ON scheduled_events;
DROP POLICY IF EXISTS "Allow all operations" ON scheduled_events;

-- 3. Create Permissive Policies (Restores functionality)
-- Note: This relies on your App logic and Anon Key for security.
CREATE POLICY "Allow all operations" ON users FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON user_goals FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON workout_sessions FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON habit_streaks FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON user_memories FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON scheduled_events FOR ALL USING (true);
