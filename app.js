require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const nodemailer = require("nodemailer");
const User = require("./models/user");
const Post = require("./models/post");
const i18next = require("i18next");
const i18nextMiddleware = require("i18next-http-middleware");
const Backend = require("i18next-fs-backend");



const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Multer Setup ----------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

i18next
  .use(Backend)
  .use(i18nextMiddleware.LanguageDetector) // Auto-detects language from cookie, header, etc.
  .init({
    backend: {
      loadPath: path.join(__dirname, "locales/{{lng}}/translation.json"),
    },
    fallbackLng: "en", // Use English if the detected language is not available
    preload: ["en", "hi", "kn"], // Preload languages on server start
    saveMissing: true, // Automatically adds missing keys to your translation files
  });



// ---------------- Nodemailer ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// ---------------- Express setup ----------------
app.use(i18nextMiddleware.handle(i18next));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static("uploads"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------- MongoDB Connection ----------------
const MONGO_URL = process.env.MONGODB_URL;
mongoose
  .connect(MONGO_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

// ---------------- Session Config ----------------
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 },
  })
);

// ---------------- Middleware ----------------
function isLoggedIn(req, res, next) {
  if (req.session.userId) return next();
  res.redirect("/login");
}

function isSolver(req, res, next) {
  if (req.session.userId && req.session.isSolver) return next();
  res.status(403).send("Access denied. Solver role required.");
}

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// ---------------- AUTH ROUTES ----------------
app.get("/signup", (req, res) => {
  res.render("signup.ejs");
});

app.post("/signup", async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body;
    if (!email || !password || !confirmPassword)
      return res.status(400).send("All fields are required");
    if (password !== confirmPassword)
      return res.status(400).send("Passwords do not match");

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).send("Email already registered");

    const user = new User({ email, password });
    await user.save();
    req.session.userId = user._id;
    res.redirect("/profile");
  } catch (err) {
    res.status(500).send("Error signing up: " + err.message);
  }
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).send("Invalid email or password");

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(400).send("Invalid email or password");

    req.session.userId = user._id;
    res.redirect("/profile");
  } catch (err) {
    res.status(500).send("Error logging in: " + err.message);
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ---------------- SOLVER AUTH ----------------
app.get("/login/solver", (req, res) => {
  res.render("solver.ejs");
});




app.post("/login/solver", async (req, res) => {
  const { email, password, token, department } = req.body; // ⬅️ added department

  try {
    if (token !== process.env.SOLVER_TOKEN)
      return res.status(401).send("Invalid Solver Token ❌");

    const user = await User.findOne({ email });
    if (!user) return res.status(401).send("User not found ❌");
   
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).send("Incorrect password ❌");

    // ✅ Store solver session data
    req.session.userId = user._id;
    req.session.isSolver = true;
    req.session.department = department; 
    
    // ✅ store department for filtering

    res.redirect("/solver/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error ⚡");
  }
});


// ---------------- POST ROUTES ----------------
app.get("/", async (req, res) => {
  let posts = await Post.find({}).populate("reporter", "email");
  res.render("home.ejs", { posts });
});

app.get("/issues/new", isLoggedIn, (req, res) => {
  res.render("newissue.ejs");
});

app.post("/issues", isLoggedIn, upload.single("image"), async (req, res) => {
  try {
    const { title, location, status, department } = req.body;   // <-- include department
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    const newPost = new Post({
      title,
      location,
      image: imagePath,
      status: status || "Pending",
      reporter: req.session.userId,
      department       // <-- directly from the form
    });

    await newPost.save();
    const user = await User.findById(req.session.userId);

    user.points += 10;
    if (user.points >= 100) user.level = "Gold";
    else if (user.points >= 50) user.level = "Silver";
    else user.level = "Bronze";

    if (user.points >= 10 && !user.badges.includes("Active Citizen"))
      user.badges.push("Active Citizen");
    if (user.points >= 50 && !user.badges.includes("Community Hero"))
      user.badges.push("Community Hero");

    await user.save();
    res.redirect("/profile");
  } catch (err) {
    res.status(500).send("Error saving issue: " + err.message);
  }
});

app.post("/posts/:id/edit", isLoggedIn, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Post not found");
    if (post.reporter.toString() !== req.session.userId)
      return res.status(403).send("Not authorized");

    const { title, location, status } = req.body;
    if (title) post.title = title;
    if (location) post.location = location;
    if (status) post.status = status;

    await post.save();
    res.redirect("/profile");
  } catch (err) {
    res.status(500).send("Error updating post: " + err.message);
  }
});

app.post("/posts/:id/delete", isLoggedIn, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Post not found");
    if (post.reporter.toString() !== req.session.userId)
      return res.status(403).send("Not authorized");
    await post.deleteOne();
    res.redirect("/profile");
  } catch (err) {
    res.status(500).send("Error deleting post: " + err.message);
  }
});

// ---------------- PROFILE & DASHBOARD ----------------
app.get("/profile", isLoggedIn, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const posts = await Post.find({ reporter: req.session.userId });
  res.render("profile.ejs", { user, posts });
});

