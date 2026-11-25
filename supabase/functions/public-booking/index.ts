// public-booking
//
// The only door the public booking page (book.html) has into SpaceCo data once
// the database is locked to signed-in staff.
//
//   'availability' -> busy times only (room, date, from, to). No names, no phones.
//   'book'         {name, phone, room, date, from, to, notes}
//                  -> re-checks the slot and adds ONE pending online reservation.
//   'package'      {name, phone, notes, month, monthLabel, lines[]}
//                  -> adds ONE pending next-month package request.
//
// It never returns other customers' details and never edits or removes anything.
//
// Deploy: supabase functions deploy public-booking

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ROOMS = ['Room 4 Persons (1)', 'Room 4 Persons (2)', 'Room 6 Persons', 'Room 8 Persons', 'Class Room', 'Shared Space', 'Drawing Room'];
const WINDOW_DAYS = 90;
const HEARD = ['instagram', 'facebook', 'tiktok', 'google', 'friend', 'passing', 'returning', 'other'];
const heardOf = (v: unknown) => (HEARD.includes(String(v)) ? String(v) : '');
const OPEN_END = '23:00', OPEN_WEEKDAY = '09:00', OPEN_FRIDAY = '11:00';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

async function getKey(key: string): Promise<unknown[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/spaceco_kv?key=eq.${encodeURIComponent(key)}&select=value`, { headers: H });
  if (!r.ok) throw new Error('read failed');
  const rows = await r.json();
  if (Array.isArray(rows) && rows.length && rows[0].value != null) {
    const v = JSON.parse(rows[0].value);
    return Array.isArray(v) ? v : [];
  }
  return [];
}
// Update in place; create only if missing. Never deletes first, so a failed
// write can never make the record disappear.
async function putKey(key: string, val: unknown) {
  const u = await fetch(`${SUPABASE_URL}/rest/v1/spaceco_kv?key=eq.${encodeURIComponent(key)}&select=key`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ value: JSON.stringify(val) }),
  });
  if (!u.ok) throw new Error('write failed');
  const rows = await u.json().catch(() => []);
  if (Array.isArray(rows) && rows.length) return;
  const p = await fetch(`${SUPABASE_URL}/rest/v1/spaceco_kv`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ key, value: JSON.stringify(val) }),
  });
  if (!p.ok) throw new Error('write failed');
}

// Cairo calendar date, whatever the server's own time zone is.
function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function cairoNowMin(): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value || 0);
  return (g('hour') % 24) * 60 + g('minute');
}
function addDays(d: string, n: number) {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const isTime = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z'));
// Customer text is shown inside the staff app, so it must never carry HTML or script:
// control characters and < > " ' ` & \ are removed.
const clean = (s: unknown, max: number) =>
  String(s ?? '').replace(/[\u0000-\u001f\u007f<>"'`&\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (s: unknown) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
const cleanPhone = (s: unknown) => String(s ?? '').replace(/[^\d+]/g, '').slice(0, 20);

type R = { date?: string; room?: string; from?: string; to?: string; status?: string };
function busy(date: string, room: string, resv: R[], blocks: R[]) {
  const out: { from: number; to: number }[] = [];
  resv.filter((r) => r.date === date && r.room === room && r.status !== 'no_show' && r.status !== 'cancelled' && r.status !== 'rejected')
    .forEach((r) => out.push({ from: toMin(r.from || '00:00'), to: toMin(r.to || '00:00') }));
  blocks.filter((b) => b.date === date && b.room === room).forEach((b) => out.push({ from: toMin(b.from || '00:00'), to: toMin(b.to || '00:00') }));
  return out;
}
const free = (s: number, e: number, b: { from: number; to: number }[]) => !b.some((x) => s < x.to && e > x.from);

// Per-device flood guard. The caller's address is never stored: only a short
// one-way tag that changes every day, so it cannot be traced back or reused.
const PER_DEVICE_PER_HOUR = 8;
async function deviceTag(req: Request): Promise<string> {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  const data = new TextEncoder().encode(ip + '|' + cairoToday() + '|' + SERVICE.slice(-16));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(h.slice(0, 8)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
const recentFromDevice = (list: Record<string, unknown>[], tag: string) => {
  const hourAgo = Date.now() - 3600_000;
  return list.filter((r) => r.dev === tag && Date.parse(String(r.createdAt || '')) > hourAgo).length;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAKE_OK = (id: string) => json({ ok: true, id });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const len = Number(req.headers.get('content-length') || 0);
  if (len > 20000) return json({ error: 'Request too large' }, 413);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ error: 'bad request' }, 400); }

  try {
    // Bots fill the hidden "website" box; people never see it. Pretend it worked.
    if ((b.action === 'book' || b.action === 'package') && String(b.hp || '').trim()) {
      return b.action === 'book' ? FAKE_OK('ol_' + Date.now()) : json({ ok: true, request: { id: 'pkg_' + Date.now(), status: 'pending' } });
    }
    if (b.action === 'availability') {
      const today = cairoToday();
      const strip = (x: R) => ({ date: x.date, room: x.room, from: x.from, to: x.to, status: x.status });
      const [resv, blocks] = await Promise.all([getKey('reservations'), getKey('roomBlocks')]);
      return json({
        reservations: (resv as R[]).filter((r) => (r.date || '') >= today).map(strip),
        blocks: (blocks as R[]).filter((x) => (x.date || '') >= today).map((x) => ({ date: x.date, room: x.room, from: x.from, to: x.to })),
      });
    }

    if (b.action === 'book') {
      const name = clean(b.name, 80), phone = cleanPhone(b.phone), notes = clean(b.notes, 500);
      const room = String(b.room || ''), date = b.date, from = b.from, to = b.to;
      if (!name || phone.replace(/\D/g, '').length < 8) return json({ error: 'Please enter your name and phone number.' }, 400);
      if (!ROOMS.includes(room)) return json({ error: 'Unknown room.' }, 400);
      if (!isDate(date) || !isTime(from) || !isTime(to)) return json({ error: 'Invalid date or time.' }, 400);
      const today = cairoToday(), max = addDays(today, WINDOW_DAYS);
      if (date < today || date > max) return json({ error: 'window', maxDate: max }, 400);
      const s = toMin(from), e = toMin(to);
      const open = new Date(date + 'T12:00:00Z').getUTCDay() === 5 ? OPEN_FRIDAY : OPEN_WEEKDAY;
      if (e <= s || s < toMin(open) || e > toMin(OPEN_END)) return json({ error: 'Outside opening hours.' }, 400);
      if (date === today && s < cairoNowMin() - 15) return json({ error: 'That time has already passed. Please pick a later time.' }, 400);

      const dev = await deviceTag(req);
      const digits = phone.replace(/\D/g, '').slice(-10);
      const newRes = {
        id: 'ol_' + Date.now() + '_' + crypto.randomUUID().slice(0, 6),
        client: name, phone, room, date, from, to, notes, heardFrom: heardOf(b.heardFrom),
        created_by: 'online', source: 'online', status: 'pending',
        createdAt: new Date().toISOString(), dev,
      };
      // Read, check, add, save -- then read back to make sure the booking is really
      // there (another save at the same moment could have replaced the list).
      for (let attempt = 0; attempt < 4; attempt++) {
        const [resv, blocks] = await Promise.all([getKey('reservations'), getKey('roomBlocks')]);
        const list = resv as Record<string, unknown>[];
        if (list.some((r) => r.id === newRes.id)) return json({ ok: true, id: newRes.id });
        if (!free(s, e, busy(date, room, resv as R[], blocks as R[]))) return json({ error: 'taken' }, 409);
        // Flood guards: per phone number, and per device per hour.
        const pendingSame = list.filter((r) => r.source === 'online' && r.status === 'pending' && String(r.phone || '').replace(/\D/g, '').slice(-10) === digits).length;
        if (pendingSame >= 5) return json({ error: 'You already have several requests waiting. We will contact you on WhatsApp.' }, 429);
        if (recentFromDevice(list, dev) >= PER_DEVICE_PER_HOUR) return json({ error: 'Too many requests from this device. Please try again later or message us on WhatsApp.' }, 429);
        list.push(newRes);
        await putKey('reservations', list);
        await sleep(400 + Math.floor(Math.random() * 300));
        const check = (await getKey('reservations')) as Record<string, unknown>[];
        if (check.some((r) => r.id === newRes.id)) return json({ ok: true, id: newRes.id });
      }
      return json({ error: 'Something went wrong. Please try again.' }, 503);
    }

    if (b.action === 'package') {
      const name = clean(b.name, 80), phone = cleanPhone(b.phone), notes = clean(b.notes, 500);
      if (!name || phone.replace(/\D/g, '').length < 8) return json({ error: 'Please enter your name and phone number.' }, 400);
      const lines = Array.isArray(b.lines) ? b.lines.slice(0, 20) : [];
      if (!lines.length) return json({ error: 'Please add at least one room/schedule to your request.' }, 400);
      const okLines = lines.map((l: Record<string, unknown>) => ({
        id: safeId(l.id), room: String(l.room || ''),
        weekdays: Array.isArray(l.weekdays) ? l.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).slice(0, 7) : [],
        from: l.from, to: l.to,
        dates: Array.isArray(l.dates) ? l.dates.filter(isDate).slice(0, 31) : [],
      }));
      if (okLines.some((l) => !ROOMS.includes(l.room) || !isTime(l.from) || !isTime(l.to) || !l.weekdays.length)) return json({ error: 'Invalid schedule.' }, 400);
      const reqObj = {
        id: 'pkg_' + Date.now() + '_' + crypto.randomUUID().slice(0, 6),
        client: name, phone, heardFrom: heardOf(b.heardFrom), month: /^\d{4}-\d{2}$/.test(String(b.month)) ? String(b.month) : '', monthLabel: clean(b.monthLabel, 40),
        lines: okLines, notes, createdAt: new Date().toISOString(), status: 'pending', fee: null,
      };
      const dev = await deviceTag(req);
      const digits = phone.replace(/\D/g, '').slice(-10);
      (reqObj as Record<string, unknown>).dev = dev;
      for (let attempt = 0; attempt < 4; attempt++) {
        const list = (await getKey('packageRequests')) as Record<string, unknown>[];
        if (list.some((r) => r.id === reqObj.id)) return json({ ok: true, request: reqObj });
        if (list.filter((r) => r.status === 'pending' && String(r.phone || '').replace(/\D/g, '').slice(-10) === digits).length >= 3)
          return json({ error: 'You already have requests waiting. We will contact you on WhatsApp.' }, 429);
        if (recentFromDevice(list, dev) >= 3) return json({ error: 'Too many requests from this device. Please try again later or message us on WhatsApp.' }, 429);
        list.push(reqObj);
        await putKey('packageRequests', list);
        await sleep(400 + Math.floor(Math.random() * 300));
        const check = (await getKey('packageRequests')) as Record<string, unknown>[];
        if (check.some((r) => r.id === reqObj.id)) return json({ ok: true, request: reqObj });
      }
      return json({ error: 'Something went wrong. Please try again.' }, 503);
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error('public-booking', String(e));
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
