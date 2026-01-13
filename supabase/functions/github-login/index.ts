import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { SignJWT } from "https://deno.land/x/jose@v4.14.4/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { github_token } = await req.json();

    if (!github_token) {
      return new Response(
        JSON.stringify({ error: "Missing github_token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
          JSON.stringify({ error: `Failed to create user: ${insertError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
