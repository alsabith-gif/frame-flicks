// admin-create-worker — Supabase Edge Function.
//
// The ONLY place worker accounts are created or changed. It runs on
// Supabase's servers with the service-role key (which Supabase injects for
// you — you never copy it anywhere and it never reaches the browser).
//
// Every request is first checked: the caller must be signed in AND be an
// active admin in the `profiles` table. Anyone else gets a 401/403.
//
// Actions (JSON body { action, ... }):
//   create        { name, email, job_role }      new worker + sends first code
//   update        { user_id, name?, job_role? }
//   set_active    { user_id, active }            deactivate / reactivate
//   resend_code   { user_id }                    send a fresh 6-digit code
//   reset_access  { user_id }                    forget the password, sign out
//                                                everywhere, send a fresh code
//   list_status   {}                             last login time of each worker
//
// Deploy (see SETUP.md): Supabase → Edge Functions → Deploy a new function →
// "Via Editor", name it exactly  admin-create-worker , paste this file.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(SUPABASE_URL, SERVICE_KEY, noSession);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class Refuse extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function fail(message: string, status = 400): never { throw new Refuse(message, status); }

const JOB_ROLES = ["camera", "editor"];
const clean = (v: unknown) => String(v ?? "").trim();
const isEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Sends the 6-digit code. shouldCreateUser:false means this can never create
// an account by accident. Returns an error message, or null on success.
async function sendCode(email: string): Promise<string | null> {
  const anon = createClient(SUPABASE_URL, ANON_KEY, noSession);
  const { error } = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  return error ? error.message : null;
}

// Ends every login session for a user (database function from Part 2A).
async function revokeSessions(userId: string): Promise<string | null> {
  const { error } = await db.rpc("admin_revoke_sessions", { p_user: userId });
  return error ? error.message : null;
}

