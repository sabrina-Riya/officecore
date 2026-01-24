const { Resend } = require("resend");
const resend = new Resend({ apiKey: process.env.RESEND_API_KEY });

async function sendEmail({ to, subject, html }) {
  try {
    const response = await resend.emails.send({
      from: "sabrinaleetcode@gmail.com",
      to,         
      subject,    
      html
    });
    console.log("Email sent successfully:", response);
  } catch (err) {
    console.error("Failed to send email:", err);
    throw err;
  }
}

module.exports = sendEmail;
