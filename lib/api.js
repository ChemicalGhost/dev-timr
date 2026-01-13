import { getSupabaseClient, isLoggedIn, getCurrentUser } from './auth.js';
import { getRepoInfo } from './git.js';

/**
 * Get or create a repository in the database
 */
export async function getOrCreateRepo(owner, repo) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error('Supabase client not available');
    }

    // Try to get existing repo
    const { data: existing, error: fetchError } = await supabase
        .from('repos')
        .select('id')
        .eq('owner_name', owner)
        .eq('repo_name', repo)
        .single();

    if (existing) {
        return existing.id;
    }

    // Create new repo
    const { data: newRepo, error: insertError } = await supabase
        .from('repos')
        .insert({ owner_name: owner, repo_name: repo })
        .select('id')
        .single();

    if (insertError) {
        // Handle race condition - another user might have created it
        if (insertError.code === '23505') {
            const { data: retryFetch } = await supabase
                .from('repos')
                .select('id')
                .eq('owner_name', owner)
                .eq('repo_name', repo)
                .single();
            return retryFetch?.id;
        }
        throw insertError;
    }

    return newRepo.id;
}

/**
 * Get or create a task for a repository
 */
export async function getOrCreateTask(repoId, taskName) {
    if (!taskName) return null;

    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error('Supabase client not available');
    }

    const user = getCurrentUser();

    // Try to get existing task
    const { data: existing } = await supabase
        .from('tasks')
        .select('id')
        .eq('repo_id', repoId)
        .eq('name', taskName)
        .single();

    if (existing) {
        return existing.id;
    }

    // Create new task
    const { data: newTask, error } = await supabase
        .from('tasks')
        .insert({
            repo_id: repoId,
            name: taskName,
            created_by: user?.id,
        })
        .select('id')
        .single();

    if (error) {
        // Handle race condition
        if (error.code === '23505') {
            const { data: retryFetch } = await supabase
                .from('tasks')
                .select('id')
                .eq('repo_id', repoId)
                .eq('name', taskName)
                .single();
            return retryFetch?.id;
        }
        throw error;
    }

    return newTask.id;
}

/**
 * Sync a session to the cloud
 */
export async function syncSession(session) {
    if (!isLoggedIn()) {
        throw new Error('Not logged in');
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error('Supabase client not available');
    }

    const user = getCurrentUser();
    if (!user?.id) {
        throw new Error('User ID not found');
    }

    // Get repo info from session or current directory
    const repoInfo = session.repo || getRepoInfo();
    if (!repoInfo) {
        throw new Error('Repository info not available');
    }

    // Get or create repo
    const repoId = await getOrCreateRepo(repoInfo.owner, repoInfo.repo);

    // Get or create task if specified
    let taskId = null;
    if (session.taskName) {
        taskId = await getOrCreateTask(repoId, session.taskName);
    }

    // Check for duplicate (by client_id)
    if (session.clientId) {
        const { data: existing } = await supabase
            .from('sessions')
            .select('id')
            .eq('client_id', session.clientId)
            .single();

        if (existing) {
            // Already synced, skip
            return existing;
        }
    }

    // Insert session
    const { data, error } = await supabase
        .from('sessions')
        .insert({
            user_id: user.id,
            repo_id: repoId,
            task_id: taskId,
            start_time: session.start,
            end_time: session.end,
            client_id: session.clientId,
        })
        .select()
        .single();

    if (error) {
        throw error;
    }

    return data;
}

/**
 * Get repository stats (team or personal)
 * @param {string} repoFullName - Format: "owner/repo"
 * @param {boolean} personalOnly - If true, only return current user's stats
 */
