const nodemailer = require("nodemailer");
const crypto = require("crypto");

function createMailTransporter() {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || (process.env.SMTP_SECURE === "true" ? 465 : 587));
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (!user || !pass) {
    return null;
  }

  // If using Gmail, nodemailer's built-in service definition handles SSL/TLS and ports automatically
  if (
    process.env.SMTP_SERVICE?.toLowerCase() === "gmail" ||
    host === "smtp.gmail.com" ||
    user.endsWith("@gmail.com")
  ) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass
      }
    });
  }

  return nodemailer.createTransport({
    host: host || "smtp.gmail.com",
    port,
    secure,
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED === "true"
    }
  });
}

const hashOtp = (code) =>
  crypto.createHash("sha256").update(String(code).trim()).digest("hex");

function isOtpExpired(val) {
  if (val === undefined || val === null) return true;
  const num = Number(val);
  if (Number.isFinite(num) && num > 1000000000000) {
    return num < Date.now();
  }
  if (val instanceof Date) {
    return val.getTime() < Date.now();
  }
  const str = String(val).trim();
  const iso = str.includes(" ") && !str.includes("Z") ? str.replace(" ", "T") + "Z" : str;
  const time = new Date(iso).getTime();
  if (Number.isFinite(time)) {
    return time < Date.now();
  }
  return false;
}

async function sendOtpEmail(toEmail, otpCode, verifyLink) {
  const transporter = createMailTransporter();
  const smtpUser = (process.env.SMTP_USER || "").trim();
  const configuredFrom = (process.env.SMTP_FROM || "").trim();
  const from =
    configuredFrom && !configuredFrom.includes("noreply@example.com")
      ? configuredFrom
      : `"Bombay Chaat Bhandar" <${smtpUser || "noreply@example.com"}>`;

  if (!transporter) {
    console.log("\n=======================================================");
    console.log("🔑 [DEV MODE - NO SMTP CONFIGURED IN .ENV]");
    console.log(`Recipient : ${toEmail}`);
    console.log(`OTP Code  : ${otpCode}`);
    console.log(`Link      : ${verifyLink}`);
    console.log("👉 Tip: Configure SMTP_HOST, SMTP_USER, SMTP_PASS in .env to send real emails.");
    console.log("=======================================================\n");
    return { devMode: true };
  }

  try {
    await transporter.sendMail({
      from,
      to: toEmail,
      subject: `${otpCode} is your Bombay Chaat Bhandar login code`,
      text: `Your login verification code is: ${otpCode}\n\nIt expires in 10 minutes.\n\nSign in directly: ${verifyLink}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 28px 24px; border: 1px solid #f0e6d2; border-radius: 16px; background-color: #ffffff; color: #222222;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #3b0021; margin: 0 0 6px; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">BOMBAY CHAAT BHANDAR</h1>
            <p style="color: #888888; margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Visit Rewards & Loyalty</p>
          </div>
          <p style="font-size: 15px; line-height: 1.5; color: #444444; margin-bottom: 20px;">Use the verification code below to sign in and collect your visit reward:</p>
          <div style="background: #fff5eb; border: 2px dashed #ffb885; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #ff5a00; font-family: monospace;">${otpCode}</span>
          </div>
          <p style="font-size: 13px; color: #777777; margin-bottom: 24px; line-height: 1.4;">This code is valid for <strong>10 minutes</strong>. If you did not request this login, please ignore this email.</p>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${verifyLink}" style="display: inline-block; background-color: #ff5a00; color: #ffffff; font-weight: 600; font-size: 15px; padding: 13px 28px; text-decoration: none; border-radius: 999px; box-shadow: 0 4px 12px rgba(255, 90, 0, 0.25);">Sign In Directly</a>
          </div>
          <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 24px 0 16px;" />
          <p style="font-size: 11px; color: #aaaaaa; text-align: center; margin: 0;">Bombay Chaat Bhandar · Scan · Visit · Win</p>
        </div>
      `
    });

    return { devMode: false };
  } catch (mailErr) {
    console.warn("⚠️ SMTP sendMail failed:", mailErr.message);
    console.log("\n=======================================================");
    console.log("🔑 [FALLBACK OTP LOG - SMTP FAILED]");
    console.log(`Recipient : ${toEmail}`);
    console.log(`OTP Code  : ${otpCode}`);
    console.log(`Link      : ${verifyLink}`);
    console.log("👉 Tip: Configure valid SMTP credentials in .env");
    console.log("=======================================================\n");
    return { devMode: true, fallback: true, error: mailErr.message };
  }
}

module.exports = {
  createMailTransporter,
  hashOtp,
  isOtpExpired,
  sendOtpEmail
};

