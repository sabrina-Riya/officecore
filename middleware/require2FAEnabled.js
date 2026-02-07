module.exports = function require2FAEnabled(req, res, next) {
  if (!req.user) {
    return res.redirect("/login");
  }

  if (!req.user.two_fa_enabled) {
    req.flash("err_msg", "Please enable 2FA first.");

    return res.redirect(
      req.user.role === "admin"
        ? "/admin/2fa-setup"
        : "/employee/2fa-setup"
    );
  }

  next();
};
