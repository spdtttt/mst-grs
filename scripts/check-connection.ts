import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.local");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: false } },
);
async function check() {
  const result = await db.from("site_schedule").select("id").limit(1);
  console.log(
    JSON.stringify({
      connection:
        result.error?.code === "42501"
          ? "connected_schema_present_anonymous_access_denied"
          : result.error
            ? "needs_attention"
            : "ok",
      code: result.error?.code,
      message: result.error?.message,
    }),
  );
}
check();
