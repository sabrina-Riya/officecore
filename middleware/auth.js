function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  req.flash("err_msg", "Please login first");
  return res.redirect("/login");
}

function redirectAuthenticated(req, res, next) {
  // Only redirect if the session is valid AND the user object exists
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    const role = req.user.role.toLowerCase();
    if (role === "admin" || role === "employee") {
      return res.redirect("/dashboard");
    }
  }
  next();
}

function permitRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      req.flash("err_msg", "Unauthorized access");
      return res.redirect("/login");
    }
    next();
  };
}

module.exports = {
  ensureAuthenticated,
  redirectAuthenticated,
  permitRoles
};
