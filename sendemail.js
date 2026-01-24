// sendEmail.js
const Resend = require("resend");

// Create a Resend instance with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send an email using Resend API
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content of the email
 */
async function sendEmail({ to, subject, html }) {
  try {
    // Send email via Resend API
    const email = await resend.emails.send({
      from: "officecore@yourdomain.com", // replace with your verified sender
      to,
      subject,
      html,
    });
    console.log("✅ Email sent successfully:", email.id);
    return email;
  } catch (err) {
    console.error(" Failed to send email:", err);
    throw err; // make sure errors bubble up
  }
}

module.exports = sendEmail;
