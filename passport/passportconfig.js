//for passport dont use theow err,might crash the server


const localstrategy=require("passport-local").Strategy;
const {pool}=require("../dbconfig");
const bcrypt=require("bcrypt");

function initialize(passport){
  const authu=(email,password,done)=>{
    pool.query("select * from users where email=$1",[email],(err,res)=>{
      if(err){
        return done(err);
      }
      if(res.rows.length>0){
        const user=res.rows[0];
        
        bcrypt.compare(password,user.password,(err,isMatch)=>{
          if(err){
            return done(err);
          }
          if(isMatch){
            return done(null,user);
          }
          else{
            return done(null,false,{message:"couldnot get your credential"});
          }
          
        })
      }else{
        return done(null,false,{message:"no result found"});

      }
    })
  }


/* authu → defines the structure / “blueprint” of how to verify a user (email check, password compare).
passport.use(new LocalStrategy(..., authu)) → activates /
 executes that blueprint within Passport, so it knows what to do whenever a login request comes in.*/


  passport.use(new localstrategy({
    usernameField:"email",
    passwordField:"password"
  },authu));



  passport.serializeUser((user,done)=>{

    done(null,user.id); //after the login succeeds passport decides to store the id just-What small piece of data should I store in the session so I remember this user?”

  }
  )

  passport.deserializeUser((id,done)=>{
    pool.query ("select * from users where id=$1",[id],(err,result)=>{
      if(err){
        return done(err);//inside passport err throwing is risky might crash server instead ***********return done(err)
      }else{
        return done(null,result.rows[0]);
      }

    });
    
  })

  
  
  
}
module.exports=initialize;