import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("PizzaHub server is running");
});

app.listen(port, () => {
  console.log(`PizzaHub is running on port: ${port}`);
});