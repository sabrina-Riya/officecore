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
    const userRole = req.user?.role?.toLowerCase();
    const allowedRoles = roles.map(r => r.toLowerCase());
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).send("Forbidden");
    }
    next();
  };
}


module.exports = {
  redirectAuthenticated,
  ensureAuthenticated,
  permitRoles,
};
