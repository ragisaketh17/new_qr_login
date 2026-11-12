const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const { getScanUrl } = require("../utils/helpers");

router.get("/qr.png", async (request, response) => {
  try {
    const png = await QRCode.toBuffer(getScanUrl(request), {
      width: 600,
      margin: 2
    });
    response.type("png").send(png);
  } catch (e) {
    response.status(500).send("Could not create QR code");
  }
});

router.get("/qr", (request, response) => {
  const scanUrl = getScanUrl(request);
  response.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Scan to open</title>
    </head>
    <body style="font-family:sans-serif;text-align:center;padding:2rem">
      <h1>Scan to open</h1>
      <img src="/qr.png" alt="QR code" width="300" height="300">
      <p>${scanUrl}</p>
    </body>
    </html>
  `);
});

module.exports = router;

