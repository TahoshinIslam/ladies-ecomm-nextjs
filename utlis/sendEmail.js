import nodemailer from "nodemailer";

import { escapeHtml } from "../lib/htmlEscape.js";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send an email.
 * @param {object} opts - { to, subject, html, text }
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  const from = `"${process.env.FROM_NAME || "TAHOS."}" <${
    process.env.FROM_EMAIL || "noreply@tahos.store"
  }>`;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text: text || "",
    html: html || text || "",
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("📧 Email sent:", info.messageId);
  }
  return info;
};

// Pre-built email templates.
//
// `name` is user-controlled (set at registration, changeable via
// PUT /api/users/me) and MUST be HTML-escaped before interpolation — an
// unescaped name like `<img src=x onerror=alert(1)>` would otherwise
// execute in any mail client that renders HTML. `link` is server-
// constructed (see services/userService.js's buildAbsoluteResetUrl) from a
// validated origin + a hex token, never from raw user input, but is still
// escaped here as defense in depth — escaping a value that's already
// URL-safe is a no-op.
export const buildPasswordResetEmail = (name, link) => ({
  subject: "Reset your TAHOS. password",
  html: `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
      <h2>Hi ${escapeHtml(name)}</h2>
      <p>We received a request to reset your password. This link expires in 15 minutes.</p>
      <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;border-radius:8px;text-decoration:none;margin:16px 0">Reset password</a>
      <p style="color:#666;font-size:13px">If you didn't request this, ignore this email.</p>
    </div>
  `,
  text: `Hi ${name}\n\nWe received a request to reset your password. This link expires in 15 minutes.\n\n${link}\n\nIf you didn't request this, ignore this email.`,
});
