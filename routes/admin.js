const express = require("express");
const router = express.Router();
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { ensureAuthenticated } = require("../middleware/auth");
const { pool } = require("../dbconfig");

// =======================
// GET: Admin Dashboard
// =======================
router.get("/dashboard", ensureAuthenticated, (req, res) => {
  // Pass adminName to EJS
  const adminName = req.user.name || "Admin";

  res.render("admin/dashboard", { adminName });
});

// =======================
// GET: 2FA Setup Page
// =======================
router.get("/2fa-setup", ensureAuthenticated, async (req, res) => {
  const adminName = req.user.name || "Admin";

  // Check if 2FA is already enabled
  if (req.user.two_factor_enabled) {
    req.flash("success_msg", "2FA already enabled");
    return res.redirect("/admin/dashboard");
  }

  // Generate 2FA secret
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `OfficeCore (${req.user.email})`,
  });

  // Store secret temporarily in session
  req.session.temp_two_factor_secret = secret.base32;

  // Generate QR code
  QRCode.toDataURL(secret.otpauth_url, (err, qr) => {
    if (err) {
      req.flash("err_msg", "Failed to generate QR code");
      return res.redirect("/admin/dashboard");
    }

    res.render("admin/setup-2fa", {
      qrCodeDataURL: qr,
      adminName,
    });
  });
});

// =======================
// POST: Verify OTP and Enable 2FA
// =======================
router.post("/2fa-setup", ensureAuthenticated, async (req, res) => {
  const adminName = req.user.name || "Admin";
  const { token } = req.body;
  const secret = req.session.temp_two_factor_secret;

  if (!secret) {
    req.flash("err_msg", "Session expired. Try again.");
    return res.redirect("/admin/2fa-setup");
  }

  // Verify TOTP token
  const verified = speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });

  if (!verified) {
    req.flash("err_msg", "Invalid OTP");
    return res.redirect("/admin/2fa-setup");
  }

  // Save 2FA secret in DB
  try {
    await pool.query(
      `UPDATE users
       SET two_factor_enabled = true,
           two_factor_secret = $1
       WHERE id = $2`,
      [secret, req.user.id]
    );

    delete req.session.temp_two_factor_secret;

    req.flash("success_msg", "2FA enabled successfully");
    res.redirect("/admin/dashboard");
  } catch (err) {
    console.error(err);
    req.flash("err_msg", "Database error. Try again.");
    res.redirect("/admin/2fa-setup");
  }
});

module.exports = router;
