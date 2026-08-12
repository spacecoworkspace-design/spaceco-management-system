// validate-booking-window
//
// Genuine server-side check for the 90-day booking window, called by
// book.html's submitBooking() right before it writes. The client-side check
// (max attribute + onDateChange/shiftDate clamping + a submission-time
// re-check) already exists and stays — this just adds a check that can't be
// bypassed by a client with its system clock set wrong, since it uses this
// function's own server clock instead.
//
// Deliberately stateless: does not read or write spaceco_kv or anything
// else. Given today's incident with grace-period-check, anything touching
// live reservation data gets extra scrutiny — this function structurally
// cannot corrupt anything, since it has no side effects at all.
//
// Deploy: supabase functions deploy validate-booking-window

const BOOKING_WINDOW_DAYS = 90;

function todayStr(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

Deno.serve(async (req) => {
  try {
    const { date } = await req.json();
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ valid: false, error: 'invalid date format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const max = new Date(now);
    max.setDate(max.getDate() + BOOKING_WINDOW_DAYS);

    const minStr = todayStr(now);
    const maxStr = todayStr(max);
    const valid = date >= minStr && date <= maxStr;

    return new Response(JSON.stringify({ valid, minDate: minStr, maxDate: maxStr }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ valid: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
