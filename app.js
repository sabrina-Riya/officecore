const express = require("express");
const app = express();
const { pool } = require("./dbconfig");
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
    const totalleaves=await pool.query("select count(*) from leave where user_id=$1",[req.user.id]);
    const approveleave=await pool.query("select count(*) from leave where user_id=$1 and status='approved'",[req.user.id]);
    const rejectleave=await pool.query("select count(*)from leave where user_id=$1 and status='rejected'",[req.user.id]);

    res.render("employee/dashboard", {
    user: req.user.name,
    Totalleave:totalleaves.rows[0].count,
    approvedLeave:approveleave.rows[0].count,
    rejectedLeave:rejectleave.rows[0].count

   });


  }catch(err){
    console.log(err.message);
    res.redirect("/");
  }
  
});

//for admin dashboard
app.get("/admin/dashboard", ensureAuthenticated,permitRoles("admin"),async(req, res) => {
  try{
    const totUser=await pool.query("select count(*) from users");
    const leaveuser=await pool.query("select count(*) from leave where status='pending'");
    const appuser=await pool.query("select count(*) from leave where status='approved'");
    const rejuser=await pool.query("select count(*) from leave where status='rejected'");

    res.render("admin/dashboard",{
      adminame:req.user.name,
      totaluser:totUser.rows[0].count,
      Leaveuser:leaveuser.rows[0].count,
      approveuser:appuser.rows[0].count,
      rejectuser:rejuser.rows[0].count


    });


  }catch(err){
    console.log(err.message);
    req.flash("err_msg","unable to load");
    res.redirect("/")
  }
});
//leave management
//viewing all the rows
app.get("/admin/leave",ensureAuthenticated,permitRoles("admin"),async(req,res)=>{
  try{
    const result=await pool.query("select leave.id,users.name as employee_name,leave.start_date,leave.end_date,leave.reason,leave.status,leave.created_at from leave join users on leave.user_id=users.id order by leave.created_at desc");
    res.render("admin/leave",{leaves:result.rows});

  }catch(err){
    console.log(err.message);
    req.flash("err_msg","unable to fetch your request");
    res.redirect("/admin/dashboard");
  }

})

//approve => here the admin/leave/approve/:id comes from the form i submitted=action="/admin/leave/approve/<%= element.id %>"
//3 of these get combined together

app.post("/admin/leave/approve/:id",ensureAuthenticated,permitRoles("admin"),async(req,res)=>{
  const leaveid=req.params.id;
  try{
    await pool.query ("update user set status='approved' where id=$1",[leaveid]);
    res.redirect("/admin/leave");

  }catch(err){
    console.log(err.messsage);
    res.redirect("/admin/leave")
  }

})

//reject
app.post("/admin/leave/reject/:id",ensureAuthenticated,permitRoles("admin"),async(req,res)=>{
  const leaveid=req.params.id;
  try{
    await pool.query("update leave set status='rejected' where id=$1",[leaveid]);
    res.redirect("/admin/leave");

  }catch(err){
    console.log(err.message);
    res.redirect("/admin/leave");
  }
})


app.get("/admin/users", ensureAuthenticated, permitRoles("admin"),async(req, res) => {
  try{
    const result=await pool.query("select * from users ");
    res.render("admin/users",{element:result.rows});

  }catch(err){
    console.log(err.message);
    req.flash("err_msg","unable to fetch user");
    res.redirect("/admin/dashboard");

  }
});

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
      "SELECT * FROM leave WHERE user_id=$1 ORDER BY created_at DESC",
      [req.user.id]
    );
    

    // Pass the data as 'leave' to match your EJS
    res.render("employee/leave-list", { leave: result.rows });

  } catch (err) {
    console.log(err.message);
    req.flash("error", "Unable to fetch leave list.");
    res.redirect("/employee/dashboard");
  }
});

app.get("/logout",ensureAuthenticated,(req,res,next)=>{
  req.logOut(function(err){
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
        return res.render("register", { error }); //if something is wrong we stay ain the register page
      }
      await pool.query(
        "insert into users (name,email,password,role) values ($1,$2,$3,$4)",
        [name, email, hashpass,"employee"]
      );
      req.flash("success_msg","you are successfully registered");
      return res.redirect("login");




      //while redirecting ejs ant readd the message so we need flash which needs session
     

      
    } catch (err) {
      console.log(err.message);
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
  //req.user=info about currently logged in user
app.get("/employee/leave-apply",ensureAuthenticated,permitRoles("employee"),(req,res)=>{
  res.render("employee/leave-apply");
})
app.post("/employee/leave-apply",ensureAuthenticated,permitRoles("employee"),async(req,res)=>{
  const{sdate,edate,reason}=req.body;
  if(!sdate||!edate){
    req.flash("error","starting and ending date is missing here");
    return res.redirect("/employee/leave-apply");
  }
  try{
    
    await pool.query(
      "insert into leave (user_id,start_date,end_date,reason) values($1,$2,$3,$4)",[req.user.id,sdate,edate,reason]
    );
    req.flash("success_msg","leave applied successfully");
    res.redirect("/employee/leave-list");

  }catch(err){
    console.log(err.message);
    res.redirect("/employee/leave-apply");

  }
})




app.listen(port, () => console.log("server is connected"));


//express receives the req signals us the royute we go to the route then in the passport it verifies and authenticates results send
//back to the express then the message is hwon by the ejs file to show in the frontend



//Express receives the request → Passport verifies credentials → Express decides where to redirect → Flash stores messages → EJS displays them












