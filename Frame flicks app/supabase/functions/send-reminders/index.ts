// send-reminders — Supabase Edge Function.
//   • Called every minute by pg_cron: sends every reminder that is due.
//   • Called from the app with { test: true }: sends a test notification to
//     the logged-in user's devices.
// Deploy:  supabase functions deploy send-reminders --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const MAX_LATE_MS = 12 * 60 * 60 * 1000; // don't send reminders that are over 12h stale

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

async function sendToUser(userId: string, payload: Record<string, unknown>) {
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", code, (err as Error).message);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  const body = await req.json().catch(() => ({}));

  // --- Test button in the app (needs a logged-in user) ---
  if (body.test) {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data } = await db.auth.getUser(token);
    if (!data?.user) return json({ error: "not logged in" }, 401);
    const sent = await sendToUser(data.user.id, {
      title: "🎬 Frame Flicks",
      body: "Notifications are working. Shoot-day reminders will show up like this.",
      url: "./index.html?page=calendar",
      tag: "test",
    });
    return json({ sent });
  }

  // --- Scheduled run ---
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);

  const now = Date.now();
  const { data: due } = await db.from("push_reminders").select("*")
    .eq("sent", false).lte("fire_at", new Date(now).toISOString()).order("fire_at").limit(200);

  let sent = 0;
  for (const r of due ?? []) {
    const late = now - new Date(r.fire_at).getTime();
    if (late <= MAX_LATE_MS) {
      sent += await sendToUser(r.user_id, { title: r.title, body: r.body, url: r.url, tag: r.tag });
    }
    await db.from("push_reminders").update({ sent: true }).eq("id", r.id);
  }
  // tidy up old rows
  await db.from("push_reminders").delete().eq("sent", true).lt("fire_at", new Date(now - 7 * 86400000).toISOString());
  return json({ due: due?.length ?? 0, sent });
});
