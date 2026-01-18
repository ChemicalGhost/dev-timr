-- =============================================
-- Dev-Timr Row Level Security Policies
-- Migration: 002_enable_rls.sql
-- Description: Enables RLS and creates all security policies
-- =============================================
-- CRITICAL: Run this AFTER 001_create_tables.sql
-- Execute in: Supabase Dashboard > SQL Editor
-- =============================================

-- =============================================
-- STEP 1: ENABLE RLS ON ALL TABLES
-- =============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners too (recommended for security)
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE repos FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

-- =============================================
-- STEP 2: CREATE HELPER FUNCTIONS
-- These use SECURITY DEFINER to avoid infinite recursion
-- when policies need to reference the same table
-- =============================================

-- Helper: Get repo IDs that a user has contributed to
CREATE OR REPLACE FUNCTION get_user_repo_ids(uid UUID)
RETURNS TABLE(repo_id UUID)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT DISTINCT s.repo_id
    FROM sessions s
    WHERE s.user_id = uid;
$$;

-- Helper: Get user IDs of teammates (users who share repos)
CREATE OR REPLACE FUNCTION get_teammate_ids(uid UUID)
RETURNS TABLE(user_id UUID)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT DISTINCT s.user_id
    FROM sessions s
    WHERE s.repo_id IN (
        SELECT DISTINCT repo_id FROM sessions WHERE user_id = uid
    );
$$;

-- =============================================
-- STEP 3: DROP EXISTING POLICIES (for clean re-application)
-- =============================================

-- Users table policies
DROP POLICY IF EXISTS "Users can read own data" ON users;
DROP POLICY IF EXISTS "Users can update own data" ON users;
DROP POLICY IF EXISTS "Service can insert users" ON users;
DROP POLICY IF EXISTS "Users can read teammates" ON users;

-- Repos table policies
DROP POLICY IF EXISTS "Anyone can read repos" ON repos;
DROP POLICY IF EXISTS "Authenticated users can create repos" ON repos;

-- Tasks table policies
DROP POLICY IF EXISTS "Anyone can read tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can create tasks" ON tasks;

-- Sessions table policies
DROP POLICY IF EXISTS "Users can read own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can read team sessions" ON sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON sessions;

-- =============================================
-- STEP 4: USERS TABLE POLICIES
-- =============================================

-- Users can read their own profile
CREATE POLICY "Users can read own data"
    ON users FOR SELECT
    USING (auth.uid() = id);

-- Users can read profiles of teammates (users who share repos)
-- Uses helper function to avoid recursion
CREATE POLICY "Users can read teammates"
    ON users FOR SELECT
    USING (id IN (SELECT get_teammate_ids(auth.uid())));

-- Users can update their own profile
CREATE POLICY "Users can update own data"
    ON users FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Only service role (Edge Function) can insert users
CREATE POLICY "Service can insert users"
    ON users FOR INSERT
    WITH CHECK (true);  -- Service role bypasses RLS anyway

-- =============================================
-- STEP 5: REPOS TABLE POLICIES
-- =============================================

-- All authenticated users can read repos (needed for team collaboration)
CREATE POLICY "Anyone can read repos"
    ON repos FOR SELECT
    USING (auth.role() = 'authenticated');

-- Authenticated users can create repos
CREATE POLICY "Authenticated users can create repos"
    ON repos FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- =============================================
-- STEP 6: TASKS TABLE POLICIES
-- =============================================

-- All authenticated users can read tasks
CREATE POLICY "Anyone can read tasks"
    ON tasks FOR SELECT
    USING (auth.role() = 'authenticated');

-- Authenticated users can create tasks
CREATE POLICY "Authenticated users can create tasks"
    ON tasks FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- =============================================
-- STEP 7: SESSIONS TABLE POLICIES
-- =============================================

-- Users can read their own sessions
CREATE POLICY "Users can read own sessions"
    ON sessions FOR SELECT
    USING (auth.uid() = user_id);

-- Users can read sessions for repos they've contributed to
-- Uses helper function to avoid recursion
CREATE POLICY "Users can read team sessions"
    ON sessions FOR SELECT
    USING (repo_id IN (SELECT get_user_repo_ids(auth.uid())));

-- Users can only insert their own sessions
CREATE POLICY "Users can insert own sessions"
    ON sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- =============================================
-- STEP 8: GRANT PERMISSIONS
-- =============================================

-- Grant usage on the public schema
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- Grant table permissions to authenticated users
GRANT SELECT ON users TO authenticated;
GRANT UPDATE ON users TO authenticated;
GRANT SELECT, INSERT ON repos TO authenticated;
GRANT SELECT, INSERT ON tasks TO authenticated;
GRANT SELECT, INSERT ON sessions TO authenticated;

-- Grant sequence permissions (for auto-generated IDs)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- =============================================
-- VERIFICATION OUTPUT
-- =============================================

SELECT 
    'RLS Policies Applied Successfully!' as status,
    NOW() as applied_at;
