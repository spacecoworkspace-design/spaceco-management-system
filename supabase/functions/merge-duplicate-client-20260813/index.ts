// ONE-TIME DATA FIX — 2026-08-13 (rewritten after the first dry run showed
// the real cause was worse than initially assumed)
//
// Investigated further after the first dry run reported canonicalProfile:
// null. The client "Ahmed Tawila" (phone 01001722443) doesn't just have a
// second profile under a misspelled name ("Ahmed twela") -- the ORIGINAL
// profile (id p1785609116611_epg1q18nsv) is missing from clientProfiles
// entirely (checked all 345 entries directly by id, name, and phone: not
// there), even though the shared-space package and most of his check-in
// history still reference that exact profileId. Likely lost to a write
// race between two staff devices -- this app stores clientProfiles as one
// whole-array overwrite per save, no per-row locking, a known weak spot.
//
// Live risk this fixes: with the profile gone, the NEXT check-in/checkout
// for this client -- including the session that was still open in the
// screenshots that triggered this investigation -- would silently create a
// brand-new profile with a new id, which would NOT match the package's
// stored profileId. His 15 remaining free package days would become
// unreachable and he'd be charged full price again.
//
// Fix: recreate the profile with its EXACT original id, so the package
// linkage (which was never actually broken, just pointing at a profile
// that had vanished) is restored without touching the package record
// itself. Also cleans up the two 0-value duplicate check-in rows filed
// under "Ahmed twela" and re-attaches 3 real drink-order charges (185 LE,
// already correctly collected -- nothing to refund) from that spelling to
// the correct name.
//
// Supports a dry run: POST { "dryRun": true } reports what it would change
// without writing anything. Always dry-run first.
//
// Deploy: supabase functions deploy merge-duplicate-client-20260813
// Then delete it -- one-time use only, same as the earlier incident rollback.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Confirmed directly from the live data: the package and most of this
// client's check-in history reference this exact profileId, which no
// longer exists in clientProfiles. The two 0-value junk check-ins were
// filed under this second, also-nonexistent id and the misspelled name.
const CANONICAL_ID = 'p1785609116611_epg1q18nsv';
const CANONICAL_NAME = 'Ahmed Tawila';
const CANONICAL_PHONE = '01001722443';
const ORPHAN_DUPLICATE_ID = 'p1786391576520_wymsghuqhp';
const DUPLICATE_NAME = 'Ahmed twela';

interface ClientProfile {
  id: string;
  name: string;
  normalizedName: string;
  phone?: string;
  [key: string]: unknown;
}
interface CheckIn {
  id: number;
  profileId?: string;
  name?: string;
  cost?: number;
  hours?: string;
  [key: string]: unknown;
}
interface DrinkOrder {
  id: number;
  client?: string;
  [key: string]: unknown;
}
interface RecycleBinEntry {
  binId: string;
  type: string;
  deletedAt: string;
  data: unknown;
  extra?: unknown;
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

Deno.serve(async (req) => {
  try {
    // Query param is primary -- a JSON -d body kept hitting PowerShell 5.1
    // quoting bugs (embedded double-quotes silently stripped before curl.exe
    // ever saw them, so the server received invalid JSON and quietly fell
    // back to the safe default with no visible error). ?dryRun=false needs
    // no embedded quotes/braces at all, so there's nothing left to mangle.
    let dryRun = true;
    const queryFlag = new URL(req.url).searchParams.get('dryRun');
    if (queryFlag === 'false') dryRun = false;
    try {
      const body = await req.json();
      if (body && body.dryRun === false) dryRun = false;
    } catch {
      // no body / not JSON -> query param (or the safe default) still applies
    }

    const [clientProfiles, clients, drinkOrders, sharedSpacePackages, recycleBin] = await Promise.all([
      kvGet<ClientProfile[]>('clientProfiles', []),
      kvGet<CheckIn[]>('clients', []),
      kvGet<DrinkOrder[]>('drinkOrders', []),
      kvGet<Record<string, { profileId: string; clientName?: string; [k: string]: unknown }>>('sharedSpacePackages', {}),
      kvGet<RecycleBinEntry[]>('recycleBin', []),
    ]);

    const report: Record<string, unknown> = { dryRun };

    let existingCanonical = clientProfiles.find((p) => p.id === CANONICAL_ID);
    let profileRecreated = false;
    if (!existingCanonical) {
      profileRecreated = true;
      // Derive a plausible createdAt from the id's embedded timestamp
      // (p<millis>_<random>) rather than stamping "today" on a client
      // whose real first visit was 2026-08-01.
      const millisMatch = CANONICAL_ID.match(/^p(\d+)_/);
      const createdAt = millisMatch
        ? new Date(Number(millisMatch[1])).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      if (!dryRun) {
        clientProfiles.push({
          id: CANONICAL_ID,
          name: CANONICAL_NAME,
          normalizedName: normalizeStr(CANONICAL_NAME),
          phone: CANONICAL_PHONE,
          email: '',
          createdAt,
          noShows: 0,
          notes: '',
        });
      }
    }
    report.profileRecreated = profileRecreated;
    report.canonicalProfileId = CANONICAL_ID;

    // The two 0-value junk check-ins filed under the orphaned duplicate id/name.
    const junkCheckIns = clients.filter(
      (c) => c.profileId === ORPHAN_DUPLICATE_ID || normalizeStr(c.name) === normalizeStr(DUPLICATE_NAME)
    );
    for (const visit of junkCheckIns) {
      if (!dryRun) {
        recycleBin.push({
          binId: 'bin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          type: 'visit',
          deletedAt: new Date().toISOString(),
          data: visit,
        });
      }
    }
    report.junkCheckInsRemoved = junkCheckIns.length;

    // Re-attach drink orders logged under the misspelled name to the correct one.
    let renamedDrinkOrders = 0;
    for (const order of drinkOrders) {
      if (normalizeStr(order.client) === normalizeStr(DUPLICATE_NAME)) {
        renamedDrinkOrders++;
        if (!dryRun) order.client = CANONICAL_NAME;
      }
    }
    report.drinkOrdersReattached = renamedDrinkOrders;

    // Fix the package's own display name field -- profileId already correctly
    // points at the canonical id, only the stored label was wrong.
    const pkg = sharedSpacePackages[CANONICAL_ID];
    let packageNameFixed = false;
    if (pkg && normalizeStr(pkg.clientName) !== normalizeStr(CANONICAL_NAME)) {
      packageNameFixed = true;
      if (!dryRun) pkg.clientName = CANONICAL_NAME;
    }
    report.packageDisplayNameFixed = packageNameFixed;
    report.packageFound = !!pkg;

    if (!dryRun) {
      const junkIds = new Set(junkCheckIns.map((c) => c.id));
      const newClients = clients.filter((c) => !junkIds.has(c.id));
      await Promise.all([
        kvSet('clientProfiles', clientProfiles),
        kvSet('clients', newClients),
        kvSet('drinkOrders', drinkOrders),
        kvSet('sharedSpacePackages', sharedSpacePackages),
        kvSet('recycleBin', recycleBin),
      ]);
    }

    return new Response(JSON.stringify(report), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
