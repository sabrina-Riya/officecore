require("dotenv").config();
const sendEmail = require("./nodemailer");

sendEmail({
  to: "sabrinaleetcode@gmail.com",
  subject: "Test Email",
  html: "<p>Hello, this is a test</p>"
})
  .then(() => console.log("Email sent successfully"))
  .catch(err => console.error("Failed to send email:", err));
