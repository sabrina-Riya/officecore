// middleware/auth.js

function redirectAuthenticated(req, res, next) {
  if (req.isAuthenticated() && req.user?.role) {
    const role = req.user.role.toLowerCase();
    if (role === "admin") return res.redirect("/admin/dashboard");
    if (role === "employee") return res.redirect("/employee/dashboard");
  }
  next();
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.flash("error", "Please login first");
  return res.redirect("/login");
}
function ensure2FASession(req, res, next) {
  if (!req.session.twoFactorUserId) {
    req.flash("error", "2FA session expired. Login again.");
    return res.redirect("/login");
  }
  next();
}

function permitRoles(...roles) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      req.flash("error", "Please login first");
      return res.redirect("/login");
    }
    if (!roles.includes(req.user.role.toLowerCase())) {
      req.flash("error", "You do not have permission to access this page");
      return res.redirect("/login");
    }
    next();
  };
}

module.exports = {
  redirectAuthenticated,
  ensureAuthenticated,
  permitRoles,
};
