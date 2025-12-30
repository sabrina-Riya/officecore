require ("dotenv").config();
const {Pool}=require("pg");
const isproduction=process.env.NODE_ENV==="production";
//postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:<DB_PORT>/<DB_NAME>

const connectionString=`postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`


const pool=new Pool({
  
  connectionString: isproduction ? process.env.DATABASE_URL || connectionString
  :connectionString

});
module.exports={pool};