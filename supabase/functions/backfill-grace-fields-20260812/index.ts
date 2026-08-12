// ONE-TIME MIGRATION — 2026-08-12
//
// Adds no_show_grace_deadline: null and grace_extensions_used: 0 explicitly
// to every existing reservation that doesn't already have those keys, for
// completeness/auditability (so the field always exists on every row rather
// than being silently absent on historical ones).
//
// Deliberately different from what caused today's incident: this NEVER
// computes a real deadline from date/from for historical rows — only an
// explicit `null`, which grace-period-check's `if (!r.no_show_grace_deadline)
// continue;` treats identically to the field being absent. This migration
// cannot make any reservation eligible for auto-no-show that wasn't already.
//
// Supports a dry run: POST { "dryRun": true } reports what it would change
// without writing anything. Always dry-run first.
//
// Deploy: supabase functions deploy backfill-grace-fields-20260812
// Dry run: curl -X POST .../functions/v1/backfill-grace-fields-20260812 -H "..." -d '{"dryRun":true}'
// Real run: same without the body (or {"dryRun":false})
// Then delete it — one-time use only, same as the incident rollback function.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface Reservation {
  id: string;
  no_show_grace_deadline?: string | null;
  grace_extensions_used?: number;
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

Deno.serve(async (req) => {
  try {
    let dryRun = true; // default to the safe option if the body is empty/missing
    try {
      const body = await req.json();
      if (body && body.dryRun === false) dryRun = false;
    } catch {
      // no body sent at all -> stays dryRun = true
    }

    const reservations = await kvGet<Reservation[]>('reservations', []);

    let willChange = 0;
    for (const r of reservations) {
      const needsDeadlineField = !('no_show_grace_deadline' in r);
      const needsExtensionsField = !('grace_extensions_used' in r);
      if (needsDeadlineField || needsExtensionsField) {
        willChange++;
        if (!dryRun) {
          if (needsDeadlineField) r.no_show_grace_deadline = null;
          if (needsExtensionsField) r.grace_extensions_used = 0;
        }
      }
    }

    if (!dryRun && willChange > 0) {
      await kvSet('reservations', reservations);
    }

    return new Response(
      JSON.stringify({ ok: true, dryRun, total: reservations.length, changed: willChange }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
