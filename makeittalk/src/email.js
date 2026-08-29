// Transactional email via Resend when RESEND_API_KEY is set; otherwise a
// silent no-op (signups auto-verify in that mode - see auth.js).

export async function sendEmail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY) return { skipped: true };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'makeittalk <hello@makeittalk.dev>',
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.log('resend error', res.status, await res.text().catch(() => ''));
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.log('resend unreachable', e.message);
    return { ok: false };
  }
}
