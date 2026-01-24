// nodemailer.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // smtp.gmail.com
  port: Number(process.env.SMTP_PORT),  // 587
  secure: false,
  auth: {
    user: process.env.SMTP_USER,        // officecore.app@gmail.com
    pass: process.env.SMTP_PASS         // app password
  },
  connectionTimeout: 10000
});

const sendEmail = ({ to, subject, html, text }) => {
  return transporter.sendMail({
    from: `"OfficeCore" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html
  });
};

module.exports = sendEmail;
