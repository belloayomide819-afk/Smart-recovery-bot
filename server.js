const express = require("express");
const crypto = require("crypto");

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});
const PORT = process.env.PORT || 3000;

const CLIENT_ID = "34hOtWPGhXtUBtGqORxGB";
const REDIRECT_URI = "https://smart-recovery-bot.onrender.com/callback";

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

// LOGIN
app.get("/login", (req, res) => {
  const codeVerifier = base64url(crypto.randomBytes(32));

  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );

  const state = base64url(crypto.randomBytes(32));

  sessions.set(state, { codeVerifier });

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
    "https://auth.deriv.com/oauth2/auth?" + params.toString()
  );
});

// CALLBACK
app.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send("Deriv login was cancelled.");
  }

  if (!code || !state) {
    return res.status(400).send("Missing OAuth code or state.");
  }

  const session = sessions.get(state);

  if (!session) {
    return res.status(400).send("Invalid or expired OAuth state.");
  }

  sessions.delete(state);

  try {
    const tokenResponse = await fetch(
      "https://auth.deriv.com/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
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

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(tokenResponse.status).json(tokenData);
    }

    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return res.status(500).send(
        "Deriv did not return an access token."
      );
    }

    derivSession.accessToken = accessToken;

    const accountsResponse = await fetch(
      "https://api.derivws.com/trading/v1/options/accounts",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Deriv-App-ID": CLIENT_ID,
          "Content-Type": "application/json"
        }
      }
    );

    const accountsData = await accountsResponse.json();

    if (!accountsResponse.ok) {
      return res.status(accountsResponse.status).json(accountsData);
    }

    derivSession.accounts =
      accountsData.data ||
      accountsData.accounts ||
      [];

    console.log(
      "Deriv connected. Accounts:",
      derivSession.accounts.length
    );

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Smart Recovery Bot</title>
      </head>

      <body>
        <h2>Deriv Connected Successfully</h2>

        <p>Your Deriv account is connected.</p>

        <p>
          Accounts found:
          <b>${derivSession.accounts.length}</b>
        </p>

        <p>
          Connection status:
          <b>CONNECTED</b>
        </p>

        <p>
          You can return to the Smart Recovery Bot dashboard.
        </p>
      </body>
      </html>
    `);

  } catch (error) {
    console.error(error);
    res.status(500).send("OAuth connection failed.");
  }
});

// STATUS
app.get("/api/status", (req, res) => {
  res.json({
    connected: Boolean(derivSession.accessToken),
    accounts: derivSession.accounts.length
  });
});

// BALANCE
app.get("/api/balance", async (req, res) => {
  if (!derivSession.accessToken) {
    return res.status(401).json({
      error: "Deriv account is not connected."
    });
  }

  try {
    const response = await fetch(
      "https://api.derivws.com/trading/v1/options/accounts",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${derivSession.accessToken}`,
          "Deriv-App-ID": CLIENT_ID,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const accounts =
      data.data ||
      data.accounts ||
      [];

    derivSession.accounts = accounts;

    res.json({
      connected: true,
      accounts
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Unable to retrieve Deriv account data."
    });
  }
});

// HOME
app.get("/", (req, res) => {
  res.send("Smart Recovery Bot backend is running.");
});

// START SERVER
app.listen(PORT, () => {
  console.log(
    "Smart Recovery Bot running on port " + PORT
  );
});
