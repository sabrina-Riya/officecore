module.exports = function ensure2FAVerified(req, res, next) {
  // If not logged in or 2FA not enabled → allow
  if (!req.user || !req.user.two_fa_enabled) {
    return next();
  }

  // If already verified in this session → allow
  if (req.session.two_fa_verified === true) {
    return next();
  }

  // 🔁 Role-aware redirect
  if (req.user.role === "admin") {
    return res.redirect("/admin/2fa");
  }

  return res.redirect("/employee/2fa");
};
