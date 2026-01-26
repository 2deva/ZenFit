-- Supabase Migration: User Onboarding State

-- Create onboarding state table
CREATE TABLE IF NOT EXISTS user_onboarding_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  
  -- Stage Progression (user-paced, not time-based)
  onboarding_stage TEXT DEFAULT 'initial' CHECK (onboarding_stage IN ('initial', 'goals_set', 'motivation_known', 'preferences_inferred', 'complete')),
  profile_completeness INTEGER DEFAULT 0 CHECK (profile_completeness >= 0 AND profile_completeness <= 100),
  
  -- Primary Motivation (captured when volunteered)
  primary_motivation TEXT, -- 'fitness', 'stress_relief', 'weight_loss', 'health_scare', etc.
  motivation_details TEXT, -- Free-form elaboration
  
  -- Health Context (captured gradually or when volunteered)
  health_conditions TEXT[] DEFAULT '{}', -- ['knee_injury', 'high_stress', 'blood_pressure']
  
  -- Preferences (inferred from behavior + explicit statements)
  preferred_workout_time TEXT CHECK (preferred_workout_time IN ('morning', 'afternoon', 'evening', 'variable', NULL)),
  preferred_activity_types TEXT[] DEFAULT '{}', -- ['walking', 'strength', 'yoga', 'breathing']
  typical_session_duration INTEGER, -- minutes, inferred from usage
  
  -- Psychological Indicators (detected from conversation patterns)
  openness_level TEXT DEFAULT 'unknown' CHECK (openness_level IN ('high', 'medium', 'low', 'unknown')),
  motivation_style TEXT CHECK (motivation_style IN ('self_driven', 'needs_encouragement', 'competitive', NULL)),
  stress_baseline TEXT CHECK (stress_baseline IN ('high', 'medium', 'low', NULL)),
  responds_well_to TEXT[] DEFAULT '{}', -- ['breathing', 'gentle_movement', 'intense_workout', 'encouragement']
  
  -- Interaction Tracking (for question pacing)
  total_interactions INTEGER DEFAULT 0,
  questions_asked_count INTEGER DEFAULT 0,
  last_question_asked_at TIMESTAMPTZ,
  consecutive_action_requests INTEGER DEFAULT 0, -- Track action-oriented behavior
  
  -- Timestamps
  first_workout_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_onboarding_user_id ON user_onboarding_state(user_id);

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_onboarding_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_onboarding_timestamp ON user_onboarding_state;
CREATE TRIGGER trigger_update_onboarding_timestamp
  BEFORE UPDATE ON user_onboarding_state
  FOR EACH ROW
  EXECUTE FUNCTION update_onboarding_updated_at();

-- Add motivation_reason to user_goals if not exists
ALTER TABLE user_goals ADD COLUMN IF NOT EXISTS motivation_reason TEXT;
ALTER TABLE user_goals ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 50 CHECK (priority >= 0 AND priority <= 100);

-- Enable RLS
ALTER TABLE user_onboarding_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own onboarding state" ON user_onboarding_state;
CREATE POLICY "Users can view own onboarding state" ON user_onboarding_state
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own onboarding state" ON user_onboarding_state;
CREATE POLICY "Users can insert own onboarding state" ON user_onboarding_state
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update own onboarding state" ON user_onboarding_state;
CREATE POLICY "Users can update own onboarding state" ON user_onboarding_state
  FOR UPDATE USING (true);
