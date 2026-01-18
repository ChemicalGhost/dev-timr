import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { SignJWT, jwtVerify } from "https://deno.land/x/jose@v4.14.4/index.ts";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS")?.split(",").map(o => o.trim()).filter(o => o.length > 0) || [];
const RATE_LIMIT = 30;
const RATE_WINDOW = 60;
const MIN_SECRET_LENGTH = 32;

function validateJwtSecret(secret: string | undefined): { valid: boolean; error?: string } {
    if (!secret) return { valid: false, error: "JWT_SECRET not set" };
    if (secret.length < MIN_SECRET_LENGTH) return { valid: false, error: `JWT_SECRET too short` };
    return { valid: true };
}

function getCorsHeaders(origin: string | null): Record<string, string> {
    if (!origin) return { "Content-Type": "application/json" };
    if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)) {
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin",
            "Content-Type": "application/json",
        };
    }
    return { "Content-Type": "application/json" };
}

async function hashIP(ip: string): Promise<string> {
    const data = new TextEncoder().encode(ip + Deno.env.get("JWT_SECRET"));
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function checkRateLimit(supabase: any, ipHash: string, endpoint: string): Promise<boolean> {
    try {
        const { data } = await supabase.rpc('check_rate_limit', {
            p_ip_hash: ipHash, p_endpoint: endpoint, p_limit: RATE_LIMIT, p_window_seconds: RATE_WINDOW
        });
        return data === true;
    } catch { return true; }
}

interface GitHubUser {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string;
}

serve(async (req) => {
    const origin = req.headers.get("Origin");
    const corsHeaders = getCorsHeaders(origin);

    if (req.method === "OPTIONS") {
        if (origin && ALLOWED_ORIGINS.includes(origin)) {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        return new Response(null, { status: 204 });
    }

    try {
        const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
        const rlClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
            db: { schema: 'public' }, auth: { persistSession: false }
        });
        const ipHash = await hashIP(clientIP);
        if (!await checkRateLimit(rlClient, ipHash, "token-refresh")) {
            return new Response(
                JSON.stringify({ error: "Too many requests" }),
                { status: 429, headers: { ...corsHeaders, "Retry-After": "60" } }
            );
        }

        const { github_token, current_jwt } = await req.json();

        if (!github_token) {
            return new Response(
                JSON.stringify({ error: "Missing github_token" }),
                { status: 400, headers: corsHeaders }
            );
        }

        // Validate GitHub token is still valid by fetching user info
        const githubResponse = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${github_token}`,
                Accept: "application/json",
                "User-Agent": "dev-timr",
            },
        });

        if (!githubResponse.ok) {
            return new Response(
                JSON.stringify({
                    error: "GitHub token expired or revoked",
                    code: "GITHUB_TOKEN_INVALID",
                    requiresReauth: true
                }),
                { status: 401, headers: corsHeaders }
            );
        }

        const githubUser: GitHubUser = await githubResponse.json();

        // Get Supabase admin client
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const jwtSecret = Deno.env.get("JWT_SECRET")!;

        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            db: { schema: 'public' },
            auth: { persistSession: false }
        });

        // Look up user by GitHub ID
        const { data: existingUser, error: selectError } = await supabase
            .from("users")
            .select("id, github_username, github_id, avatar_url")
            .eq("github_id", githubUser.id)
            .maybeSingle();

        if (!existingUser) {
            return new Response(
                JSON.stringify({
                    error: "User not found",
                    code: "USER_NOT_FOUND",
                    requiresReauth: true
                }),
                { status: 401, headers: corsHeaders }
            );
        }

        const userId = existingUser.id;

        // Update user profile with latest GitHub info
        await supabase
            .from("users")
            .update({
                github_username: githubUser.login,
                avatar_url: githubUser.avatar_url,
                updated_at: new Date().toISOString(),
            })
            .eq("id", userId);

        // Generate a fresh JWT
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 60 * 60 * 24 * 7; // 7 days

        const token = await new SignJWT({
            sub: userId,
            role: "authenticated",
            aud: "authenticated",
            github_id: githubUser.id,
            github_username: githubUser.login,
        })
            .setProtectedHeader({ alg: "HS256", typ: "JWT" })
            .setIssuedAt(now)
            .setExpirationTime(expiresAt)
            .sign(new TextEncoder().encode(jwtSecret));

        return new Response(
            JSON.stringify({
                access_token: token,
                expires_at: expiresAt,
                refreshed: true,
                user: {
                    id: userId,
                    github_id: githubUser.id,
                    github_username: githubUser.login,
                    name: githubUser.name,
                    email: githubUser.email,
                    avatar_url: githubUser.avatar_url,
                },
            }),
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: corsHeaders }
        );
    }
});
