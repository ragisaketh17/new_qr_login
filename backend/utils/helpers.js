const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const COOKIE_NAME = "mart_session";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VISIT_COOLDOWN_MINUTES = Number(process.env.VISIT_COOLDOWN_MINUTES ?? 0);

const safeUrl = (value) => {
  const text = String(value || "").trim();
  return /^https:\/\//i.test(text) ? text : "";
};

const normalizeUrl = (value) => {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const getLanAddresses = () => {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      const isV4 = i.family === "IPv4" || i.family === 4;
      if (isV4 && !i.internal && !i.address.startsWith("169.254.")) {
        found.push({ name, address: i.address });
      }
    }
  }
  return found;
};

const scoreAddress = ({ name, address }) => {
  const n = name.toLowerCase();
  let score = 0;
  if (/wi-?fi|wlan|wireless/.test(n)) score += 3;
  if (/vethernet|vmware|virtualbox|wsl|hyper-v|docker|vpn|tap|tun/.test(n)) score -= 5;
  if (address.startsWith("192.168.")) score += 2;
  else if (address.startsWith("10.")) score += 1;
  return score;
};

const getPublicUrl = () =>
  process.env.SITE_URL?.trim() ||
  process.env.PUBLIC_URL?.trim() ||
  process.env.APP_URL?.trim() ||
  process.env.RENDER_EXTERNAL_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : "") ||
  "";

/**
 * Returns the base URL for the server.
 * Handles production proxies (Render, Railway, Heroku, Nginx, Cloudflare, AWS)
 * by checking x-forwarded-proto and x-forwarded-host / host headers.
 */
const getBaseUrl = (req) => {
  const publicUrl = getPublicUrl();
  if (publicUrl) {
    return normalizeUrl(publicUrl);
  }

  if (req) {
    let proto = "http";
    try {
      const forwardedProto = req.headers && req.headers["x-forwarded-proto"];
      if (forwardedProto) {
        proto = String(forwardedProto).split(",")[0].trim();
      } else if (req.protocol) {
        proto = req.protocol;
      }
    } catch (_) {
      proto = "http";
    }

    let host = null;
    try {
      host =
        (req.headers && req.headers["x-forwarded-host"] ? String(req.headers["x-forwarded-host"]).split(",")[0].trim() : null) ||
        (req.get && req.get("host")) ||
        (req.headers && req.headers.host);
    } catch (_) {
      host = null;
    }

    if (host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
      return `${proto}://${host}`;
    }
  }

  const best = getLanAddresses().sort(
    (a, b) => scoreAddress(b) - scoreAddress(a)
  )[0];

  return `http://${best ? best.address : "localhost"}:${PORT}`;
};

const isRequestSecure = (req) => {
  try {
    return Boolean(
      req?.secure ||
      String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https"
    );
  } catch (_) {
    return false;
  }
};

const getScanUrl = (req) => `${getBaseUrl(req)}/scan`;

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const getCookie = (request, name) => {
  const header = request?.headers?.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
};

const toIso = (value) => {
  if (!value) return null;
  return new Date(value).toISOString();
};

const DEFAULT_OFFERS = [
  {
    minVisits: 1,
    icon: "🎟️",
    headline: "Get 5% OFF",
    text: "Welcome offer: 5% off your bill today."
  },
  {
    minVisits: 3,
    icon: "🪙",
    headline: "Get 10% OFF",
    text: "Regular customer: 10% off your bill today."
  },
  {
    minVisits: 5,
    icon: "🎁",
    headline: "Get A Free Gift",
    text: "Loyal customer: collect a free gift at the counter."
  },
  {
    minVisits: 10,
    icon: "👑",
    headline: "Get 15% OFF",
    text: "VIP customer: 15% off every bill this month."
  }
];

function buildOffers(visits, claims = new Map(), offerList = DEFAULT_OFFERS) {
  const offers = offerList.map((offer) => {
    const unlocked = visits >= offer.minVisits;
    const claimedAt = claims.get(offer.minVisits) || null;
    const status = claimedAt ? "claimed" : unlocked ? "available" : "locked";
    return {
      ...offer,
      unlocked,
      claimedAt,
      status
    };
  });

  const currentIndex = offers.reduce(
    (last, offer, index) => (offer.unlocked ? index : last),
    -1
  );

  const nextOffer = offerList.find((offer) => visits < offer.minVisits);
  const next = nextOffer
    ? {
      headline: nextOffer.headline,
      visitsAway: nextOffer.minVisits - visits
    }
    : null;

  return {
    offers,
    currentIndex,
    next
  };
}

module.exports = {
  PORT,
  COOKIE_NAME,
  ONE_YEAR_MS,
  EMAIL_PATTERN,
  VISIT_COOLDOWN_MINUTES,
  DEFAULT_OFFERS,
  safeUrl,
  normalizeUrl,
  getLanAddresses,
  scoreAddress,
  getPublicUrl,
  getBaseUrl,
  getScanUrl,
  hashToken,
  getCookie,
  toIso,
  buildOffers,
  isRequestSecure
};
