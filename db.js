const { MongoClient } = require("mongodb");

const url = "mongodb://127.0.0.1:27017/";
const client = new MongoClient(url);

async function main() {
  await client.connect();
  console.log("Connected successfully to server");
  const db = client.db("scrapping");
  const collection = db.collection("framework");

  return collection;
}

module.exports = { main };
