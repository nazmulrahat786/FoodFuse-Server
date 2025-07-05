require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Setup CORS to allow frontend requests with credentials (cookies)
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "https://food786-53dd9.web.app/",
    ],
    credentials: true,
  }) 
); 
  
// Middleware for parsing JSON and cookies
app.use(express.json());
app.use(cookieParser());

// MongoDB connection URI with your username & password
const user = process.env.MONGO_USER;
const pass = process.env.MONGO_PASS;

const uri = `mongodb+srv://${user}:${pass}@cluster0.atkrsjw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;



// Create MongoDB client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// JWT verification middleware to protect routes
const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized access' });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ error: 'Forbidden access' });
    }
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    // Connect to MongoDB
    await client.connect();
    console.log("Connected to MongoDB successfully!");

    const foodCollection = client.db("foodSharing").collection("foods");
    const requestedFoodCollection = client.db("foodSharing").collection("requestFoods");

    // JWT token generation - login simulation
    app.post('/jwt', (req, res) => {
      const user = req.body; // user should at least have email
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '5h' });

      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      }).send({ success: true });
    });

    // Logout - clear JWT cookie
    app.post('/logout', (req, res) => {
      res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      }).send({ success: true });
    });

    // Get all foods with optional filters and sorting
    app.get("/all-foods", async (req, res) => {
      const { available, search, sort } = req.query;
      let query = {};
      if (available) {
        query.status = "Available";
      }
      if (search) {
        query.foodName = { $regex: search, $options: "i" };
      }

      let sortQuery = {};
      if (sort === "asc") {
        sortQuery = { expireDate: 1 };
      } else if (sort === "dsc") {
        sortQuery = { expireDate: -1 };
      }

      try {
        const foods = await foodCollection.find(query).sort(sortQuery).toArray();
        res.send(foods);
      } catch (error) {
        console.error("Error fetching  foods:", error);
        res.status(500).send({ message: "Error fetching foods" });
      }
    });

    // Get all foods (no filters)
    app.get("/foods", async (req, res) => {
      try {
        const foods = await foodCollection.find().toArray();
        res.send(foods);
      } catch (error) {
        console.error("Error fetching foods:", error);
        res.status(500).send({ message: "Error fetching foods" });
      }
    });

    // Get featured foods sorted by quantity, limited to 6
    app.get("/featured-foods", async (req, res) => {
      try {
        const foods = await foodCollection
          .find({ status: "Available" })
          .sort({ foodQuantity: -1 })
          .limit(6)
          .toArray();
        res.send(foods);
      } catch (error) {
        console.error("Error fetching featured foods:", error);
        res.status(500).send({ message: "Error fetching featured foods" });
      }
    });

    // Get requested foods by user email - protected route
    app.get("/request-foods", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (req.user.email !== email) {
        return res.status(403).send({ message: "Forbidden" });
      }
      try {
        const result = await requestedFoodCollection.find({ user_email: email }).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching requested foods:", error);
        res.status(500).send({ message: "Error fetching requested foods" });
      }
    });

    // Get single food by id - protected route
    app.get("/all-foods/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await foodCollection.findOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        console.error("Error fetching food by id:", error);
        res.status(500).send({ message: "Error fetching food" });
      }
    });

    // Manage my foods by user email - protected route
    app.get("/manage-my-foods", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (req.user.email !== email) {
        return res.status(403).send({ message: "Forbidden" });
      }
      try {
        const result = await foodCollection.find({ "donator.donatorEmail": email }).sort({ _id: -1 }).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching user foods:", error);
        res.status(500).send({ message: "Error fetching user foods" });
      }
    });

    // Post a new food - protected route
    app.post("/all-foods", verifyToken, async (req, res) => {
      const foods = req.body;
      try {
        const result = await foodCollection.insertOne(foods);
        res.send(result);
      } catch (error) {
        console.error("Error adding food:", error);
        res.status(500).send({ message: "Error adding food" });
      }
    });

    // Post a request food - protected route
    app.post("/request-foods", verifyToken, async (req, res) => {
      const foodRequest = req.body;
      if (req.user.email !== foodRequest.user_email) {
        return res.status(401).send({ message: "Unauthorized" });
      }
      const foodId = foodRequest.food_id;
      try {
        const result = await requestedFoodCollection.insertOne(foodRequest);
        const filter = { _id: new ObjectId(foodId) };
        const updateDoc = { $set: { status: foodRequest.status } };
        await foodCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error requesting food:", error);
        res.status(500).send({ message: "Error requesting food" });
      }
    });

    // Update a food by id - protected route
    app.patch("/all-foods/:id", verifyToken, async (req, res) => {
      const { foodName, foodImg, foodQuantity, location, expireDate, additionalNotes } = req.body;
      const id = req.params.id;

      const filter = { _id: new ObjectId(id), "donator.donatorEmail": req.user.email };
      const updateDoc = {
        $set: { foodName, foodImg, foodQuantity, location, expireDate, additionalNotes },
      };

      try {
        const result = await foodCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating food:", error);
        res.status(500).send({ message: "Error updating food" });
      }
    });

    // Delete a food by id - protected route
    app.delete("/all-foods/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await foodCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        console.error("Error deleting food:", error);
        res.status(500).send({ message: "Error deleting food" });
      }
    });

    // Root endpoint
    app.get('/', (req, res) => {
      res.send('Food Sharing Website is Okay!');
    });

  } catch (err) {
    console.error("Unexpected error:", err);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Food Sharing website is running at port: ${port}`);
});
