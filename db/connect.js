const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
    return true;
  } catch (error) {
    console.warn("MongoDB unavailable; continuing with ephemeral pairing storage:", error.message);
    return false;
  }
};

module.exports = connectDB;
