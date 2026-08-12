# Grace Period Auto-Cancel + 90-Day Booking Window

Two features added on top of the existing reservations system. Both are additive —
existing reservations, academy contracts, WhatsApp flows, and staff shift tracking
are unchanged.

## 1. 20-minute grace period (index.html)

**How it works now:** a confirmed reservation (`status: 'upcoming'`) gets a
`no_show_grace_deadline` the moment it's confirmed — created directly by staff, or
online and then Accepted, or booked as a recurring/academy session. That deadline
is always `start time + 20 minutes`, computed once, so nothing has to guess who
"noticed" a reservation first across multiple staff devices.

- **Check In** (new button, Reservations table): sets status to `arrived` — the
  same status the existing guest walk-in name-match already uses, so nothing else
  in the app needs to treat "checked in via reservation" differently from
  "checked in via guest check-in."
- **Extend Grace (+15 min)** (new button): pushes the deadline back 15 minutes,
  up to 2 times per reservation (max 50 min total grace). Disabled after 2 uses.
- **Auto no-show**: handled by the new `grace-period-check` Edge Function
  (`supabase/functions/grace-period-check`), scheduled every minute via pg_cron
  (`supabase/migrations/20260812000000_grace_period_cron.sql`). **This still
  needs to be deployed** — see below. Until it's deployed, overdue reservations
  show a "🚫 grace expired" indicator but won't flip to `no-show` on their own;
  the existing manual "🚫" No-show button still works as a fallback the whole
  time, exactly as it did before this change.
- **WhatsApp notice on no-show**: the Edge Function can't open a WhatsApp window
  (it's a background job, not a browser), so for online bookings it flags
  `whatsappNoShowPending: true` instead. A "📤 Notify" button appears in the
  Reservations table for those — one click sends the same click-to-chat message
  the manual no-show path already sends. Manually marking a no-show (the old 🚫
  button) now sends this WhatsApp notice immediately too, for consistency.
- **Academy exemption**: each academy now has an "Enforce 20-min no-show grace
  period" checkbox (Add Academy modal, and the academy editor for existing ones).
  Unchecked = that academy's linked reservations skip grace-period tracking
  entirely and the room just stays held. Defaults to checked/on for every
  existing academy (no behavior change until someone explicitly turns it off).

**Deployed 2026-08-12.** `supabase functions deploy grace-period-check`, then run
`supabase/migrations/20260812000000_grace_period_cron.sql` (schedules it every
minute via pg_cron) — read the comment at the top first, it needs the real
service-role key substituted in at run time, not committed to the file.

**Incident, 2026-08-12, caught and fixed same day:** the first deployed version of
this function fell back to `r.status || 'upcoming'` and computed a deadline from
`date`/`from` for any reservation missing both `status` and
`no_show_grace_deadline` — which is nearly every historical reservation, since
that field didn't exist before this feature. The very first invocation flipped
293 of the 530 real reservations to `no-show` and incremented 21 real clients'
no-show counts. Caught immediately by checking the function's own response
(`autoNoShows: 293` on a project with no live grace-period reservations yet was
an obvious signal something was wrong). Fixed by requiring both `status ===
'upcoming'` (exact, not defaulted) and a present `no_show_grace_deadline` before
touching a row — historical reservations now always fall through untouched. Same
tightening applied to the client-side `reservationGraceState()` in index.html, so
old bookings never show a false "grace expired" badge either. Reverted via a
one-time `grace-period-rollback-20260812` function (deployed, invoked once,
deleted immediately after): restored `status` to `'upcoming'` and decremented
`noShows` by exactly the count reverted per client — confirmed exact numbers
(293 reservations, 21 profiles) matched the incident, then re-ran the fixed
function and confirmed `autoNoShows: 0`.

**Known limitation, inherent to how this app already stores data:** reservations
live as one JSON blob per key in `spaceco_kv`, read-modify-written whole on every
save (not per-row updates). Two simultaneous writes — e.g. a staff member editing
a reservation at the exact moment the cron job runs — can race, same as any two
staff editing reservations at the same moment already could before this change.
Not something this feature introduces or attempts to fix.

## 2. 90-day booking window (book.html)

The public booking widget's date picker now has `max` set to today + 90 days, and
`shiftDate()`/`onDateChange()` reject anything beyond that with:
"Bookings can only be made up to 90 days in advance. Please select a date before
[date]." `submitBooking()` re-checks the same limit right before writing, so a
stale page (open past midnight, or with the date manually edited) can't slip a
booking through. There's no real application server in this stack — the "server-
side" check is this submission-time re-validation against the client's own clock,
which is the closest equivalent available in a static-page + PostgREST setup.