app.get("/solver/dashboard", isSolver, async (req, res) => {
  const solver = await User.findById(req.session.userId);
  const department = req.session.department;
   console.log(department);
  const posts = await Post.find({});

  //.populate("reporter", "email");  department
  res.render("solver-dashboard.ejs", { posts, solver, department });
});



app.post("/solver/update/:id", isSolver, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate("reporter");
    if (!post) return res.status(404).send("Post not found");

    post.status = req.body.status;
    await post.save();

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: post.reporter.email,
        subject: "Update on your reported issue",
        text: `Hello,\n\nYour reported issue "${post.title}" has been updated to: ${post.status}.`,
      });
    } catch (err) {
      console.error("Email failed:", err.message);
    }

    res.redirect("/solver/dashboard");
  } catch (err) {
    res.status(500).send("Server error");
  }
});

// ---------------- MAP API ----------------
app.get("/map", (req, res) => {
  res.sendFile(path.join(__dirname, "public/map.html"));
});

app.get("/api/reports", async (req, res) => {
  try {
    const reports = await Post.find({});
    const formattedReports = reports.map(r => {
      let lat = null, lng = null;
      if (r.location.includes(",")) {
        const [latStr, lngStr] = r.location.split(",").map(s => s.trim());
        lat = parseFloat(latStr);
        lng = parseFloat(lngStr);
      }
      return {
        _id: r._id,
        title: r.title,
        status: r.status,
        reporter: r.reporter,
        latitude: lat,
        longitude: lng,
        image: r.image,
        dateReported: r.dateReported
      };
    });
    res.json(formattedReports);
  } catch (err) {
    res.status(500).json({ message: "Error fetching reports" });
  }
});


app.get("/change-lang/:lang", (req, res) => {
  const lang = req.params.lang;
  // Set the language preference in a cookie
  res.cookie("i18next", lang, { maxAge: 900000, httpOnly: true });
  // Redirect back to the previous page
  res.redirect(req.header("Referer") || "/");
});


app.post("/posts/:id/endorse", isLoggedIn, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Post not found");

    const userId = req.session.userId;

    if (post.endorsements.includes(userId)) {
      // 👎 Already endorsed → remove endorsement
      post.endorsements.pull(userId);
    } else {
      // 👍 Add endorsement
      post.endorsements.push(userId);
    }

    await post.save();
    res.json({ count: post.endorsements.length });
  } catch (err) {
    res.status(500).send("Error toggling endorsement");
  }
});
// ---------admin--------
async function sendSpamMail(to, subject, text) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text,
    });
    console.log("✅ Spam mail sent to:", to);
  } catch (err) {
    console.error("❌ Failed to send spam mail:", err.message);
  }
}

// Admin Login (GET)
app.get("/admin/login", (req, res) => {
  res.render("admin-login.ejs");
});

// Admin Login (POST)
app.post("/admin/login", async (req, res) => {
  const { email, password, secret } = req.body;

  try {
    // ✅ Check secret key
    if (secret !== process.env.ADMIN_SECRET) {
      return res.render("admin-login.ejs", { error: "Invalid secret key ❌" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.render("admin-login.ejs", { error: "User not found ❌" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render("admin-login.ejs", { error: "Incorrect password ❌" });
    }

    // ✅ If passed → create admin session
    req.session.userId = user._id;
    req.session.isAdmin = true;

    res.redirect("/admin/dashboard");
  } catch (err) {
    console.error(err);
    res.render("admin-login.ejs", { error: "Server error ⚡" });
  }
});

// Admin Dashboard
app.get("/admin/dashboard", async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("Access denied 🚫");

  try {
    const posts = await Post.find({}).populate("reporter", "email");
    res.render("admin.ejs", { posts });
  } catch (err) {
    res.status(500).send("Error fetching posts ❌");
  }
});



app.post("/admin/delete/:id", async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("Access denied 🚫");

  try {
    const post = await Post.findById(req.params.id).populate("reporter", "email");
    if (!post) return res.status(404).send("Post not found ❌");

    const reporterEmail = post.reporter?.email;

    await post.deleteOne();

    if (reporterEmail) {
      await sendSpamMail(
        reporterEmail,
        "🚨 Your post has been deleted",
        `Your reported issue "${post.title}" was removed by admin and marked as spam.`
      );
    }

    res.redirect("/admin/dashboard");
  } catch (err) {
    res.status(500).send("Error deleting post ❌");
  }
});



app.post("/admin/update/:id", async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("Access denied 🚫");

  const { title, location, status } = req.body;

  try {
    const post = await Post.findById(req.params.id).populate("reporter", "email");
    if (!post) return res.status(404).send("Post not found ❌");

    if (title) post.title = title;
    if (location) post.location = location;
    if (status) post.status = status;

    await post.save();

    const reporterEmail = post.reporter?.email;
    if (reporterEmail) {
      await sendSpamMail(
        reporterEmail,
        "⚠️ Your post has been updated",
        `Your reported issue "${post.title}" was updated by admin and flagged as spam.`
      );
    }

    res.redirect("/admin/dashboard");
  } catch (err) {
    res.status(500).send("Error updating post ❌");
  }
});




// ---------------- SERVER ----------------
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
