// send-reminders — Supabase Edge Function.
//   • Called every minute by pg_cron (with the x-cron-secret header): sends every
//     notification that is due.
//   • Called from the app with { test: true }: sends a test notification to the
//     logged-in person's OWN phones only.
//   • Called from the app with { public_key: true }: returns the public VAPID key
//     (it is public by design — the private key never leaves this function).
// Deploy it with "Verify JWT" switched OFF (the cron call has no login) — see SETUP.md.
//
// Safety rules in here:
//   • a notification is "claimed" (marked sent) BEFORE it is sent, so two runs
//     overlapping can never send the same one twice
//   • nobody who is deactivated (or has no profile) is ever sent anything
//   • only title / body / url / tag are sent; url must be a page inside the app

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const MAX_LATE_MS = 12 * 60 * 60 * 1000; // never send a reminder that is over 12 hours stale
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

// Same-length comparison that does not leak where the first difference is.
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Only pages inside the app may be opened by tapping a notification.
function safeUrl(u: unknown): string {
  return typeof u === "string" && /^\.\/[A-Za-z0-9_.\-/?=&%]*$/.test(u) ? u : "./index.html";
}

// deno-lint-ignore no-explicit-any
let db: any = null;
let pushReady = false;

function setup(): string | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return "Supabase settings are missing.";
  if (!db) db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return "VAPID keys are not saved yet (see SETUP.md).";
  if (!pushReady) {
    try {
      webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com", pub, priv);
      pushReady = true;
    } catch (e) {
      return "The VAPID keys or VAPID_SUBJECT are not valid: " + (e as Error).message;
    }
  }
  return null;
}

async function isActiveProfile(userId: string): Promise<boolean> {
  const { data } = await db!.from("profiles").select("active").eq("user_id", userId).maybeSingle();
  return !!data && data.active === true;
}

async function sendToUser(userId: string, payload: Record<string, unknown>): Promise<number> {
  if (!(await isActiveProfile(userId))) return 0;
  const { data: subs } = await db!.from("push_subscriptions").select("*").eq("user_id", userId);
  const text = JSON.stringify({
    title: String(payload.title ?? "Frame Flicks").slice(0, 120),
    body: String(payload.body ?? "").slice(0, 240),
    url: safeUrl(payload.url),
    tag: typeof payload.tag === "string" ? payload.tag.slice(0, 100) : undefined,
  });
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, text);
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db!.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", code);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  const body = await req.json().catch(() => ({}));

  if (body && body.public_key) {
    const pub = Deno.env.get("VAPID_PUBLIC_KEY");
    return pub ? json({ public_key: pub }) : json({ error: "not_configured" }, 503);
  }

  const problem = setup();
  if (problem) return json({ error: "not_configured", message: problem }, 503);

  // --- Test button in the app (needs a logged-in person) ---
  if (body && body.test) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = token ? await db!.auth.getUser(token) : { data: null };
    if (!data?.user) return json({ error: "not logged in" }, 401);
    const sent = await sendToUser(data.user.id, {
      title: "Frame Flicks",
      body: "Notifications are working. Your reminders will show up like this.",
      url: "./index.html",
      tag: "test",
    });
    return json({ sent });
  }

  // --- Scheduled run ---
  if (!safeEqual(req.headers.get("x-cron-secret") ?? "", Deno.env.get("CRON_SECRET") ?? "")) {
    return json({ error: "forbidden" }, 403);
  }

  const now = Date.now();
  const { data: due } = await db!.from("push_reminders").select("id")
    .eq("sent", false).lte("fire_at", new Date(now).toISOString()).order("fire_at").limit(200);
  const ids = (due ?? []).map((r: { id: string }) => r.id);

  let claimed = 0, sent = 0, skipped = 0;
  if (ids.length) {
    // Claim first: only rows still unsent are flipped, and only the rows we flipped are ours to send.
    const { data: mine } = await db!.from("push_reminders").update({ sent: true })
      .in("id", ids).eq("sent", false).select("*");
    for (const r of mine ?? []) {
      claimed++;
      if (now - new Date(r.fire_at).getTime() > MAX_LATE_MS) { skipped++; continue; }
      const n = await sendToUser(r.user_id, { title: r.title, body: r.body, url: r.url, tag: r.tag });
      if (n === 0) skipped++; else sent += n;
    }
  }
  await db!.from("push_reminders").delete().eq("sent", true).lt("fire_at", new Date(now - 7 * 86400000).toISOString());
  return json({ due: ids.length, claimed, sent, skipped });
});
