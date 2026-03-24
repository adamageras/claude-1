// scripts/fetch-data.js
// Fetches the processed schedule JSON from the Google Apps Script endpoint
// and writes it to data.json in the repo root.
// Run via GitHub Actions (see .github/workflows/update-data.yml).

"use strict";

const fs   = require("fs");
const path = require("path");

const SOURCE_URL =
  "https://script.google.com/macros/s/AKfycbySBcF9eUTg86VwSe-yn-xrXGcDWCJTwD9ywmuG_Wvavhh8KH2tqA2MBUT_UCdvRbBzUA/exec";

async function main() {
  console.log("Fetching schedule from Google Script…");
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  console.log(`Received ${data.count ?? "?"} items, status: ${data.status}`);

  const outputPath = path.join(__dirname, "..", "data.json");
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
  console.log(`Written → ${outputPath}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
