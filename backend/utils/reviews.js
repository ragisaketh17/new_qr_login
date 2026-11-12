const queries = require("../db/queries");
const { safeUrl, DEFAULT_OFFERS } = require("./helpers");

const GOOGLE_REVIEW_URL = safeUrl(process.env.GOOGLE_REVIEW_URL);
const INSTAGRAM_URL = safeUrl(process.env.INSTAGRAM_URL);
const FACEBOOK_URL = safeUrl(process.env.FACEBOOK_URL);

const GOOGLE_PLACES_API_KEY = (process.env.GOOGLE_PLACES_API_KEY || "").trim();
const GOOGLE_PLACE_ID = (process.env.GOOGLE_PLACE_ID || "").trim();
const REVIEWS_REFRESH_MS = Number(process.env.GOOGLE_REVIEWS_REFRESH_HOURS ?? 6) * 60 * 60 * 1000;
const STORE_REVIEW_TEXT = (process.env.GOOGLE_STORE_REVIEW_TEXT ?? "true") !== "false";

let reviewSync = null;
let reviewFailedAt = 0;

const syncGoogleReviews = async (force = false) => {
  if (!GOOGLE_PLACES_API_KEY || !GOOGLE_PLACE_ID) {
    return null;
  }

  const saved = await queries.getSetting("googleSummary");

  if (
    !force &&
    saved?.fetchedAt &&
    Date.now() - new Date(saved.fetchedAt).getTime() < REVIEWS_REFRESH_MS
  ) {
    return saved;
  }

  if (!force && Date.now() - reviewFailedAt < 10 * 60 * 1000) {
    return saved;
  }

  if (reviewSync) {
    return reviewSync;
  }

  reviewSync = (async () => {
    try {
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(GOOGLE_PLACE_ID)}`,
        {
          headers: {
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask": "rating,userRatingCount,reviews"
          }
        }
      );

      if (!res.ok) {
        throw new Error(`Places API ${res.status}`);
      }

      const place = await res.json();
      const now = new Date();

      console.log(
        `Google Reviews Sync: rating ${place.rating}, ${place.userRatingCount} ratings, ${(place.reviews || []).length} reviews returned`
      );

      for (const r of place.reviews || []) {
        if (!r.name) continue;

        const author = r.authorAttribution?.displayName || "Google user";
        const authorUrl = r.authorAttribution?.uri || null;
        const stars = r.rating ?? null;
        const publishedAt = r.publishTime ? new Date(r.publishTime) : null;
        const text = STORE_REVIEW_TEXT
          ? r.text?.text || r.originalText?.text || ""
          : "";

        await queries.upsertReview({
          id: r.name,
          author,
          authorUrl,
          stars,
          text,
          publishedAt,
          now
        });
      }

      const summary = {
        rating: place.rating ?? null,
        count: place.userRatingCount ?? 0,
        fetchedAt: now
      };

      await queries.saveSetting("googleSummary", summary);
      return summary;
    } catch (e) {
      reviewFailedAt = Date.now();
      console.log(`Google Reviews Sync Error: ${e.message}`);
      return saved;
    } finally {
      reviewSync = null;
    }
  })();

  return reviewSync;
};

const getOffers = async () => {
  const doc = await queries.getSetting("offers");
  if (Array.isArray(doc) && doc.length > 0) {
    return doc;
  }
  return DEFAULT_OFFERS;
};

const getLinks = async () => {
  const doc = await queries.getSetting("links");

  const pick = (key, fallback) => {
    return typeof doc?.[key] === "string" ? doc[key] : fallback;
  };

  return {
    googleReviewUrl: safeUrl(pick("googleReviewUrl", GOOGLE_REVIEW_URL)),
    instagramUrl: safeUrl(pick("instagramUrl", INSTAGRAM_URL)),
    facebookUrl: safeUrl(pick("facebookUrl", FACEBOOK_URL))
  };
};

module.exports = {
  syncGoogleReviews,
  getOffers,
  getLinks
};

