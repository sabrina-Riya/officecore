const express = require("express");
const app = express();
const { pool } = require("./dbconfig");
const logger=require('./logger');
const bcrypt = require("bcrypt");
const session=require("express-session");
const flash = require("express-flash");
const passport=require("passport")
const inipass=require("./passport/passportconfig");
const {redirectAuthenticated,ensureAuthenticated,permitRoles}=require("./middleware/auth");




const port = process.env.PORT || 4000;


app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false })); // send details of the post body from the frontend to the backend app.kjs
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);
app.use(passport.initialize()); //app.use middle ware is used for each request for everuthing but middleware like (req,res,next works for a specific call only)
app.use(passport.session()); //initialise in express
inipass(passport);


app.use(flash()); //these type of middle ware app.use()order matters


//for employeewha
app.get("/employee/dashboard", ensureAuthenticated,permitRoles("employee"),async(req, res) => {
  try{
    const totalleaves=await pool.query("select count(*) from leave_req where user_id=$1",[req.user.id]);
    const approveleave=await pool.query("select count(*) from leave_req where user_id=$1 and status='approved'",[req.user.id]);
    const rejectleave=await pool.query("select count(*) from leave_req where user_id=$1 and status='rejected'",[req.user.id]);

    res.render("employee/dashboard", {
    user: req.user.name,
    totalleave:totalleaves.rows[0].count,
    approvedLeave:approveleave.rows[0].count,
    rejectedLeave:rejectleave.rows[0].count

   });


  }catch(err){
    logger.error(`Failed to fetch users: ${err.message}`);
    res.redirect("/");
  }
  
});


app.get("/admin/dashboard", ensureAuthenticated,permitRoles("admin"),async(req, res) => {
  try{
    const totUser=await pool.query("select count(*) from users");
    const leaveuser=await pool.query("select count(*) from leave_req where status='pending'");
    const appuser=await pool.query("select count(*) from leave_req where status='approved'");
    const rejuser=await pool.query("select count(*) from leave_req where status='rejected'");
    

    const newRequest=await pool.query("select leave_req.id,users.name as employee_name,leave_req.start_date,leave_req.end_date,leave_req.reason,leave_req.created_at from leave_req join users on leave_req.user_id=users.id where leave_req.status='pending'order by leave_req.created_at asc limit 5");

    res.render("admin/dashboard",{
      adminame:req.user.name,
      totaluser:totUser.rows[0].count,
      Leaveuser:leaveuser.rows[0].count,
      approveuser:appuser.rows[0].count,
      rejectuser:rejuser.rows[0].count,
      
      pendingRequest:newRequest.rows[0]


    });


  }catch(err){
    logger.error(`Failed to fetch users:${err.message}`);
    req.flash("err_msg","unable to load");
    res.redirect("/")
  }
});

app.get("/admin/leave",ensureAuthenticated,permitRoles("admin"),async(req,res)=>{
  const checkstatus=req.query.status;
  const filter=checkstatus||"all";

  
  try{
    let result;
    if(checkstatus==="pending"){
      result=await pool.query("select lr.*,a.name as actioned_by,u.name as employee_name from leave_req lr inner join users u on lr.user_id=u.id left join users a  on lr.approved_by=a.id where lr.status='pending' order by lr.created_at desc");

    }else if(checkstatus=="approved"){
      result=await pool.query("select lr.* ,a.name as actioned_by ,u.name as employee_name from leave_req lr inner join users u on lr.user_id=u.id left join users a on lr.approved_by=a.id where lr.status='approved' order by lr.created_at desc");
    }else if(checkstatus=="rejected"){
      result=await pool.query("select lr.* ,a.name as actioned_by ,u.name as employee_name from leave_req lr inner join users u on lr.user_id=u.id left join users a on lr.approved_by=a.id where lr.status='rejected' order by lr.created_at desc");
    }
    
    else{
      result=await pool.query ("select lr.* ,a.name as actioned_by ,u.name as employee_name from leave_req lr inner join users u on lr.user_id=u.id left join users a on lr.approved_by=a.id order by lr.created_at desc  ");
    }

    
    res.render("admin/leave",{leaves:result.rows,filter});

  }catch(err){
    logger.error(`Failed to fetch users:${err.message}`);
    req.flash("err_msg","unable to fetch your request");
    res.redirect("/admin/dashboard");
  }

})



