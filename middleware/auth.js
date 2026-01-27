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
  return res.redirect("/login");
}

// middleware/auth.js
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
