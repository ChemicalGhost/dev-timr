import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { SignJWT } from "https://deno.land/x/jose@v4.14.4/index.ts";

// Get allowed origins from environment (comma-separated) or default to none
// For CLI-only usage (default), no origins need to be configured
// Browser-based tools can be allowed by setting: ALLOWED_ORIGINS=https://admin.example.com
const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS")?.split(",").map(o => o.trim()).filter(o => o.length > 0) || [];

// Rate limiting configuration
const RATE_LIMIT = 30;  // requests per window
const RATE_WINDOW = 60; // seconds

// JWT Secret validation
const MIN_SECRET_LENGTH = 32; // 256 bits minimum

function validateJwtSecret(secret: string | undefined): { valid: boolean; error?: string } {
  if (!secret) {
    return { valid: false, error: "JWT_SECRET environment variable not set" };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return { valid: false, error: `JWT_SECRET too short (${secret.length} chars). Minimum: ${MIN_SECRET_LENGTH}` };
  }
  return { valid: true };
}

/**
 * Get CORS headers based on request origin.
 */
function getCorsHeaders(origin: string | null): Record<string, string> {
  if (!origin) {
    return { "Content-Type": "application/json" };
  }
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

/**
 * Hash IP for privacy
 */
async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + Deno.env.get("JWT_SECRET"));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check rate limit using Supabase
 */
async function checkRateLimit(supabase: any, ipHash: string, endpoint: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_ip_hash: ipHash,
      p_endpoint: endpoint,
      p_limit: RATE_LIMIT,
      p_window_seconds: RATE_WINDOW
    });
    return data === true;
  } catch {
    // If rate limit check fails, allow the request (fail open)
    return true;
  }
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

serve(async (req) => {
  // Get origin from request for CORS handling
  const origin = req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    return new Response(null, { status: 204 });
  }

  try {
    // Get client IP for rate limiting
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0] ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";

    // Get Supabase client for rate limit check
    const rlUrl = Deno.env.get("SUPABASE_URL")!;
    const rlKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const rateLimitClient = createClient(rlUrl, rlKey, {
      db: { schema: 'public' },
      auth: { persistSession: false }
    });

    // Check rate limit
    const ipHash = await hashIP(clientIP);
    const allowed = await checkRateLimit(rateLimitClient, ipHash, "github-login");
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Retry-After": "60" } }
      );
    }

    const { github_token } = await req.json();

    if (!github_token) {
      return new Response(
        JSON.stringify({ error: "Missing github_token" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate GitHub token by fetching user info
    const githubResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${github_token}`,
        Accept: "application/json",
        "User-Agent": "dev-timr",
      },
    });

    if (!githubResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Invalid GitHub token" }),
        { status: 401, headers: corsHeaders }
      );
    }

    const githubUser: GitHubUser = await githubResponse.json();

    // Get Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const jwtSecret = Deno.env.get("JWT_SECRET");

    // Validate JWT secret strength
    const secretValidation = validateJwtSecret(jwtSecret);
    if (!secretValidation.valid) {
      console.error("JWT Secret validation failed:", secretValidation.error);
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      db: { schema: 'public' },
      auth: { persistSession: false }
    });

    // Check if user exists in our users table
    const { data: existingUser, error: selectError } = await supabase
      .from("users")
      .select("id, github_username, github_id, avatar_url")
      .eq("github_id", githubUser.id)
      .maybeSingle();

    let userId: string;

    if (existingUser) {
      // Update existing user
      userId = existingUser.id;
      const { error: updateError } = await supabase
        .from("users")
        .update({
          github_username: githubUser.login,
          avatar_url: githubUser.avatar_url,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (updateError) {
        console.error("Update error:", updateError);
      }
    } else {
      // Create new user
      userId = crypto.randomUUID();
      const { error: insertError } = await supabase
        .from("users")
        .insert({
          id: userId,
          github_id: githubUser.id,
          github_username: githubUser.login,
          avatar_url: githubUser.avatar_url,
        });

      if (insertError) {
        console.error("Insert error:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to create user" }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Generate a Supabase-compatible JWT
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 60 * 60 * 24 * 7; // 7 days

    const token = await new SignJWT({
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      github_id: githubUser.id,
      github_github_username: githubUser.login,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .sign(new TextEncoder().encode(jwtSecret));

    return new Response(
      JSON.stringify({
        access_token: token,
        expires_at: expiresAt,
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