app.post("/admin/leave/approve/:id",ensureAuthenticated,permitRoles("admin"),async(req,res)=>{
  const leaveid=req.params.id;
  const adminid=req.user.id;
  try{
    await pool.query ("update leave_req set status='approved', approved_by=$1,actioned_at=Now() where id=$2",[adminid,leaveid]);
    res.redirect("/admin/leave");

  }catch(err){
    logger.error(`Failed to fetch users:${err.message}`);
    res.redirect("/admin/leave")
  }

})
// Show leave apply form
app.get("/employee/leave-apply", ensureAuthenticated, permitRoles("employee"), (req, res) => {
  res.render("employee/leave-apply", {
    err_msg: [],
    success_msg: []
  });
});

// Handle leave apply form submission
app.post("/employee/leave-apply", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const { sdate, edate, reason } = req.body;
  let errors = [];

  if (!sdate || !edate || !reason) errors.push("All fields are required");
  if (new Date(sdate) > new Date(edate)) errors.push("Start date cannot be after end date");

  if (errors.length > 0) {
    return res.render("employee/leave-apply", { err_msg: errors, success_msg: [] });
  }

  try {
    await pool.query(
      "INSERT INTO leave_req (user_id, start_date, end_date, reason, status, created_at) VALUES ($1,$2,$3,$4,'pending',NOW())",
      [req.user.id, sdate, edate, reason]
    );
    res.render("employee/leave-apply", { err_msg: [], success_msg: ["Leave request submitted"] });
  } catch (err) {
    logger.error(`Failed to fetch users:${err.message}`);
    res.render("employee/leave-apply", { err_msg: ["Failed to submit leave"], success_msg: [] });
  }
});


//reject
app.post("/admin/leave/reject/:id",ensureAuthenticated,permitRoles("admin"),async(req,res)=>{
  const leaveid=req.params.id;
  const reason=req.body.reason;
  const adminid1=req.user.id;
  try{
    await pool.query("update leave_req set status=$1,rejection_reason=$2, approved_by=$3,actioned_at=now() where id=$4" ,["rejected",reason,adminid1,leaveid]);
    res.redirect("/admin/leave");

  }catch(err){
    logger.error(`Failed to fetch users:${err.message}`);
    res.redirect("/admin/leave");
  }
})



app.post("/admin/users/:id",ensureAuthenticated,permitRoles("admin"),async(req,res)=>{
  console.log("POST received for user ID:", req.params.id); // <--- add this
  const userid=req.params.id;
  const adminid=req.user.id;
  try{
    const result=await pool.query("select id , is_active from users where id=$1",[userid]);
    if(result.rows.length===0){
      req.flash("err_msg","user not found ");
      return res.redirect("/admin/users");
    }
    const targetuser=result.rows[0];
    if(targetuser.id===adminid){
      req.flash("err_msg","you can not deactivate yourself")
      return res.redirect("/admin/users");
    }
    const newstatus=!result.rows[0].is_active; //to check the opposite of the role by default active so !active=false
    await pool.query("update users set is_active=$1 where id=$2 ",[newstatus,userid]);
    req.flash("success_msg",newstatus?"user activated successfully":"user deactivated succcessfully");
    return res.redirect("/admin/users");

  }catch(err){
    logger.error(`Failed to fetch users:${err.message}`);
    req.flash("err_msg","unable to update user status");
    res.redirect("/admin/users");
  }
})
//generalise
app.get("/", (req, res) => {
  res.render("index");
});
app.get("/register",redirectAuthenticated,(req,res)=>{
  res.render("register",{error:[]});
})

