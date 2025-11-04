const mongoose = require("mongoose");

const postSchema = new mongoose.Schema({
  title: String,
  location: String,
  image: String,
  status: { type: String, default: "Pending" },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  department: String,                               // 👈 added
  dateReported: { type: Date, default: Date.now },
  endorsements: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }] 
});

module.exports = mongoose.model("Post", postSchema);
