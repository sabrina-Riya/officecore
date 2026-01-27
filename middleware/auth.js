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

function permitRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      req.flash("err_msg", "Access denied");
      return res.redirect("/login");
    }

    const userRole = req.user.role.toLowerCase(); // ✅ FIX IS HERE

    if (!allowedRoles.map(r => r.toLowerCase()).includes(userRole)) {
      req.flash("err_msg", "Forbidden: insufficient permissions");
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
