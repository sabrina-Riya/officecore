const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // smtp.gmail.com
  port: Number(process.env.SMTP_PORT),  // 465
  secure: true,                         // must be true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  connectionTimeout: 20000              // 20 seconds timeout
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
