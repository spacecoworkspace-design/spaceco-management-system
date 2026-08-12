// grace-period-check
//
// Server-side source of truth for the 20-minute reservation grace period.
// Runs on a schedule (see ../../migrations/20260812000000_grace_period_cron.sql,
// every minute via pg_cron + pg_net) so the auto-cancel timer keeps working even
// if every staff device is closed. index.html only ever *reads* the fields this
// function writes (no_show_grace_deadline, graceExtensionsUsed, status,
// whatsappNoShowPending) to render the countdown/pulsing UI — it never flips
// status to 'no-show' on its own, which avoids two staff devices racing to do
// the same write.
//
// Data model note: this project doesn't use normalized tables for reservations —
// everything lives as a JSON blob in the `spaceco_kv` table (key='reservations'
// -> value=JSON array), read and replaced whole on every write, exactly like the
// sbGet/sbSet helpers in index.html and book.html. This function follows the
// same read-modify-write pattern server-side instead of inventing a new one.
//
// Deploy: supabase functions deploy grace-period-check
// (Needs to be run by someone with access to the live project — vfevpvfaeiwltixgdmln —
// this was written and tested for logic only; it has not been deployed.)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// Service role key is auto-injected into every deployed Edge Function's
// environment by Supabase — nothing to configure manually.
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface Reservation {
  id: string;
  client: string;
  phone?: string;
  room: string;
  date: string;       // YYYY-MM-DD
  from: string;        // HH:MM
  to: string;
  status?: string;      // 'pending' | 'upcoming' | 'arrived' | 'no-show'
  source?: string;      // 'online' when submitted through book.html
  academyKey?: string | null;
  no_show_grace_deadline?: string; // ISO timestamp
  graceExtensionsUsed?: number;
  whatsappNoShowPending?: boolean;
  autoNoShow?: boolean;
  [key: string]: unknown;
}

interface Academy {
  enforceNoShowRule?: boolean;
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
  // Same delete-then-insert pattern sbSet() uses client-side — kept identical
  // rather than switching to upsert, so behavior matches exactly.
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
    const [reservations, academies, clientProfiles] = await Promise.all([
      kvGet<Reservation[]>('reservations', []),
      kvGet<Record<string, Academy>>('academies', {}),
      kvGet<ClientProfile[]>('clientProfiles', []),
    ]);

    const now = Date.now();
    let reservationsChanged = false;
    let profilesChanged = false;
    const autoNoShows: Reservation[] = [];

    for (const r of reservations) {
      // Must be EXPLICITLY 'upcoming' AND have its own no_show_grace_deadline —
      // i.e. created through the grace-period-aware code path. Historical
      // reservations (most of this table) have neither and must never be
      // touched: an earlier version of this function fell back to `r.status ||
      // 'upcoming'` and computed a deadline from date/from for rows missing
      // both, which silently flipped ~293 old reservations to no-show the
      // first time it ran. Never treat a missing field as an implicit default
      // here again.
      if (r.status !== 'upcoming') continue;
      if (!r.no_show_grace_deadline) continue;

      // Academy sessions with enforceNoShowRule === false hold the room regardless —
      // skip grace-period tracking entirely, matching index.html's isAcademyNoShowExempt().
      if (r.academyKey && academies[r.academyKey]?.enforceNoShowRule === false) continue;

      const start = new Date(`${r.date}T${r.from}:00`).getTime();
      if (now < start) continue; // not started yet

      const deadline = new Date(r.no_show_grace_deadline).getTime();

      if (now >= deadline) {
        r.status = 'no-show';
        r.autoNoShow = true;
        // The client (index.html) surfaces a "Notify" button for this — a background
        // job can't open a wa.me link in anyone's browser, so it can only flag it.
        if (r.source === 'online' && r.phone) r.whatsappNoShowPending = true;
        reservationsChanged = true;
        autoNoShows.push(r);
      }
    }

    if (autoNoShows.length) {
      for (const r of autoNoShows) {
        const profile = clientProfiles.find((p) => normalizeStr(p.name) === normalizeStr(r.client));
        if (profile) {
          profile.noShows = (profile.noShows || 0) + 1;
          profilesChanged = true;
        }
      }
    }

    if (reservationsChanged) await kvSet('reservations', reservations);
    if (profilesChanged) await kvSet('clientProfiles', clientProfiles);

    return new Response(
      JSON.stringify({ ok: true, checked: reservations.length, autoNoShows: autoNoShows.length }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('grace-period-check failed', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
