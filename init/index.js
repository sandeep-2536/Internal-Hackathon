const mongoose = require("mongoose");
const initdata=require("./data.js");
const Listing = require("../models/post.js");

const MONGO_URL='mongodb://127.0.0.1:27017/civicApp';
main()  
  .then(() => console.log("database connected"))

  .catch((err)=>console.log(err));

async function main() {
  await mongoose.connect (MONGO_URL);
}

  
const initdb= async()=>
{  
    await Listing.deleteMany({});
    await Listing.insertMany(initdata.data);
    console.log("data  was initialized");
}

initdb();