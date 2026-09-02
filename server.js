const express = require("express");
const crypto = require("crypto");
const WebSocket = require("ws");

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

const tradingConnections = new Map();

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function getDecimalPlaces(value) {
  const text = String(value);

  if (!text.includes(".")) {
    return 0;
  }

  return text.split(".")[1].length;
}

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
        <style>
          body {
            font-family: Arial;
            padding: 30px;
            text-align: center;
          }

          .success {
            color: green;
            font-weight: bold;
          }
        </style>
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
          <span class="success">CONNECTED</span>
        </p>

        <p>
          You can return to the Smart Recovery Bot dashboard.
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

app.post(
  "/api/connect-trading",
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

    const old =
      tradingConnections.get(accountId);

    if (old?.ws) {
      try {
        old.ws.close();
      } catch {}
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

      console.log(
        "Opening trading WebSocket for:",
        accountId,
        account.account_type
      );

      const ws =
        new WebSocket(websocketUrl);

      const connection = {
        ws,
        accountId,
        accountType:
          account.account_type,
        connected: false,
        latestTick: null,
        latestDigit: null,
        balance: null,
        activeSymbols: [],
        error: null
      };

      tradingConnections.set(
        accountId,
        connection
      );

      ws.on("open", () => {

        console.log(
          "TRADING WEBSOCKET CONNECTED:",
          accountId
        );

        connection.connected = true;

        ws.send(
          JSON.stringify({
            balance: 1,
            subscribe: 1,
            req_id: 1
          })
        );

        ws.send(
          JSON.stringify({
            active_symbols: "brief",
            req_id: 2
          })
        );

        ws.send(
          JSON.stringify({
            ticks: "R_25",
            subscribe: 1,
            req_id: 3
          })
        );
      });

      ws.on("message", raw => {

        try {
          const message =
            JSON.parse(
              raw.toString()
            );

          console.log(
            "DERIV:",
            JSON.stringify(message)
          );

          if (
            message.msg_type ===
            "balance"
          ) {

            const balanceData =
              message.balance;

            if (
              balanceData &&
              typeof balanceData.balance ===
                "number"
            ) {
              connection.balance =
                balanceData.balance;
            } else if (
              balanceData &&
              typeof balanceData.balance ===
                "string"
            ) {
              connection.balance =
                Number(
                  balanceData.balance
                );
            } else if (
              typeof balanceData ===
                "number"
            ) {
              connection.balance =
                balanceData;
            }
          }

          if (
            message.msg_type ===
            "active_symbols"
          ) {
            connection.activeSymbols =
              message.active_symbols || [];
          }

          if (
            message.msg_type ===
            "tick"
          ) {

            const quote =
              Number(
                message.tick.quote
              );

            if (
              Number.isFinite(quote)
            ) {

              connection.latestTick =
                quote;

              const decimalPlaces =
                message.tick.pip_size != null
                  ? Math.max(
                      0,
                      Math.round(
                        -Math.log10(
                          Number(
                            message.tick.pip_size
                          )
                        )
                      )
                    )
                  : getDecimalPlaces(
                      message.tick.quote
                    );

              const text =
                quote.toFixed(
                  decimalPlaces
                );

              connection.latestDigit =
                Number(
                  text[text.length - 1]
                );
            }
          }

          if (message.error) {
            connection.error =
              message.error.message ||
              "Deriv WebSocket error";
          }

        } catch (error) {
          console.error(
            "WebSocket message error:",
            error
          );
        }
      });

      ws.on("error", error => {

        console.error(
          "Trading WebSocket error:",
          error
        );

        connection.error =
          error.message ||
          "WebSocket error";
      });

      ws.on("close", () => {

        console.log(
          "Trading WebSocket closed:",
          accountId
        );

        connection.connected = false;
      });

      await new Promise(resolve =>
        setTimeout(resolve, 1500)
      );

      if (!connection.connected) {

        return res.status(502).json({
          connected: false,
          error:
            connection.error ||
            "Trading WebSocket did not connect."
        });
      }

      res.json({
        connected: true,
        account_id: accountId,
        account_type:
          account.account_type,
        websocket_ready: true
      });

    } catch (error) {

      console.error(
        "Trading connection error:",
        error
      );

      res.status(500).json({
        error:
          "Unable to create trading connection."
      });
    }
  }
);

app.get("/api/tick", (req, res) => {

  const accountId =
    req.query.account_id;

  if (!accountId) {
    return res.status(400).json({
      error:
        "Account ID is required."
    });
  }

  const connection =
    tradingConnections.get(
      accountId
    );

  if (!connection) {
    return res.status(404).json({
      connected: false,
      error:
        "Trading connection not found."
    });
  }

  res.json({
    connected:
      connection.connected,

    account_id:
      connection.accountId,

    account_type:
      connection.accountType,

    balance:
      connection.balance,

    latest_tick:
      connection.latestTick,

    last_digit:
      connection.latestDigit,

    error:
      connection.error
  });
});

app.get("/", (req, res) => {
  res.send(
    "Smart Recovery Bot backend is running."
  );
});

app.listen(PORT, () => {

  console.log(
    "Smart Recovery Bot running on port " +
    PORT
  );
});