export async function getRepoStats(repoFullName = null, personalOnly = false) {
    const supabase = getSupabaseClient();

    // If not logged in or no Supabase, return null (will use local fallback)
    if (!supabase || !isLoggedIn()) {
        return null;
    }

    const user = getCurrentUser();
    const repo = repoFullName ? parseRepoName(repoFullName) : getRepoInfo();

    if (!repo) {
        return null;
    }

    // Get repo ID
    const { data: repoData } = await supabase
        .from('repos')
        .select('id')
        .eq('owner_name', repo.owner)
        .eq('repo_name', repo.repo)
        .single();

    if (!repoData) {
        return { totalMs: 0, todayMs: 0, weekMs: 0, monthMs: 0 };
    }

    // Calculate time ranges
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - (now.getDay() * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // Build query
    let query = supabase
        .from('sessions')
        .select('start_time, end_time, duration_ms')
        .eq('repo_id', repoData.id);

    if (personalOnly && user?.id) {
        query = query.eq('user_id', user.id);
    }

    const { data: sessions, error } = await query;

    if (error) {
        throw error;
    }

    // Calculate stats
    let totalMs = 0;
    let todayMs = 0;
    let weekMs = 0;
    let monthMs = 0;

    for (const session of sessions || []) {
        const duration = session.duration_ms || (session.end_time - session.start_time);
        totalMs += duration;

        if (session.start_time >= todayStart) {
            todayMs += duration;
        }
        if (session.start_time >= weekStart) {
            weekMs += duration;
        }
        if (session.start_time >= monthStart) {
            monthMs += duration;
        }
    }

    return { totalMs, todayMs, weekMs, monthMs };
}

/**
 * Get recent tasks for a repository (for task continuation feature)
 */
export async function getRecentTasks(repoFullName = null, limit = 10) {
    const supabase = getSupabaseClient();

    if (!supabase || !isLoggedIn()) {
        return [];
    }

    const repo = repoFullName ? parseRepoName(repoFullName) : getRepoInfo();
    if (!repo) {
        return [];
    }

    // Get repo ID
    const { data: repoData } = await supabase
        .from('repos')
        .select('id')
        .eq('owner_name', repo.owner)
        .eq('repo_name', repo.repo)
        .single();

    if (!repoData) {
        return [];
    }

    // Get recent tasks with last used time
    const { data: sessions, error } = await supabase
        .from('sessions')
        .select(`
      task_id,
      tasks (id, name),
      start_time
    `)
        .eq('repo_id', repoData.id)
        .not('task_id', 'is', null)
        .order('start_time', { ascending: false })
        .limit(50);

    if (error || !sessions) {
        return [];
    }

    // Deduplicate and get unique tasks ordered by most recent
    const taskMap = new Map();
    for (const session of sessions) {
        if (session.tasks && !taskMap.has(session.task_id)) {
            taskMap.set(session.task_id, {
                id: session.tasks.id,
                name: session.tasks.name,
                lastUsed: session.start_time,
            });
        }
        if (taskMap.size >= limit) break;
    }

    return Array.from(taskMap.values());
}

/**
 * Get daily breakdown for charts (last N days)
 */
export async function getDailyBreakdown(repoFullName = null, days = 30, personalOnly = false) {
    const supabase = getSupabaseClient();

    if (!supabase || !isLoggedIn()) {
        return [];
    }

    const user = getCurrentUser();
    const repo = repoFullName ? parseRepoName(repoFullName) : getRepoInfo();
    if (!repo) {
        return [];
    }

    // Get repo ID
    const { data: repoData } = await supabase
        .from('repos')
        .select('id')
        .eq('owner_name', repo.owner)
        .eq('repo_name', repo.repo)
        .single();

    if (!repoData) {
        return [];
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

    // Build query
    let query = supabase
        .from('sessions')
        .select('start_time, end_time, duration_ms')
        .eq('repo_id', repoData.id)
        .gte('start_time', startDate.getTime());

    if (personalOnly && user?.id) {
        query = query.eq('user_id', user.id);
    }

    const { data: sessions, error } = await query;

    if (error || !sessions) {
        return [];
    }

    // Aggregate by day
    const dailyMap = new Map();

    // Initialize all days to 0
    for (let i = 0; i < days; i++) {
        const date = new Date(endDate.getTime() - (i * 24 * 60 * 60 * 1000));
        const dateStr = date.toISOString().split('T')[0];
        dailyMap.set(dateStr, 0);
    }

    // Sum durations by day
    for (const session of sessions) {
        const dateStr = new Date(session.start_time).toISOString().split('T')[0];
        const duration = session.duration_ms || (session.end_time - session.start_time);
        dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + duration);
    }

    // Convert to array sorted by date
    return Array.from(dailyMap.entries())
        .map(([date, ms]) => ({ date, ms }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get task breakdown for pie charts
 */
export async function getTaskBreakdown(repoFullName = null, personalOnly = false) {
    const supabase = getSupabaseClient();

    if (!supabase || !isLoggedIn()) {
        return [];
    }

    const user = getCurrentUser();
    const repo = repoFullName ? parseRepoName(repoFullName) : getRepoInfo();
    if (!repo) {
        return [];
    }

    // Get repo ID
    const { data: repoData } = await supabase
        .from('repos')
        .select('id')
        .eq('owner_name', repo.owner)
        .eq('repo_name', repo.repo)
        .single();

    if (!repoData) {
        return [];
    }

    // Build query
    let query = supabase
        .from('sessions')
        .select(`
      task_id,
      tasks (name),
      duration_ms,
      start_time,
      end_time
    `)
        .eq('repo_id', repoData.id);

    if (personalOnly && user?.id) {
        query = query.eq('user_id', user.id);
    }

    const { data: sessions, error } = await query;

    if (error || !sessions) {
        return [];
    }

    // Aggregate by task
    const taskMap = new Map();
    let unnamedTotal = 0;

    for (const session of sessions) {
        const duration = session.duration_ms || (session.end_time - session.start_time);

        if (session.tasks?.name) {
            const current = taskMap.get(session.tasks.name) || 0;
            taskMap.set(session.tasks.name, current + duration);
        } else {
            unnamedTotal += duration;
        }
    }

    // Convert to array
    const result = Array.from(taskMap.entries())
        .map(([name, ms]) => ({ name, ms }))
        .sort((a, b) => b.ms - a.ms);

    if (unnamedTotal > 0) {
        result.push({ name: 'Unnamed Tasks', ms: unnamedTotal });
    }

    return result;
}

/**
 * Get team member contributions
 */
export async function getTeamContributions(repoFullName = null) {
    const supabase = getSupabaseClient();

    if (!supabase || !isLoggedIn()) {
        return [];
    }

    const repo = repoFullName ? parseRepoName(repoFullName) : getRepoInfo();
    if (!repo) {
        return [];
    }

    // Get repo ID
    const { data: repoData } = await supabase
        .from('repos')
        .select('id')
        .eq('owner_name', repo.owner)
        .eq('repo_name', repo.repo)
        .single();

    if (!repoData) {
        return [];
    }

    // Get sessions with user info
    const { data: sessions, error } = await supabase
        .from('sessions')
        .select(`
      user_id,
      users (github_username, avatar_url),
      duration_ms,
      start_time,
      end_time
    `)
        .eq('repo_id', repoData.id);

    if (error || !sessions) {
        return [];
    }

    // Aggregate by user
    const userMap = new Map();

    for (const session of sessions) {
        const userId = session.user_id;
        const duration = session.duration_ms || (session.end_time - session.start_time);

        if (!userMap.has(userId)) {
            userMap.set(userId, {
                userId,
                username: session.users?.github_username || 'Unknown',
                avatarUrl: session.users?.avatar_url,
                totalMs: 0,
            });
        }

        userMap.get(userId).totalMs += duration;
    }

    // Convert to array sorted by total time
    return Array.from(userMap.values())
        .sort((a, b) => b.totalMs - a.totalMs);
}

/**
 * Helper to parse "owner/repo" format
 */
function parseRepoName(fullName) {
    const parts = fullName.split('/');
    if (parts.length !== 2) return null;
    return { owner: parts[0], repo: parts[1], fullName };
}

/**
 * Ensure user profile exists in users table
 */
export async function ensureUserProfile(githubUser) {
    const supabase = getSupabaseClient();

    if (!supabase || !isLoggedIn()) {
        return null;
    }

    const user = getCurrentUser();
    if (!user?.id) {
        return null;
    }

    // Try to insert/update user profile
    const { data, error } = await supabase
        .from('users')
        .upsert({
            id: user.id,
            github_username: githubUser.login,
            github_id: githubUser.id,
            avatar_url: githubUser.avatarUrl,
            email: githubUser.email,
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'id',
        })
        .select()
        .single();

    if (error) {
        console.error('Failed to create user profile:', error.message);
        return null;
    }

    return data;
}

export default {
    syncSession,
    getRepoStats,
    getRecentTasks,
    getDailyBreakdown,
    getTaskBreakdown,
    getTeamContributions,
    getOrCreateRepo,
    getOrCreateTask,
    ensureUserProfile,
};
