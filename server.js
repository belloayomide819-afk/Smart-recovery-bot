const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const CLIENT_ID = "34hHdgalUQxRYo0jE6Qp";
const REDIRECT_URI =
  "https://belloayomide819-afk.github.io/Smart-recovery-bot/";

const sessions = new Map();

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

app.get("/login", (req, res) => {
  const codeVerifier = base64url(crypto.randomBytes(32));

  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );

  const state = base64url(crypto.randomBytes(32));

  sessions.set(state, {
    codeVerifier,
    created: Date.now()
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
    "https://auth.deriv.com/oauth2/auth?" + params.toString()
  );
});

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
    const response = await fetch(
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

    const data = await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json(data);
    }

    res.send(`
      <h2>Deriv Connected Successfully</h2>
      <p>Your Deriv authorization was received.</p>
      <p>You can now return to the Smart Recovery Bot.</p>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth connection failed.");
  }
});

app.get("/", (req, res) => {
  res.send("Smart Recovery Bot backend is running.");
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
