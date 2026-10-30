// dashboard.js - MySQL/MariaDB version

const crypto = require("crypto");

module.exports = function addDashboard(
  app,
  {
    getDb,
    getCookie,
    getOffers,
    defaultOffers,
    toIso,
    syncGoogleReviews,
    getLinks
  }
) {
  const DASHBOARD_USERNAME =
    process.env.DASHBOARD_USERNAME ||
    "admin";

  const DASHBOARD_PASSWORD =
    process.env.DASHBOARD_PASSWORD ||
    "admin123";

  const DASHBOARD_UTC_OFFSET =
    Number(
      process.env
        .DASHBOARD_UTC_OFFSET_MINUTES ??
      330
    );

  const ADMIN_COOKIE =
    "mart_admin";

  // ------------------------------------------------
  // ADMIN TOKEN
  // ------------------------------------------------

  const ADMIN_TOKEN =
    crypto
      .createHash("sha256")
      .update(
        `mart-admin:${DASHBOARD_USERNAME}:${DASHBOARD_PASSWORD}`
      )
      .digest("hex");

  const sameText = (a, b) => {
    const x = Buffer.from(
      String(a)
    );

    const y = Buffer.from(
      String(b)
    );

    return (
      x.length === y.length &&
      crypto.timingSafeEqual(
        x,
        y
      )
    );
  };

  const isAdmin = (req) =>
    sameText(
      getCookie(
        req,
        ADMIN_COOKIE
      ) || "",
      ADMIN_TOKEN
    );

  // ------------------------------------------------
  // DATE
  // ------------------------------------------------

  const startOfToday = () => {
    const off =
      DASHBOARD_UTC_OFFSET *
      60 *
      1000;

    const local =
      new Date(
        Date.now() + off
      );

    return new Date(
      Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate()
      ) - off
    );
  };

  // ------------------------------------------------
  // CLAIM COUNTS
  // ------------------------------------------------

  const getClaimCounts =
    async (db) => {
      const rows =
        await db.query(`
          SELECT
            userId,
            COUNT(*) AS n
          FROM claims
          GROUP BY userId
        `);

      return new Map(
        rows.map((r) => [
          String(r.userId),
          Number(r.n)
        ])
      );
    };

  // ------------------------------------------------
  // ADMIN CACHE
  // ------------------------------------------------

  app.use(
    "/admin",
    (
      req,
      res,
      next
    ) => {
      res.set(
        "Cache-Control",
        "no-store"
      );

      next();
    }
  );

  // ------------------------------------------------
  // DASHBOARD PAGES
  // ------------------------------------------------

  app.get(
    "/dashboard",
    (
      req,
      res
    ) =>
      res.redirect(
        "/dashboard.html"
      )
  );

  app.get(
    "/dashboard/offers",
    (
      req,
      res
    ) =>
      res.redirect(
        "/offers-admin.html"
      )
  );

  // ------------------------------------------------
  // ADMIN LOGIN
  // ------------------------------------------------

  app.post(
    "/admin/login",
    (
      req,
      res
    ) => {
      const u =
        String(
          req.body?.username ??
          ""
        ).trim();

      const p =
        String(
          req.body?.password ??
          ""
        );

      if (!u || !p) {
        return res
          .status(400)
          .json({
            error:
              "Please enter both username and password."
          });
      }

      if (
        !sameText(
          u,
          DASHBOARD_USERNAME
        ) ||
        !sameText(
          p,
          DASHBOARD_PASSWORD
        )
      ) {
        return res
          .status(401)
          .json({
            error:
              "Invalid username or password."
          });
      }

      res.cookie(
        ADMIN_COOKIE,
        ADMIN_TOKEN,
        {
          httpOnly: true,
          sameSite: "lax",
          secure: req.secure,
          maxAge:
            12 *
            60 *
            60 *
            1000
        }
      );

      res.json({
        ok: true,
        username:
          DASHBOARD_USERNAME
      });
    }
  );

  // ------------------------------------------------
  // ADMIN LOGOUT
  // ------------------------------------------------

  app.post(
    "/admin/logout",
    (
      req,
      res
    ) => {
      res.clearCookie(
        ADMIN_COOKIE
      );

      res.json({
        ok: true
      });
    }
  );

  // ------------------------------------------------
  // CLEAN OFFERS
  // ------------------------------------------------

  const cleanOffers =
    (input) => {
      if (
        !Array.isArray(input) ||
        input.length === 0
      ) {
        throw new Error(
          "Add at least one offer."
        );
      }

      if (input.length > 20) {
        throw new Error(
          "You can have at most 20 offers."
        );
      }

      const seen =
        new Set();

      const cleaned =
        input.map(
          (item, i) => {
            const n = i + 1;

            const minVisits =
              Number(
                item?.minVisits
              );

            const icon =
              String(
                item?.icon ?? ""
              )
                .trim()
                .slice(0, 8);

            const headline =
              String(
                item?.headline ??
                ""
              ).trim();

            const text =
              String(
                item?.text ?? ""
              ).trim();

            if (
              !Number.isInteger(
                minVisits
              ) ||
              minVisits < 1 ||
              minVisits > 1000
            ) {
              throw new Error(
                `Offer ${n}: visits must be a whole number from 1 to 1000.`
              );
            }

            if (
              seen.has(minVisits)
            ) {
              throw new Error(
                `Offer ${n}: another offer already uses ${minVisits} visits.`
              );
            }

            seen.add(
              minVisits
            );

            if (
              !headline ||
              headline.length > 60
            ) {
              throw new Error(
                `Offer ${n}: the title must be 1 to 60 characters.`
              );
            }

            if (
              !text ||
              text.length > 200
            ) {
              throw new Error(
                `Offer ${n}: the message must be 1 to 200 characters.`
              );
            }

            return {
              minVisits,
              icon:
                icon || "🎁",
              headline,
              text
            };
          }
        );

      return cleaned.sort(
        (a, b) =>
          a.minVisits -
          b.minVisits
      );
    };

  // ------------------------------------------------
  // GET OFFERS
  // ------------------------------------------------

  app.get(
    "/admin/offers",
    async (
      req,
      res
    ) => {
      if (!isAdmin(req)) {
        return res
          .status(401)
          .json({
            error:
              "Please sign in."
          });
      }

      try {
        res.json({
          offers:
            await getOffers()
        });
      } catch (e) {
        console.log(
          `Offers Error: ${e.message}`
        );

        res
          .status(500)
          .json({
            error:
              "Could not load the offers."
          });
      }
    }
  );

  // ------------------------------------------------
  // SAVE OFFERS
  // ------------------------------------------------

  app.put(
    "/admin/offers",
    async (
      req,
      res
    ) => {
      if (!isAdmin(req)) {
        return res
          .status(401)
          .json({
            error:
              "Please sign in."
          });
      }

      let offers;

      try {
        offers =
          cleanOffers(
            req.body?.offers
          );
      } catch (e) {
        return res
          .status(400)
          .json({
            error:
              e.message
          });
      }

      try {
        const db =
          getDb();

        await db.query(
          `
            INSERT INTO settings
              (
                settingKey,
                settingValue,
                updatedAt
              )
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
              settingValue = VALUES(settingValue),
              updatedAt = CURRENT_TIMESTAMP
          `,
          [
            "offers",
            JSON.stringify(
              offers
            )
          ]
        );

        res.json({
          ok: true,
          offers
        });
      } catch (e) {
        console.log(
          `Offers Save Error: ${e.message}`
        );

        res
          .status(500)
          .json({
            error:
              "Could not save the offers."
          });
      }
    }
  );

  // ------------------------------------------------
  // RESET OFFERS
  // ------------------------------------------------

  app.post(
    "/admin/offers/reset",
    async (
      req,
      res
    ) => {
      if (!isAdmin(req)) {
        return res
          .status(401)
          .json({
            error:
              "Please sign in."
          });
      }

      try {
        const db =
          getDb();

        await db.query(
          `
            DELETE FROM settings
            WHERE settingKey = ?
          `,
          ["offers"]
        );

        res.json({
          ok: true,
          offers:
            defaultOffers
        });
      } catch (e) {
        console.log(
          `Offers Reset Error: ${e.message}`
        );

        res
          .status(500)
          .json({
            error:
              "Could not reset the offers."
          });
      }
    }
  );

  // ------------------------------------------------
  // LINKS
  // ------------------------------------------------

  const cleanLink =
    (
      value,
      label,
      hosts
    ) => {
      const text =
        String(
          value ?? ""
        ).trim();

      if (!text) {
        return "";
      }

      if (text.length > 300) {
        throw new Error(
          `${label}: the link is too long.`
        );
      }

      let url;

      try {
        url = new URL(
          text
        );
      } catch {
        throw new Error(
          `${label}: enter a full link starting with https://`
        );
      }

      if (
        url.protocol !==
        "https:"
      ) {
        throw new Error(
          `${label}: the link must start with https://`
        );
      }

      if (
        hosts &&
        !hosts.some(
          (h) =>
            url.hostname === h ||
            url.hostname.endsWith(
              `.${h}`
            )
        )
      ) {
        throw new Error(
          `${label}: the link must be on ${hosts.join(
            " or "
          )}.`
        );
      }

      return url.toString();
    };

  // ------------------------------------------------
  // GET LINKS
  // ------------------------------------------------

  app.get(
    "/admin/links",
    async (
      req,
      res
    ) => {
      if (!isAdmin(req)) {
        return res
          .status(401)
          .json({
            error:
              "Please sign in."
          });
      }

      try {
        res.json(
          await getLinks()
        );
      } catch (e) {
        console.log(
          `Links Error: ${e.message}`
        );

        res
          .status(500)
          .json({
            error:
              "Could not load the links."
          });
      }
    }
  );

  // ------------------------------------------------
  // SAVE LINKS
  // ------------------------------------------------

  app.put(
    "/admin/links",
    async (
      req,
      res
    ) => {
      if (!isAdmin(req)) {
        return res
          .status(401)
          .json({
            error:
              "Please sign in."
          });
      }

      let links;

      try {
        links = {
          instagramUrl:
            cleanLink(
              req.body?.instagramUrl,
              "Instagram",
              ["instagram.com"]
            ),

          facebookUrl:
            cleanLink(
              req.body?.facebookUrl,
              "Facebook",
              [
                "facebook.com",
                "fb.com",
                "fb.me"
              ]
            ),

          googleReviewUrl:
            cleanLink(
              req.body?.googleReviewUrl,
              "Google review",
              null
            )
        };
      } catch (e) {
        return res
          .status(400)
          .json({
            error:
              e.message
          });
      }

      try {
        const db =
          getDb();

        await db.query(
          `
            INSERT INTO settings
              (
                settingKey,
                settingValue,
                updatedAt
              )
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
              settingValue = VALUES(settingValue),
              updatedAt = CURRENT_TIMESTAMP
          `,
          [
            "links",
            JSON.stringify(
              links
            )
          ]
        );

        res.json({
          ok: true,
          ...links
        });
      } catch (e) {
        console.log(
          `Links Save Error: ${e.message}`
        );

        res
          .status(500)
          .json({
            error:
              "Could not save the links."
          });
      }
    }
  );

  // ------------------------------------------------
  // DASHBOARD DATA
  // ------------------------------------------------

  app.get(
    "/admin/data",
    async (
      req,
      res
    ) => {
      if (!isAdmin(req)) {
        return res
          .status(401)
          .json({
            error:
              "Please sign in."
          });
      }

      try {
        const db =
          getDb();

        const OFFERS =
          await getOffers();

        const todayStart =
          startOfToday();

        const sevenDaysAgo =
          new Date(
            Date.now() -
            7 *
            24 *
            60 *
            60 *
            1000
          );

        // --------------------------------------------
        // SUMMARY
        // --------------------------------------------

        const [
          customersRows,
          visitsRows,
          newTodayRows,
          visitedTodayRows,
          visited7DaysRows,
          claimedRows,
          claimedTodayRows
        ] =
          await Promise.all([
            db.query(`
              SELECT COUNT(*) AS n
              FROM users
            `),

            db.query(`
              SELECT COALESCE(
                SUM(visitCount),
                0
              ) AS total
              FROM users
            `),

            db.query(
              `
                SELECT COUNT(*) AS n
                FROM users
                WHERE createdAt >= ?
              `,
              [todayStart]
            ),

            db.query(
              `
                SELECT COUNT(*) AS n
                FROM users
                WHERE lastVisitAt >= ?
              `,
              [todayStart]
            ),

            db.query(
              `
                SELECT COUNT(*) AS n
                FROM users
                WHERE lastVisitAt >= ?
              `,
              [sevenDaysAgo]
            ),

            db.query(`
              SELECT COUNT(*) AS n
              FROM claims
            `),

            db.query(
              `
                SELECT COUNT(*) AS n
                FROM claims
                WHERE claimedAt >= ?
              `,
              [todayStart]
            )
          ]);

        const customers =
          Number(
            customersRows[0].n
          );

        const totalVisits =
          Number(
            visitsRows[0].total
          );

        const newToday =
          Number(
            newTodayRows[0].n
          );

        const visitedToday =
          Number(
            visitedTodayRows[0].n
          );

        const visited7Days =
          Number(
            visited7DaysRows[0].n
          );

        const claimed =
          Number(
            claimedRows[0].n
          );

        const claimedToday =
          Number(
            claimedTodayRows[0].n
          );

        // --------------------------------------------
        // OFFERS
        // --------------------------------------------

        const offers = [];

        for (
          const o of OFFERS
        ) {
          const [
            unlockedRows,
            claimedCountRows
          ] =
            await Promise.all([
              db.query(
                `
                  SELECT COUNT(*) AS n
                  FROM users
                  WHERE visitCount >= ?
                `,
                [o.minVisits]
              ),

              db.query(
                `
                  SELECT COUNT(*) AS n
                  FROM claims
                  WHERE minVisits = ?
                `,
                [o.minVisits]
              )
            ]);

          offers.push({
            minVisits:
              o.minVisits,

            headline:
              o.headline,

            unlocked:
              Number(
                unlockedRows[0].n
              ),

            claimed:
              Number(
                claimedCountRows[0].n
              )
          });
        }

        // --------------------------------------------
        // CUSTOMERS
        // --------------------------------------------

        const claimCounts =
          await getClaimCounts(
            db
          );

        const rows =
          await db.query(`
            SELECT
              id,
              email,
              visitCount,
              createdAt,
              lastVisitAt
            FROM users
            ORDER BY
              visitCount DESC,
              lastVisitAt DESC
            LIMIT 1000
          `);

        const customerList =
          rows.map((r) => ({
            email: r.email,

            visits:
              Number(
                r.visitCount
              ),

            claimed:
              claimCounts.get(
                String(r.id)
              ) || 0,

            joined:
              toIso(
                r.createdAt
              ),

            lastVisit:
              r.lastVisitAt
                ? toIso(
                  r.lastVisitAt
                )
                : null
          }));

        // --------------------------------------------
        // RECENT CLAIMS
        // --------------------------------------------

        const claimRows =
          await db.query(`
            SELECT
              c.id,
              c.userId,
              c.minVisits,
              c.claimedAt,
              u.email
            FROM claims c
            LEFT JOIN users u
              ON u.id = c.userId
            ORDER BY
              c.claimedAt DESC
            LIMIT 20
          `);

        const recentClaims =
          claimRows.map(
            (r) => {
              const o =
                OFFERS.find(
                  (x) =>
                    Number(
                      x.minVisits
                    ) ===
                    Number(
                      r.minVisits
                    )
                );

              return {
                email:
                  r.email ||
                  "(deleted user)",

                reward:
                  o
                    ? o.headline
                    : `${r.minVisits} visits`,

                claimedAt:
                  toIso(
                    r.claimedAt
                  )
              };
            }
          );

        // --------------------------------------------
        // GOOGLE REVIEWS
        // --------------------------------------------

        try {
          if (syncGoogleReviews) {
            await syncGoogleReviews(
              req.query
                .refreshReviews ===
              "1"
            );
          }
        } catch (e) {
          console.log(
            `Reviews Sync Error: ${e.message}`
          );
        }

        const summaryRows =
          await db.query(
            `
              SELECT settingValue
              FROM settings
              WHERE settingKey = ?
              LIMIT 1
            `,
            ["googleSummary"]
          );

        let gSummary = null;

        if (
          summaryRows.length
        ) {
          try {
            gSummary =
              JSON.parse(
                summaryRows[0]
                  .settingValue
              );
          } catch {
            gSummary = null;
          }
        }

        const gRows =
          await db.query(`
            SELECT
              author,
              stars,
              text,
              publishedAt
            FROM reviews
            ORDER BY
              publishedAt DESC
            LIMIT 50
          `);

        const google = {
          rating:
            typeof gSummary?.rating ===
              "number"
              ? gSummary.rating
              : null,

          count:
            gSummary?.count ??
            0,

          updatedAt:
            gSummary?.fetchedAt
              ? toIso(
                gSummary.fetchedAt
              )
              : null,

          reviews:
            gRows.map(
              (r) => ({
                author:
                  r.author,

                stars:
                  r.stars,

                text:
                  r.text || "",

                publishedAt:
                  r.publishedAt
                    ? toIso(
                      r.publishedAt
                    )
                    : null
              })
            )
        };

        // --------------------------------------------
        // RESPONSE
        // --------------------------------------------

        res.json({
          adminUser:
            DASHBOARD_USERNAME,

          summary: {
            customers,
            totalVisits,
            newToday,
            visitedToday,
            visited7Days,
            claimed,
            claimedToday
          },

          offers,

          customers:
            customerList,

          recentClaims,

          google
        });
      } catch (e) {
        console.log(
          `Dashboard Error: ${e.message}`
        );

        res
          .status(500)
          .json({
            error:
              "Could not load the dashboard data."
          });
      }
    }
  );

  // ------------------------------------------------
  // CUSTOMER HISTORY
  // ------------------------------------------------

  app.get(
    "/admin/customer",
    async (
      req,
      res
    ) => {
      if (!isAdmin(req)) {
        return res
          .status(401)
          .json({
            error:
              "Please sign in."
          });
      }

      try {
        const db =
          getDb();

        const email =
          String(
            req.query.email ||
            ""
          )
            .trim()
            .toLowerCase();

        const users =
          await db.query(
            `
              SELECT
                id,
                email,
                createdAt,
                lastVisitAt,
                visitCount
              FROM users
              WHERE email = ?
              LIMIT 1
            `,
            [email]
          );

        if (!users.length) {
          return res
            .status(404)
            .json({
              error:
                "Customer not found."
            });
        }

        const user =
          users[0];

        const OFFERS =
          await getOffers();

        const [
          visits,
          claims
        ] =
          await Promise.all([
            db.query(
              `
                SELECT at
                FROM visits
                WHERE userId = ?
                ORDER BY at ASC
                LIMIT 2000
              `,
              [user.id]
            ),

            db.query(
              `
                SELECT
                  minVisits,
                  claimedAt
                FROM claims
                WHERE userId = ?
                ORDER BY claimedAt ASC
              `,
              [user.id]
            )
          ]);

        res.json({
          email:
            user.email,

          joined:
            toIso(
              user.createdAt
            ),

          firstVisit:
            visits[0]
              ? toIso(
                visits[0].at
              )
              : null,

          lastVisit:
            user.lastVisitAt
              ? toIso(
                user.lastVisitAt
              )
              : null,

          totalVisits:
            Number(
              user.visitCount
            ),

          visits:
            visits.map(
              (v) =>
                toIso(v.at)
            ),

          claims:
            claims.map(
              (c) => {
                const o =
                  OFFERS.find(
                    (x) =>
                      Number(
                        x.minVisits
                      ) ===
                      Number(
                        c.minVisits
                      )
                  );

                return {
                  reward:
                    o
                      ? o.headline
                      : `${c.minVisits} visits`,

                  claimedAt:
                    toIso(
                      c.claimedAt
                    )
                };
              }
            )
        });
      } catch (e) {
        console.log(
          `Customer Error: ${e.message}`
        );

        res
          .status(500)
          .json({
            error:
              "Could not load this customer."
          });
      }
    }
  );

  // ------------------------------------------------
  // CSV EXPORT
  // ------------------------------------------------

  app.get(
    "/admin/export.csv",
    async (
      req,
      res
    ) => {
      if (!isAdmin(req)) {
        return res
          .status(401)
          .send(
            "Please sign in on the dashboard first."
          );
      }

      try {
        const db =
          getDb();

        const claimCounts =
          await getClaimCounts(
            db
          );

        const rows =
          await db.query(`
            SELECT
              email,
              visitCount,
              lastVisitAt,
              createdAt,
              id
            FROM users
            ORDER BY
              visitCount DESC,
              lastVisitAt DESC
          `);

        const cell =
          (v) => {
            let t =
              String(
                v ?? ""
              );

            if (
              /^[=+\-@]/.test(
                t
              )
            ) {
              t = `'${t}`;
            }

            return `"${t.replace(
              /"/g,
              '""'
            )}"`;
          };

        const lines = [
          "Email,Visits,Rewards claimed,Last visit (UTC),Joined (UTC)"
        ];

        for (
          const r of rows
        ) {
          lines.push(
            [
              r.email,

              r.visitCount,

              claimCounts.get(
                String(r.id)
              ) || 0,

              r.lastVisitAt
                ? toIso(
                  r.lastVisitAt
                )
                : "",

              toIso(
                r.createdAt
              )
            ]
              .map(cell)
              .join(",")
          );
        }

        res.set(
          "Content-Type",
          "text/csv; charset=utf-8"
        );

        res.set(
          "Content-Disposition",
          'attachment; filename="mart-customers.csv"'
        );

        res.send(
          lines.join("\r\n")
        );
      } catch (e) {
        console.log(
          `Export Error: ${e.message}`
        );

        res
          .status(500)
          .send(
            "Could not create the file."
          );
      }
    }
  );
};