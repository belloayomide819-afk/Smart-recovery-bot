const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

const CLIENT_ID = "34hOtWPGhXtUBtGqORxGB";

const REDIRECT_URI =
  "https://smart-recovery-bot.onrender.com/callback";

const sessions = new Map();

let derivSession = {
  accessToken: null,
  accounts: []
};

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

app.get("/", (req, res) => {
  res.send("Smart Recovery Bot backend is running.");
});

app.get("/login", (req, res) => {
  const codeVerifier = base64url(
    crypto.randomBytes(32)
  );

  const codeChallenge = base64url(
    crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest()
  );

  const state = base64url(
    crypto.randomBytes(32)
  );

  sessions.set(state, {
    codeVerifier
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "trade",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  res.redirect(
    "https://auth.deriv.com/oauth2/auth?" +
      params.toString()
  );
});

app.get("/callback", async (req, res) => {
  const {
    code,
    state,
    error
  } = req.query;

  if (error) {
    return res.status(400).send(
      "Deriv login was cancelled."
    );
  }

  if (!code || !state) {
    return res.status(400).send(
      "Missing OAuth code or state."
    );
  }

  const session = sessions.get(state);

  if (!session) {
    return res.status(400).send(
      "Invalid or expired OAuth state."
    );
  }

  sessions.delete(state);

  try {
    const tokenResponse = await fetch(
      "https://auth.deriv.com/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code,
          code_verifier: session.codeVerifier,
          redirect_uri: REDIRECT_URI
        })
      }
    );

    const tokenData =
      await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res
        .status(tokenResponse.status)
        .json(tokenData);
    }

    const accessToken =
      tokenData.access_token;

    if (!accessToken) {
      return res.status(500).send(
        "Deriv did not return an access token."
      );
    }

    derivSession.accessToken =
      accessToken;

    const accountsResponse =
      await fetch(
        "https://api.derivws.com/trading/v1/options/accounts",
        {
          method: "GET",
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
            "Deriv-App-ID":
              CLIENT_ID,
            "Content-Type":
              "application/json"
          }
        }
      );

    const accountsData =
      await accountsResponse.json();

    if (!accountsResponse.ok) {
      return res
        .status(accountsResponse.status)
        .json(accountsData);
    }

    derivSession.accounts =
      accountsData.data ||
      accountsData.accounts ||
      [];

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport"
          content="width=device-width, initial-scale=1.0">
        <title>Smart Recovery Bot</title>
      </head>

      <body style="
        font-family:Arial;
        padding:30px;
        text-align:center;
      ">

        <h2 style="color:green;">
          Deriv Connected Successfully
        </h2>

        <p>Your Deriv account is connected.</p>

        <p>
          Accounts found:
          <b>${derivSession.accounts.length}</b>
        </p>

        <p>
          Connection status:
          <b style="color:green;">CONNECTED</b>
        </p>

        <p>
          Return to the Smart Recovery Bot dashboard.
        </p>

      </body>
      </html>
    `);

  } catch (error) {
    console.error("OAuth error:", error);

    res.status(500).send(
      "OAuth connection failed."
    );
  }
});

app.get("/api/status", (req, res) => {
  res.json({
    connected:
      Boolean(derivSession.accessToken),

    accounts:
      derivSession.accounts.length
  });
});

app.get("/api/balance", async (req, res) => {
  if (!derivSession.accessToken) {
    return res.status(401).json({
      error:
        "Deriv account is not connected."
    });
  }

  try {
    const response =
      await fetch(
        "https://api.derivws.com/trading/v1/options/accounts",
        {
          method: "GET",
          headers: {
            Authorization:
              `Bearer ${derivSession.accessToken}`,
            "Deriv-App-ID":
              CLIENT_ID,
            "Content-Type":
              "application/json"
          }
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json(data);
    }

    const accounts =
      data.data ||
      data.accounts ||
      [];

    derivSession.accounts =
      accounts;

    res.json({
      connected: true,
      accounts
    });

  } catch (error) {
    console.error(
      "Balance error:",
      error
    );

    res.status(500).json({
      error:
        "Unable to retrieve Deriv account data."
    });
  }
});

/*
  IMPORTANT:

  We no longer open the Deriv WebSocket from Render.

  Instead, this endpoint requests the short-lived
  authenticated WebSocket URL and gives that URL
  to the browser.

  The browser will connect directly to Deriv.
*/

app.post(
  "/api/trading-url",
  async (req, res) => {

    if (!derivSession.accessToken) {
      return res.status(401).json({
        error:
          "Deriv account is not connected."
      });
    }

    const accountId =
      req.body?.account_id;

    if (!accountId) {
      return res.status(400).json({
        error:
          "Account ID is required."
      });
    }

    const account =
      derivSession.accounts.find(
        item =>
          item.account_id === accountId
      );

    if (!account) {
      return res.status(403).json({
        error:
          "This account is not available."
      });
    }

    /*
      SAFETY:
      During development, only DEMO accounts
      are allowed to receive a trading WebSocket.
    */

    if (
      String(account.account_type).toLowerCase() !==
      "demo"
    ) {
      return res.status(403).json({
        error:
          "DEMO TEST MODE: Real trading is disabled."
      });
    }

    try {

      const response =
        await fetch(
          `https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`,
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${derivSession.accessToken}`,
              "Deriv-App-ID":
                CLIENT_ID,
              "Content-Type":
                "application/json"
            }
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        return res
          .status(response.status)
          .json(data);
      }

      const websocketUrl =
        data.data?.url;

      if (!websocketUrl) {
        return res.status(500).json({
          error:
            "Deriv did not return a WebSocket URL."
        });
      }

      res.json({
        connected: true,
        account_id: accountId,
        account_type:
          account.account_type,
        websocket_url:
          websocketUrl
      });

    } catch (error) {

      console.error(
        "Trading URL error:",
        error
      );

      res.status(500).json({
        error:
          "Unable to create Deriv trading URL."
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(
    "Smart Recovery Bot running on port " +
    PORT
  );
});
