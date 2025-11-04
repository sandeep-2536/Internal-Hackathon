const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const issueSchema = new mongoose.Schema({
  title: { type: String, required: true },
  location: { type: String, required: true },
  image: { type: String, required: true },
  status: {
    type: String,
    enum: ["Pending", "In Progress", "Resolved"],
    default: "Pending",
  },
  dateReported: { type: Date, default: Date.now },
  reporter: { type: String, default: "Anonymous" },
});

const listing = mongoose.model("listing", issueSchema);
module.exports = listing;
