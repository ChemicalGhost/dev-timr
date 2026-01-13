-- =====================================================
-- DEV-TIMR DATABASE SCHEMA
-- Uses custom JWT auth via Edge Function
-- =====================================================

-- Users table (standalone, not linked to auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_username TEXT UNIQUE NOT NULL,
  github_id BIGINT UNIQUE NOT NULL,
  avatar_url TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Repositories table
CREATE TABLE public.repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  full_name TEXT GENERATED ALWAYS AS (owner_name || '/' || repo_name) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_name, repo_name)
);

-- Tasks table (for task naming feature)
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, name)
);

-- Sessions table
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id),
  start_time BIGINT NOT NULL,
  end_time BIGINT NOT NULL,
  duration_ms BIGINT GENERATED ALWAYS AS (end_time - start_time) STORED,
  client_id TEXT,  -- For deduplication during sync
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX idx_sessions_repo_id ON public.sessions(repo_id);
CREATE INDEX idx_sessions_task_id ON public.sessions(task_id);
CREATE INDEX idx_sessions_start_time ON public.sessions(start_time);
CREATE INDEX idx_sessions_client_id ON public.sessions(client_id);
CREATE INDEX idx_users_github_id ON public.users(github_id);

-- =====================================================
-- ROW LEVEL SECURITY POLICIES
-- Uses auth.jwt() ->> 'sub' for custom JWT authentication
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Users: can read all, can only update own profile
CREATE POLICY "Users can view all users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING ((auth.jwt() ->> 'sub')::uuid = id);
CREATE POLICY "Service role can insert users" ON public.users FOR INSERT WITH CHECK (true);

-- Repos: public read, authenticated users can create
CREATE POLICY "Repos are publicly readable" ON public.repos FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create repos" ON public.repos FOR INSERT WITH CHECK (auth.jwt() ->> 'sub' IS NOT NULL);

-- Tasks: public read per repo, authenticated users can create
CREATE POLICY "Tasks are publicly readable" ON public.tasks FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create tasks" ON public.tasks FOR INSERT WITH CHECK (auth.jwt() ->> 'sub' IS NOT NULL);

-- Sessions: all collaborators can see sessions for a repo (team visibility)
CREATE POLICY "Sessions are publicly readable" ON public.sessions FOR SELECT USING (true);
CREATE POLICY "Users can insert own sessions" ON public.sessions FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub')::uuid = user_id);
CREATE POLICY "Users can update own sessions" ON public.sessions FOR UPDATE USING ((auth.jwt() ->> 'sub')::uuid = user_id);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get or create a repo
CREATE OR REPLACE FUNCTION get_or_create_repo(p_owner TEXT, p_repo TEXT)
RETURNS UUID AS $$
DECLARE
  v_repo_id UUID;
BEGIN
  SELECT id INTO v_repo_id FROM public.repos WHERE owner_name = p_owner AND repo_name = p_repo;
  IF v_repo_id IS NULL THEN
    INSERT INTO public.repos (owner_name, repo_name) VALUES (p_owner, p_repo) RETURNING id INTO v_repo_id;
  END IF;
  RETURN v_repo_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get or create a task
CREATE OR REPLACE FUNCTION get_or_create_task(p_repo_id UUID, p_task_name TEXT, p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_task_id UUID;
BEGIN
  SELECT id INTO v_task_id FROM public.tasks WHERE repo_id = p_repo_id AND name = p_task_name;
  IF v_task_id IS NULL THEN
    INSERT INTO public.tasks (repo_id, name, created_by) VALUES (p_repo_id, p_task_name, p_user_id) RETURNING id INTO v_task_id;
  END IF;
  RETURN v_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get stats for a repo (team aggregate or individual)
CREATE OR REPLACE FUNCTION get_repo_stats(p_repo_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  total_ms BIGINT,
  today_ms BIGINT,
  week_ms BIGINT,
  month_ms BIGINT
) AS $$
DECLARE
  v_today_start BIGINT;
  v_week_start BIGINT;
  v_month_start BIGINT;
BEGIN
  v_today_start := EXTRACT(EPOCH FROM date_trunc('day', NOW())) * 1000;
  v_week_start := EXTRACT(EPOCH FROM date_trunc('week', NOW())) * 1000;
  v_month_start := EXTRACT(EPOCH FROM date_trunc('month', NOW())) * 1000;

  RETURN QUERY
  SELECT
    COALESCE(SUM(s.duration_ms), 0)::BIGINT AS total_ms,
    COALESCE(SUM(CASE WHEN s.start_time >= v_today_start THEN s.duration_ms ELSE 0 END), 0)::BIGINT AS today_ms,
    COALESCE(SUM(CASE WHEN s.start_time >= v_week_start THEN s.duration_ms ELSE 0 END), 0)::BIGINT AS week_ms,
    COALESCE(SUM(CASE WHEN s.start_time >= v_month_start THEN s.duration_ms ELSE 0 END), 0)::BIGINT AS month_ms
  FROM public.sessions s
  WHERE s.repo_id = p_repo_id
    AND (p_user_id IS NULL OR s.user_id = p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get team contributions for a repo
CREATE OR REPLACE FUNCTION get_team_contributions(p_repo_id UUID)
RETURNS TABLE (
  user_id UUID,
  github_username TEXT,
  avatar_url TEXT,
  total_ms BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.github_username,
    u.avatar_url,
    COALESCE(SUM(s.duration_ms), 0)::BIGINT AS total_ms
  FROM public.users u
  JOIN public.sessions s ON s.user_id = u.id
  WHERE s.repo_id = p_repo_id
  GROUP BY u.id, u.github_username, u.avatar_url
  ORDER BY total_ms DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
