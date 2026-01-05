const express = require("express");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.status(200).send("MALIYA-MD is running");
});

app.use("/code", require("./pair"));

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
