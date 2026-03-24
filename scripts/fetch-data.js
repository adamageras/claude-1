// scripts/fetch-data.js
// Fetches the Aufguss schedule from Bookspot and writes data.json to the repo root.
// Run via GitHub Actions (see .github/workflows/update-data.yml).
// Requires BOOKSPOT_API_KEY environment variable.

"use strict";

const fs   = require("fs");
const path = require("path");

const API_KEY = process.env.BOOKSPOT_API_KEY;
if (!API_KEY) {
  console.error("Error: BOOKSPOT_API_KEY environment variable is missing.");
  process.exit(1);
}

const CONFIG = {
  productIds:   [17016, 17018, 17019, 17080],
  durationId:   8095,
  participants: 1,
  categoryId:   2233,
  lookaheadDays: 30,
};

// ── Date helpers ─────────────────────────────────────────────────────────────

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateRange() {
  const today  = new Date();
  const future = new Date();
  future.setDate(future.getDate() + CONFIG.lookaheadDays);
  return { fromDate: formatDate(today), toDate: formatDate(future) };
}

function normalizeTime(value) {
  return value ? String(value).substring(0, 5) : "";
}

// ── Localisation helper ───────────────────────────────────────────────────────

function getLocalizedValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return (
    value.sv || value.da || value.en || value.de || value.no || value.fi ||
    value.title || value.name || ""
  ).trim();
}

// ── Gusmester extraction (mirrors Google Script logic) ────────────────────────

function normalizeDescriptionText(value) {
  if (!value) return "";
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const GUSMESTER_LABEL = /^(gusmester|gusmaster|aufguss\s*master|aufgussmeister)\s*:\s*/i;

function cleanupGusmesterCandidate(value) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[,\-:;]+/, "")
    .trim();
  if (!cleaned) return "";
  if (/^(n\/a|na|unknown)$/i.test(cleaned)) return "";
  if (/https?:\/\//i.test(cleaned)) return "";
  return cleaned;
}

function extractGusmester(publicDescription) {
  const rawText        = getLocalizedValue(publicDescription);
  const normalizedText = normalizeDescriptionText(rawText);
  if (!normalizedText) return "";

  const lines = normalizedText.split("\n").map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (GUSMESTER_LABEL.test(line)) {
      const cleaned = cleanupGusmesterCandidate(line.replace(GUSMESTER_LABEL, ""));
      if (cleaned) return cleaned;
    }
  }

  if (lines.length === 1 && !/:/.test(lines[0])) {
    return cleanupGusmesterCandidate(lines[0]);
  }

  return "";
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

// ── Bookspot API calls ────────────────────────────────────────────────────────

async function fetchProductNameMap() {
  const url =
    "https://api.bookspot.io/api/guest/v3/available-products" +
    `?startDate=&startTime=&endDate=&endTime=&participants=1&duration=0` +
    `&durationId=0&quantity=0&addon=0` +
    `&key=${encodeURIComponent(API_KEY)}` +
    `&categories%5B%5D=${encodeURIComponent(CONFIG.categoryId)}`;

  const json  = await fetchJson(url);
  const items = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];

  const map = {};
  for (const item of items) {
    const id   = item?.id || item?.productId || item?.rentalProductId;
    const name =
      getLocalizedValue(item?.name) ||
      getLocalizedValue(item?.title) ||
      getLocalizedValue(item?.displayName) || "";
    if (id && name) map[String(id)] = name;
  }

  console.log(`Product map: ${Object.keys(map).length} products`);
  return map;
}

async function fetchScheduleItems(productNameMap) {
  const { fromDate, toDate } = dateRange();
  const rows = [];

  for (const productId of CONFIG.productIds) {
    const availUrl =
      `https://api.bookspot.io/api/guest/v3/products/${productId}/availability` +
      `?key=${encodeURIComponent(API_KEY)}` +
      `&fromDate=${encodeURIComponent(fromDate)}` +
      `&toDate=${encodeURIComponent(toDate)}` +
      `&durationId=${encodeURIComponent(CONFIG.durationId)}` +
      `&rentalProductId=${encodeURIComponent(productId)}` +
      `&participants=${encodeURIComponent(CONFIG.participants)}`;

    const availJson = await fetchJson(availUrl);

    const slotMeta      = [];
    const pricePromises = [];

    for (const dateKey of Object.keys(availJson)) {
      const day = availJson[dateKey];
      if (!day || day.status !== "AVAILABLE") continue;
      if (!Array.isArray(day.startTimes) || !day.startTimes.length) continue;

      for (const slot of day.startTimes) {
        const priceUrl =
          `https://api.bookspot.io/api/guest/v3/products/${productId}/start-time-prices` +
          `?durationId=${encodeURIComponent(CONFIG.durationId)}` +
          `&participants=${encodeURIComponent(CONFIG.participants)}` +
          `&key=${encodeURIComponent(API_KEY)}` +
          `&startDate=${encodeURIComponent(slot.startDate)}` +
          `&startTime=${encodeURIComponent(slot.startTime)}` +
          `&endDate=${encodeURIComponent(slot.endDate)}` +
          `&endTime=${encodeURIComponent(slot.endTime)}` +
          `&availability=${encodeURIComponent(slot.availability)}` +
          `&min=${encodeURIComponent(slot.min)}` +
          `&capacity=${encodeURIComponent(slot.capacity)}`;

        slotMeta.push({
          productId:    String(productId),
          startDate:    slot.startDate,
          startTime:    normalizeTime(slot.startTime),
          endTime:      normalizeTime(slot.endTime),
          availability: slot.availability,
        });
        pricePromises.push(fetchJson(priceUrl).catch(() => null));
      }
    }

    const priceResults = await Promise.all(pricePromises);

    for (let i = 0; i < slotMeta.length; i++) {
      const meta        = slotMeta[i];
      const priceJson   = priceResults[i];
      const publicDesc  = priceJson?.data?.publicDescription ?? {};
      const gusmester   = extractGusmester(publicDesc);
      const productName = productNameMap[meta.productId] || `Product ${meta.productId}`;

      rows.push({
        date:         meta.startDate,
        startTime:    meta.startTime,
        endTime:      meta.endTime,
        product:      productName,
        gusmester,
        availability: meta.availability,
      });
    }

    console.log(`Product ${productId}: ${slotMeta.length} slots`);
  }

  rows.sort((a, b) =>
    `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)
  );

  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching product names…");
  const productNameMap = await fetchProductNameMap();

  console.log("Fetching schedule…");
  const items = await fetchScheduleItems(productNameMap);
  console.log(`Total slots: ${items.length}`);

  const payload = {
    updatedAt: new Date().toISOString(),
    status:    "ok",
    count:     items.length,
    items,
  };

  const outputPath = path.join(__dirname, "..", "data.json");
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Written → ${outputPath}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
