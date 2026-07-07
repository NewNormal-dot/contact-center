type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function getPublicBaseUrl() {
  const configured = process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.WEBSITE_HOSTNAME) return `https://${process.env.WEBSITE_HOSTNAME}`;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:5173';
  return 'http://localhost:8080';
}

export function buildPasswordSetupUrl(token: string) {
  return `${getPublicBaseUrl()}/setup-password?token=${encodeURIComponent(token)}`;
}

export async function sendEmail(payload: EmailPayload) {
  const webhookUrl = process.env.EMAIL_INVITE_WEBHOOK_URL || process.env.EMAIL_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn('[email] No webhook configured; skipping outbound email delivery.', {
      to: payload.to,
      subject: payload.subject,
    });
    return;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.EMAIL_WEBHOOK_SECRET) {
    headers.Authorization = `Bearer ${process.env.EMAIL_WEBHOOK_SECRET}`;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Email webhook failed (${response.status}): ${body.slice(0, 500)}`);
  }
}

export async function sendPasswordSetupEmail(params: {
  to: string;
  name: string;
  setupUrl: string;
  expiresAt: Date;
}) {
  const expires = params.expiresAt.toLocaleString('mn-MN', { hour12: false });
  const subject = 'Contact Center системийн нууц үг тохируулах холбоос';
  const text = [
    `Сайн байна уу, ${params.name}`,
    '',
    'Таны Contact Center системийн бүртгэл үүссэн байна.',
    'Доорх холбоосоор орж өөрийн нууц үгээ тохируулна уу.',
    params.setupUrl,
    '',
    `Холбоос хүчинтэй хугацаа: ${expires}`,
    'Хэрэв та энэ хүсэлтийг гаргаагүй бол системийн админтай холбогдоно уу.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <h2>Contact Center системийн нууц үг тохируулах</h2>
      <p>Сайн байна уу, <strong>${escapeHtml(params.name)}</strong></p>
      <p>Таны Contact Center системийн бүртгэл үүссэн байна. Доорх товч дээр дарж өөрийн нууц үгээ тохируулна уу.</p>
      <p><a href="${params.setupUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Нууц үг тохируулах</a></p>
      <p>Холбоос хүчинтэй хугацаа: <strong>${escapeHtml(expires)}</strong></p>
      <p style="color:#6b7280;font-size:13px">Хэрэв товч ажиллахгүй бол энэ холбоосыг browser дээрээ хуулж нээнэ үү:<br>${params.setupUrl}</p>
    </div>
  `;

  await sendEmail({ to: params.to, subject, text, html });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
