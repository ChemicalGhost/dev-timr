import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { jwtVerify } from "https://deno.land/x/jose@v4.14.4/index.ts";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS")?.split(",").map(o => o.trim()).filter(o => o.length > 0) || [];
const RATE_LIMIT = 60;  // Logout is less sensitive, higher limit
const RATE_WINDOW = 60;

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

async function hashToken(token: string): Promise<string> {
    const data = new TextEncoder().encode(token);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
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
        if (!await checkRateLimit(rlClient, ipHash, "logout")) {
            return new Response(
                JSON.stringify({ error: "Too many requests" }),
                { status: 429, headers: { ...corsHeaders, "Retry-After": "60" } }
            );
        }

        const { access_token } = await req.json();

        if (!access_token) {
            return new Response(
                JSON.stringify({ error: "Missing access_token" }),
                { status: 400, headers: corsHeaders }
            );
        }

        // Get environment variables
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const jwtSecret = Deno.env.get("JWT_SECRET")!;

        // Verify and decode the JWT to get user_id and expiry
        let userId: string | null = null;
        let expiresAt: Date;

        try {
            const { payload } = await jwtVerify(
                access_token,
                new TextEncoder().encode(jwtSecret)
            );
            userId = payload.sub as string;
            expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        } catch (jwtError) {
            // Token might already be expired, but we still want to blocklist it
            // Extract expiry from token payload without verification
            try {
                const parts = access_token.split(".");
                const payload = JSON.parse(atob(parts[1]));
                userId = payload.sub;
                expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            } catch {
                expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            }
        }

        // Hash the token (never store raw JWTs)
        const tokenHash = await hashToken(access_token);

        // Create Supabase admin client
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            db: { schema: 'public' },
            auth: { persistSession: false }
        });

        // Add token to blocklist
        const { error: insertError } = await supabase
            .from("token_blocklist")
            .upsert({
                token_hash: tokenHash,
                user_id: userId,
                expires_at: expiresAt.toISOString(),
                reason: "logout",
            }, {
                onConflict: "token_hash"
            });

        if (insertError) {
            console.error("Blocklist insert error:", insertError);
            // Don't fail - client should still clear local data
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: "Token revoked successfully",
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
