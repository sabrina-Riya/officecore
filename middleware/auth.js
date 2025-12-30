function redirectAuthenticated(req,res,next){
  if(req.isAuthenticated()){
    if(req.user.role=="admin"){

      return res.redirect("/admin/dashboard");
    }
    return res.redirect("/employee/dashboard");//res.redirect/render stps request completely but next helps to keep o moving
  }
  next(); // checkauthenticated is there to check  if already registered or not 
  //iif registered sends to the dashboard if not login  and then pass it to the register route

}
function ensureAuthenticated(req,res,next){
  if(req.isAuthenticated()){
    return next();
  }
  res.redirect("/login");
}

//role based rbac
function permitRoles(...allowedRoles){
  return (req,res,next)=>{
    if(!req.user){
      return res.status(401).send("unauthorized");
    }
    const{role}=req.user;
    if(!allowedRoles.includes(role)){
      return res.status(403).send("Forbidden:you dont have required roles");
    }
    next();

  }
}

module.exports={
  redirectAuthenticated,
  ensureAuthenticated,
  permitRoles

}