async function loadWorker(userId: unknown, callerId: string) {
  const id = clean(userId);
  if (!isId(id)) fail("Missing or invalid worker id.");
  if (id === callerId) fail("You can't do that to your own account.");
  const { data, error } = await db
    .from("profiles")
    .select("user_id, role, name, email, active, job_role")
    .eq("user_id", id)
    .maybeSingle();
  if (error) fail(error.message, 500);
  if (!data || data.role !== "worker") fail("Worker not found.", 404);
  return data;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  // ---- 1. Who is calling? Must be a signed-in, active admin. ----
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not logged in." }, 401);
  const { data: who, error: whoErr } = await db.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Not logged in." }, 401);
  const callerId = who.user.id;
  const { data: me } = await db.from("profiles").select("role, active").eq("user_id", callerId).maybeSingle();
  if (!me || me.role !== "admin" || !me.active) return json({ error: "Admins only." }, 403);

  const body = await req.json().catch(() => ({}));

  try {
    switch (body.action) {
      // ------------------------------------------------------------------
      case "create": {
        const name = clean(body.name);
        const email = clean(body.email).toLowerCase();
        const job_role = clean(body.job_role);
        if (!name || name.length > 80) fail("Enter the worker's name.");
        if (!isEmail(email)) fail("Enter a valid email address.");
        if (!JOB_ROLES.includes(job_role)) fail("Pick a role: camera or editor.");

        const { data: created, error: cErr } = await db.auth.admin.createUser({
          email,
          email_confirm: true,           // no password: they sign in with a code first
          user_metadata: { name, password_set: false },
        });
        if (cErr || !created?.user) {
          const exists = cErr && (String((cErr as { code?: string }).code) === "email_exists" || /already/i.test(cErr.message));
          return fail(exists ? "That email already has an account." : (cErr?.message ?? "Could not create the account."));
        }
        const userId = created.user.id;

        const { error: pErr } = await db.from("profiles").insert({
          user_id: userId, role: "worker", name, email, job_role, active: true,
        });
        if (pErr) {
          await db.auth.admin.deleteUser(userId);   // don't leave a half-made account behind
          const dup = /duplicate|unique/i.test(pErr.message);
          return fail(dup ? "That email already has an account." : "Could not save the worker: " + pErr.message, dup ? 400 : 500);
        }

        const codeError = await sendCode(email);
        return json({
          ok: true, user_id: userId, code_sent: !codeError,
          warning: codeError ? `The worker was added, but the login code email could not be sent (${codeError}).` : undefined,
        });
      }

      // ------------------------------------------------------------------
      case "update": {
        const w = await loadWorker(body.user_id, callerId);
        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) {
          const name = clean(body.name);
          if (!name || name.length > 80) fail("Enter the worker's name.");
          patch.name = name;
        }
        if (body.job_role !== undefined) {
          const r = clean(body.job_role);
          if (!JOB_ROLES.includes(r)) fail("Pick a role: camera or editor.");
          patch.job_role = r;
        }
        if (Object.keys(patch).length) {
          const { error } = await db.from("profiles").update(patch).eq("user_id", w.user_id);
          if (error) fail(error.message, 500);
        }
        return json({ ok: true });
      }

      // ------------------------------------------------------------------
      case "set_active": {
        const w = await loadWorker(body.user_id, callerId);
        const active = body.active === true;
        // Profile first: the database stops honouring this worker immediately.
        const { error: pErr } = await db.from("profiles").update({ active }).eq("user_id", w.user_id);
        if (pErr) fail(pErr.message, 500);
        // Then block (or allow) sign-in itself.
        const { error: bErr } = await db.auth.admin.updateUserById(w.user_id, { ban_duration: active ? "none" : "876000h" });
        if (bErr) fail(bErr.message, 500);
        const revokeError = active ? null : await revokeSessions(w.user_id);
        return json({ ok: true, warning: revokeError ? `Deactivated, but could not sign them out of open sessions (${revokeError}).` : undefined });
      }

      // ------------------------------------------------------------------
      case "resend_code": {
        const w = await loadWorker(body.user_id, callerId);
        if (!w.active) fail("This worker is deactivated. Reactivate them first.");
        const codeError = await sendCode(w.email);
        if (codeError) fail("Could not send the code: " + codeError, 502);
        return json({ ok: true });
      }

      // ------------------------------------------------------------------
      case "reset_access": {
        const w = await loadWorker(body.user_id, callerId);
        if (!w.active) fail("This worker is deactivated. Reactivate them first.");
        // Replace the old password with a random one nobody knows, and mark
        // the account "needs a password" so the app makes them pick a new one.
        const { error: wErr } = await db.auth.admin.updateUserById(w.user_id, {
          password: crypto.randomUUID() + crypto.randomUUID(),
          user_metadata: { name: w.name, password_set: false },
        });
        if (wErr) fail(wErr.message, 500);
        const revokeError = await revokeSessions(w.user_id);
        const codeError = await sendCode(w.email);
        const problems = [
          revokeError ? `could not sign them out of open sessions (${revokeError})` : "",
          codeError ? `the login code email could not be sent (${codeError})` : "",
        ].filter(Boolean);
        return json({ ok: true, warning: problems.length ? `Access was reset, but ${problems.join(" and ")}.` : undefined });
      }

      // ------------------------------------------------------------------
      case "list_status": {
        const { data: rows } = await db.from("profiles").select("user_id").eq("role", "worker");
        const ids = new Set((rows ?? []).map((r: { user_id: string }) => r.user_id));
        const last_sign_in: Record<string, string | null> = {};
        for (let page = 1; page <= 10; page++) {
          const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
          if (error) fail(error.message, 500);
          for (const u of data.users) if (ids.has(u.id)) last_sign_in[u.id] = u.last_sign_in_at ?? null;
          if (data.users.length < 200) break;
        }
        return json({ ok: true, last_sign_in });
      }

      default:
        return fail("Unknown action.");
    }
  } catch (err) {
    if (err instanceof Refuse) return json({ error: err.message }, err.status);
    console.error("admin-create-worker failed", err);
    return json({ error: "Something went wrong on the server." }, 500);
  }
}

Deno.serve(handle);
