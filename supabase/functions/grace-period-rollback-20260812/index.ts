// ONE-TIME INCIDENT FIX — 2026-08-12
//
// The first-ever invocation of grace-period-check contained a bug (fixed in
// that function now) that treated any reservation with a missing status
// field as an implicit 'upcoming', computed a fallback grace deadline from
// its date/from even though it had no no_show_grace_deadline of its own, and
// flipped 293 historical reservations to 'no-show' as a result, incrementing
// the matching clients' noShows counts along the way.
//
// This reverts exactly those rows: every reservation this function itself
// marked (r.autoNoShow === true, a field that did not exist before that
// buggy run — every row carrying it was created by that one invocation, so
// there is no ambiguity about what to target) has status restored to
// 'upcoming' (behaviorally identical to how it rendered before — every read
// path in this app treats r.status || 'upcoming' the same way, so setting it
// explicitly changes nothing observable), autoNoShow and
// whatsappNoShowPending removed, and each affected client's noShows count
// decremented by exactly how many of their own reservations are being
// reverted here (name-matched, mirroring how the increment was applied).
//
// Deploy, invoke once, confirm the counts look right, then delete this
// function — it has no reason to exist beyond this one cleanup.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface Reservation {
  id: string;
  client: string;
  status?: string;
  autoNoShow?: boolean;
  whatsappNoShowPending?: boolean;
  [key: string]: unknown;
}

interface ClientProfile {
  name: string;
  noShows?: number;
  [key: string]: unknown;
}

async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/spaceco_kv?key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
  );
  const rows = await res.json();
  if (Array.isArray(rows) && rows.length && rows[0].value !== null) {
    return JSON.parse(rows[0].value) as T;
  }
  return fallback;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/spaceco_kv?key=eq.${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  await fetch(`${SUPABASE_URL}/rest/v1/spaceco_kv`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ key, value: JSON.stringify(value) }),
  });
}

function normalizeStr(s: string | undefined | null): string {
  return (s || '').trim().toLowerCase();
}

Deno.serve(async (_req) => {
  try {
    const [reservations, clientProfiles] = await Promise.all([
      kvGet<Reservation[]>('reservations', []),
      kvGet<ClientProfile[]>('clientProfiles', []),
    ]);

    let reverted = 0;
    const decrementCounts: Record<string, number> = {};

    for (const r of reservations) {
      if (r.autoNoShow === true) {
        r.status = 'upcoming';
        delete r.autoNoShow;
        delete r.whatsappNoShowPending;
        reverted++;
        const key = normalizeStr(r.client);
        decrementCounts[key] = (decrementCounts[key] || 0) + 1;
      }
    }

    let profilesFixed = 0;
    for (const p of clientProfiles) {
      const key = normalizeStr(p.name);
      if (decrementCounts[key]) {
        p.noShows = Math.max(0, (p.noShows || 0) - decrementCounts[key]);
        profilesFixed++;
      }
    }

    await Promise.all([kvSet('reservations', reservations), kvSet('clientProfiles', clientProfiles)]);

    return new Response(JSON.stringify({ ok: true, reverted, profilesFixed }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('rollback failed', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
