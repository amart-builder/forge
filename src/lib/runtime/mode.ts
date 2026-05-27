export type RuntimeMode = "convex" | "supabase";

export function getRuntimeMode(): RuntimeMode {
  return process.env.NEXT_PUBLIC_FORGE_RUNTIME === "supabase"
    ? "supabase"
    : "convex";
}
