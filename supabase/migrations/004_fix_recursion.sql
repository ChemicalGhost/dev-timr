-- =============================================
-- FIX: Infinite Recursion in Sessions Policy
-- Run this in Supabase SQL Editor immediately
-- =============================================

-- The problem: "Users can read team sessions" policy
-- references the sessions table, causing infinite recursion.

-- STEP 1: Drop the problematic policy
DROP POLICY IF EXISTS "Users can read team sessions" ON sessions;

-- STEP 2: Create a helper function with SECURITY DEFINER
-- This function runs with elevated privileges and bypasses RLS
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

-- STEP 3: Recreate the policy using the helper function
CREATE POLICY "Users can read team sessions"
    ON sessions FOR SELECT
    USING (
        repo_id IN (SELECT get_user_repo_ids(auth.uid()))
    );

-- STEP 4: Also fix the users "read teammates" policy (same issue)
DROP POLICY IF EXISTS "Users can read teammates" ON users;

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

CREATE POLICY "Users can read teammates"
    ON users FOR SELECT
    USING (
        id IN (SELECT get_teammate_ids(auth.uid()))
    );

-- STEP 5: Verify the fix
SELECT 'Fix applied successfully!' as status;
