// backend/dashboard.js - Dashboard router & helper module
const router = require("./routes/dashboard");

function addDashboard(app, options = {}) {
  if (app && typeof app.use === "function") {
    app.use(router);
  }
  return router;
}

// Support both: Express router (app.use(dashboard)) and function (addDashboard(app))
router.addDashboard = addDashboard;
module.exports = router;

