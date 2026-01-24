// nodemailer.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // e.g., smtp.gmail.com
  port: Number(process.env.SMTP_PORT),  // 587
  secure: false,                         // false for TLS
  auth: {
    user: process.env.SMTP_USER,         // e.g., officecore.app@gmail.com
    pass: process.env.SMTP_PASS          // app password
  },
  tls: {
    rejectUnauthorized: false            // avoid certificate issues on Render
  },
  connectionTimeout: 10000               // 10s timeout
});

// Make it async
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await transporter.sendMail({
      from: `"OfficeCore" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: text || "",   // fallback if text not provided
      html
    });
    console.log("Email sent:", info.messageId);
    return info;
  } catch (err) {
    console.error("Failed to send email:", err);
    throw err;           // bubble up error for calling code
  }
};

module.exports = sendEmail;
