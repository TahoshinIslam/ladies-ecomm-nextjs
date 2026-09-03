import nodemailer from "nodemailer";

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
  const from = `"${process.env.FROM_NAME || "ShoeStore"}" <${
    process.env.FROM_EMAIL || "noreply@shoestore.com"
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

// Pre-built email templates
export const buildVerificationEmail = (name, link) => ({
  subject: "Verify your ShoeStore account",
  html: `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
      <h2>Welcome, ${name}</h2>
      <p>Tap the button below to verify your email and activate your account.</p>
      <a href="${link}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;border-radius:8px;text-decoration:none;margin:16px 0">Verify email</a>
      <p style="color:#666;font-size:13px">Link expires in 24 hours.</p>
    </div>
  `,
});

export const buildPasswordResetEmail = (name, link) => ({
  subject: "Reset your ShoeStore password",
  html: `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
      <h2>Hi ${name}</h2>
      <p>We received a request to reset your password. This link expires in 15 minutes.</p>
      <a href="${link}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;border-radius:8px;text-decoration:none;margin:16px 0">Reset password</a>
      <p style="color:#666;font-size:13px">If you didn't request this, ignore this email.</p>
    </div>
  `,
});