app.get("/login", redirectAuthenticated,(req, res) => {
  res.render("login");
});
app.get("/employee/leave-list", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  try {
    const result = await pool.query(
      "select lr.*,a.name as actioned_by_name from leave_req lr left join users a on lr.approved_by=a.id where lr.user_id=$1 order by lr.created_at desc",
      [req.user.id]
    );
    const res1=result.rows.map(row=>({

      id: row.id,
      reason: row.reason,
      start: new Date(row.start_date),
      end: new Date(row.end_date),
      created_at: new Date(row.created_at),
      status: row.status,
      approved_by: row.actioned_by_name || null,
      actioned_at: row.actioned_at ? new Date(row.actioned_at) : null,
      rejection_reason: row.rejection_reason || null


    }));
    res.render("employee/leave-list", {

      leave: res1,
      success_msg: req.flash("success_msg"),
      err_msg: req.flash("err_msg")
    }
    
    );


  } catch (err) {
    logger.error(`Failed to fetch users:${err.message}`);
    req.flash("err_msg", "Unable to fetch leave list.");
    res.redirect("/employee/dashboard");
  }
});


app.get("/logout",(req,res,next)=>{
  req.logout(function(err){
    if(err){
      return next(err);
    }
    req.flash("success_msg","you are successfully logged out");
    res.redirect("/login");


  })
  
})
app.post("/register", async (req, res) => {
  let { name, email, password, conpass } = req.body;
  console.log(name, email, password, conpass);
  let error = [];
  if (!name || !email || !password || !conpass) {
    error.push({ message: "please enter all the fields" });
  }

  if (password.length < 6) {
    error.push({ message: "password needs to have 6 characters" });
  }
  if (password != conpass) {
    error.push({ message: "password didnot match" });
  }

  if (error.length > 0) {
    return res.render("register", { error });
  } else {
    let hashpass = await bcrypt.hash(password, 10);
    console.log(hashpass);

    try {
      const result = await pool.query("select * from users where email=$1", [
        email
      ]);
      if (result.rows.length > 0) {
        error.push({ message: "mail already exists" });
        return res.render("register", { error }); 
      }
      await pool.query(
        "insert into users (name,email,password,role) values ($1,$2,$3,$4)",
        [name, email, hashpass,"employee"]
      );
      req.flash("success_msg","you are successfully registered");
      return res.redirect("/login");
    } catch (err) {
      logger.error(`Failed to fetch users:${err.message}`);
      return res.send(err.message);
    }
  }
});
//redirect after login part
app.get("/redirect_after_login",ensureAuthenticated,(req,res)=>{
  if(req.user.role=="admin")return res.redirect("/admin/dashboard");
  return res.redirect("/employee/dashboard");
})

//Express routes accept middleware functions:app.post(path, middleware1, middleware2, middleware3);
app.post("/login",passport.authenticate("local",{
  successRedirect:"/redirect_after_login",
  failureRedirect:"/login",
  failureFlash:true
}));


app.get("/employee/leave/edit/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveid = req.params.id;
  const userid = req.user.id;

  try {
    const result = await pool.query(
      "SELECT * FROM leave_req WHERE id=$1 AND user_id=$2",
      [leaveid, userid]
    );

    if (result.rows.length === 0) {
      req.flash("err_msg", "Leave not found");
      return res.redirect("/employee/leave-list");
    }

    const leave = result.rows[0];

    if (leave.status !== "pending") {
      req.flash("err_msg", "Only pending leaves can be edited");
      return res.redirect("/employee/leave-list");
    }

    res.render("employee/edit-leave", {
      leave,
      err_msg: [],
      success_msg: []
    });

  } catch (err) {
    logger.error(`Failed to fetch users:${err.message}`);
    req.flash("err_msg", "Cannot edit the leave request");
    res.redirect("/employee/leave-list");
  }
});


