// staff-accounts
//
// Staff sign-in accounts for the SpaceCo management system.
// - Public (anyone):    'names'  -> the names shown on the sign-in screen (every account that
//                                   signs in by name, staff or admin alike), with the internal
//                                   sign-in address for each (never a real inbox).
// - Any signed-in user: 'set-own-password' {current, password} -> checks the current
//                                   password, sets the new one, clears "must change".
// - Admin only:         'list', 'create' {name, password}, 'reset' {userId, password},
//                       'disable' {userId}, 'enable' {userId}  (any account except your own)
//
// Passwords are never stored or logged here; Supabase Auth keeps only a hash.
// Admin = app_metadata.role === 'admin' (set by the owner with SQL; users cannot change it).
//
// Deploy: supabase functions deploy staff-accounts

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const STAFF_DOMAIN = Deno.env.get('STAFF_EMAIL_DOMAIN') || 'staff.spaceco.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

type U = { id: string; email: string; app_metadata?: Record<string, unknown>; banned_until?: string | null; last_sign_in_at?: string | null; created_at?: string };

async function allUsers(): Promise<U[]> {
  const out: U[] = [];
  for (let page = 1; page < 20; page++) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: adminHeaders });
    if (!r.ok) throw new Error('could not list users');
    const d = await r.json();
    const users: U[] = d.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}
const isBanned = (u: U) => !!u.banned_until && new Date(u.banned_until).getTime() > Date.now();
const nameOf = (u: U) => String(u.app_metadata?.name || '');

async function updateUser(id: string, body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('update failed: ' + (await r.text()).slice(0, 200));
  return await r.json();
}

async function caller(req: Request): Promise<U | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token === ANON) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return await r.json();
}

function checkPassword(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < 8) return 'The password must be at least 8 characters.';
  if (p.length > 72) return 'The password is too long.';
  if (/^(1234|12345678|password|admin|spaceco)/i.test(p)) return 'Please choose a less obvious password.';
  return null;
}
function slug(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'staff';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
  const action = String(body.action || '');

  try {
    if (action === 'names') {
      const users = await allUsers();
      const staff = users
        // everyone who signs in by name (internal address), staff or admin alike
        .filter((u) => u.email.endsWith('@' + STAFF_DOMAIN) && !isBanned(u) && nameOf(u))
        .map((u) => ({ name: nameOf(u), email: u.email }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return json({ staff });
    }

    const me = await caller(req);
    if (!me) return json({ error: 'Please sign in again.' }, 401);

    if (action === 'set-own-password') {
      const bad = checkPassword(body.password);
      if (bad) return json({ error: bad }, 400);
      if (body.password === body.current) return json({ error: 'The new password must be different.' }, 400);
      // confirm the current password
      const t = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: me.email, password: String(body.current || '') }),
      });
      if (!t.ok) return json({ error: 'The current password is incorrect.' }, 403);
      await updateUser(me.id, { password: body.password, app_metadata: { ...(me.app_metadata || {}), must_change: false } });
      return json({ ok: true });
    }

    if (me.app_metadata?.role !== 'admin') return json({ error: 'Admin only.' }, 403);

    if (action === 'list') {
      const users = await allUsers();
      return json({
        users: users.filter((u) => nameOf(u)).map((u) => ({
          id: u.id, name: nameOf(u), role: u.app_metadata?.role || '', mustChange: !!u.app_metadata?.must_change,
          disabled: isBanned(u), lastSignIn: u.last_sign_in_at || null, createdAt: u.created_at || null,
          isMe: u.id === me.id,
        })),
      });
    }

    if (action === 'create') {
      const name = String(body.name || '').trim();
      if (!name || name.length > 40) return json({ error: 'Please enter a name.' }, 400);
      const bad = checkPassword(body.password);
      if (bad) return json({ error: bad }, 400);
      const users = await allUsers();
      if (users.some((u) => nameOf(u).toLowerCase() === name.toLowerCase())) return json({ error: name + ' already has an account.' }, 409);
      const email = `${slug(name)}-${crypto.randomUUID().slice(0, 8)}@${STAFF_DOMAIN}`;
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST', headers: adminHeaders,
        body: JSON.stringify({ email, password: body.password, email_confirm: true, app_metadata: { role: 'staff', name, must_change: true } }),
      });
      if (!r.ok) return json({ error: 'Could not create the account: ' + (await r.text()).slice(0, 200) }, 500);
      return json({ ok: true });
    }

    const id = String(body.userId || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Unknown account.' }, 400);
    if (id === me.id) return json({ error: 'Use "Change my password" for your own account.' }, 400);
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: adminHeaders });
    if (!ur.ok) return json({ error: 'Unknown account.' }, 404);
    const target: U = await ur.json();

    if (action === 'reset') {
      const bad = checkPassword(body.password);
      if (bad) return json({ error: bad }, 400);
      await updateUser(id, { password: body.password, app_metadata: { ...(target.app_metadata || {}), must_change: true } });
      return json({ ok: true });
    }
    if (action === 'disable') { await updateUser(id, { ban_duration: '876000h' }); return json({ ok: true }); }
    if (action === 'enable') { await updateUser(id, { ban_duration: 'none' }); return json({ ok: true }); }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error('staff-accounts', action, String(e));
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
