const express = require("express");
const router = express.Router();
const { query } = require("../db/config");
const queries = require("../db/queries");
const { syncGoogleReviews, getLinks } = require("../utils/reviews");
const { safeUrl, toIso } = require("../utils/helpers");

const GOOGLE_REVIEW_URL = safeUrl(process.env.GOOGLE_REVIEW_URL);
const INSTAGRAM_URL = safeUrl(process.env.INSTAGRAM_URL);
const FACEBOOK_URL = safeUrl(process.env.FACEBOOK_URL);

// --------------------------------------------------
// HEALTH
// --------------------------------------------------
router.get("/health", async (request, response) => {
  try {
    if (request.app.locals.databaseReady) {
      await request.app.locals.databaseReady;
    }
    await query("SELECT 1");
    response.type("text").send("OK");
  } catch (e) {
    response.status(500).type("text").send("Database error");
  }
});

// --------------------------------------------------
// CONFIG
// --------------------------------------------------
router.get("/api/config", async (request, response) => {
  let rating = (process.env.GOOGLE_RATING || "").trim();
  let count = null;

  let links = {
    googleReviewUrl: GOOGLE_REVIEW_URL,
    instagramUrl: INSTAGRAM_URL,
    facebookUrl: FACEBOOK_URL
  };

  try {
    if (request.app.locals.databaseReady) {
      await request.app.locals.databaseReady;
    }

    links = await getLinks();
    const summary = await syncGoogleReviews();

    if (typeof summary?.rating === "number") {
      rating = summary.rating.toFixed(1);
      count = summary.count ?? null;
    }
  } catch (e) {
    console.log(`Config Error: ${e.message}`);
  }

  response.json({
    googleReviewUrl: links.googleReviewUrl || null,
    instagramUrl: links.instagramUrl || null,
    facebookUrl: links.facebookUrl || null,
    googleRating: rating || null,
    googleReviewCount: count
  });
});

// --------------------------------------------------
// REVIEWS
// --------------------------------------------------
router.get("/api/reviews", async (request, response) => {
  try {
    await syncGoogleReviews();
    const summaries = await queries.getSetting("googleSummary");
    const rows = await queries.getReviews(50);

    response.json({
      rating: summaries?.rating ?? null,
      count: summaries?.count ?? 0,
      updatedAt: summaries?.fetchedAt ? toIso(summaries.fetchedAt) : null,
      reviews: rows.map((r) => ({
        author: r.author,
        stars: r.stars,
        text: r.text || "",
        publishedAt: r.publishedAt ? toIso(r.publishedAt) : null
      }))
    });
  } catch (e) {
    console.log(`Reviews Error: ${e.message}`);
    response.status(500).json({
      error: "Could not load reviews."
    });
  }
});

module.exports = router;