app.post("/employee/leave/edit/:id", ensureAuthenticated, permitRoles("employee"), async (req, res) => {
  const leaveid = req.params.id;
  const userid = req.user.id;
  const { sdate, edate, reason } = req.body;

  let error = [];
  if (!sdate || !edate || !reason) error.push("All fields are required");
  if (new Date(sdate) > new Date(edate)) error.push("Start date cannot be after end date");

  if (error.length > 0) {
    return res.render("employee/edit-leave", {
      leave: { id: leaveid, start_date: sdate, end_date: edate, reason },
      err_msg: error,
      success_msg: []
    });
  }

  try {
    const result = await pool.query(
      "UPDATE leave_req SET start_date=$1, end_date=$2, reason=$3 WHERE id=$4 AND user_id=$5 AND status='pending' RETURNING *",
      [sdate, edate, reason, leaveid, userid]
    );

    if (result.rows.length === 0) {
      return res.render("employee/edit-leave", {
        leave: { id: leaveid, start_date: sdate, end_date: edate, reason },
        err_msg: ["Cannot edit leave (maybe not pending)"],
        success_msg: []
      });
    }

    res.render("employee/edit-leave", {
      leave: result.rows[0],
      err_msg: [],
      success_msg: ["Leave updated successfully"]
    });

  } catch (err) {
    logger.error(`Failed to fetch users:${err.message}`);
    req.flash("err_msg", "Unable to update leave");
    res.redirect("/employee/leave-list");
  }
});

app.post(
  "/admin/users/role/:id",ensureAuthenticated,permitRoles("admin"),async (req, res) => {
    const userid = parseInt(req.params.id);
    const adminid = req.user.id;

    try {
      const result = await pool.query(
        "SELECT id, role FROM users WHERE id = $1",
        [userid]
      );

      if (result.rows.length === 0) {
        req.flash("err_msg", "User not found");
        return res.redirect("/admin/users");
      }

      
      if (userid === adminid) {
        req.flash("err_msg", "You cannot change your own role");
        return res.redirect("/admin/users");
      }

      const currentRole = result.rows[0].role;
      const newRole = currentRole === "admin" ? "employee" : "admin";

      await pool.query(
        "UPDATE users SET role = $1 WHERE id = $2",
        [newRole, userid]
      );

      req.flash("success_msg", `Role changed to ${newRole}`);
      return res.redirect("/admin/users");

    } catch (err) {
      logger.error(`Failed to fetch users:${err.message}`);
      req.flash("err_msg", "Unable to change role");
      return res.redirect("/admin/users");
    }
  }
);

app.get(
  "/admin/users",
  ensureAuthenticated,
  permitRoles("admin"),
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM users ORDER BY id ASC"
      );

      res.render("admin/users", {
        users: result.rows,            
        success_msg: req.flash("success_msg"),
        err_msg: req.flash("err_msg")
      });

    } catch (err) {
      logger.error(`Failed to fetch users:${err.message}`);
      req.flash("err_msg", "Unable to fetch users");
      res.redirect("/admin/dashboard");
    }
  }
);
// Show edit user form
// Show edit user form
app.get("/admin/users/edit/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userid = req.params.id;

  try {
    const result = await pool.query("SELECT id, name, email, role, is_active FROM users WHERE id=$1", [userid]);

    if (result.rows.length === 0) {
      req.flash("err_msg", "User not found");
      return res.redirect("/admin/users");
    }

    const user = result.rows[0];

    res.render("admin/edit-user", {
      user,
      success_msg: [],
      err_msg: []
    });

  } catch (err) {
    logger.error(`Failed to fetch users:${err.message}`);
    req.flash("err_msg", "Cannot load edit form");
    res.redirect("/admin/users");
  }
});

// Handle edit user form submission
app.post("/admin/users/edit/:id", ensureAuthenticated, permitRoles("admin"), async (req, res) => {
  const userid = req.params.id;
  const { name, email, role } = req.body;

  try {
    await pool.query(
      "UPDATE users SET name=$1, email=$2, role=$3 WHERE id=$4",
      [name, email, role, userid]
    );
    req.flash("success_msg", "User updated successfully");
    res.redirect("/admin/users");

  } catch (err) {
    logger.error(`Failed to fetch users:${err.message}`);
    req.flash("err_msg", "Unable to update user");
    res.redirect("/admin/users");
  }
});
app.listen(port, () => console.log("server is connected"));








