require("dotenv").config();

const path = require("node:path");
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  MessageFlags
} = require("discord.js");
const { buildCommands, hasPanelPermission } = require("./commands");
const { createChessService, CUSTOM_PREFIX } = require("./chessService");
const { renderChessPage } = require("./renderChessPage");

function parsePort(value, fallback = 3000) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  return fallback;
}

function publicBaseUrl(port) {
  return String(process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).trim().replace(/\/+$/, "");
}

function isLocalBaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function sendChessApiError(res, error) {
  res.status(error?.status || 400).json({
    ok: false,
    error: error?.message || "Chess request failed.",
    code: error?.code || "CHESS_ERROR"
  });
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred) return await interaction.editReply(payload);
    if (interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch (error) {
    if (error?.code === 10062 || error?.code === 40060) return null;
    throw error;
  }
}

const port = parsePort(process.env.PORT, 3000);
const baseUrl = publicBaseUrl(port);
const token = String(process.env.DISCORD_TOKEN || "").trim();

if (!token) {
  console.error("Missing DISCORD_TOKEN.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const chessService = createChessService({
  baseUrl,
  port,
  logger: console,
  getDiscordClient: () => client
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(
  "/assets",
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, assetPath) {
      const ext = path.extname(assetPath).toLowerCase();
      if (ext === ".js") res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      if (ext === ".css") res.setHeader("Content-Type", "text/css; charset=utf-8");
    }
  })
);

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    ready: client.isReady(),
    bot: client.user?.tag || null
  });
});

app.get("/chess/:gameId", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(
    renderChessPage({
      gameId: String(req.params.gameId || ""),
      token: String(req.query?.token || "")
    })
  );
});

app.get("/api/chess/:gameId", (req, res) => {
  const state = chessService.getState(req.params.gameId, String(req.query?.token || ""));
  if (!state) {
    res.status(404).json({
      ok: false,
      error: "Chess game not found.",
      code: "CHESS_NOT_FOUND"
    });
    return;
  }
  res.status(200).json(state);
});

app.post("/api/chess/:gameId/move", async (req, res) => {
  try {
    const state = await chessService.makeMove(req.params.gameId, {
      token: String(req.body?.token || ""),
      from: req.body?.from,
      to: req.body?.to,
      promotion: req.body?.promotion
    });
    res.status(200).json(state);
  } catch (error) {
    sendChessApiError(res, error);
  }
});

app.post("/api/chess/:gameId/resign", async (req, res) => {
  try {
    const tokenParam = String(req.body?.token || "");
    await chessService.resignByToken(req.params.gameId, tokenParam);
    res.status(200).json(chessService.getState(req.params.gameId, tokenParam));
  } catch (error) {
    sendChessApiError(res, error);
  }
});

client.once("clientReady", (readyClient) => {
  console.log(`Discord bot ready as ${readyClient.user.tag}.`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (
      (interaction.isButton?.() || interaction.isModalSubmit?.()) &&
      String(interaction.customId || "").startsWith(CUSTOM_PREFIX)
    ) {
      const handled = await chessService.handleInteraction(interaction);
      if (handled) return;
    }

    if (!interaction.isChatInputCommand?.() || interaction.commandName !== "chess") return;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "invite") {
      await interaction.showModal(chessService.inviteModal());
      return;
    }

    if (subcommand === "panel") {
      if (!hasPanelPermission(interaction)) {
        await safeReply(interaction, {
          content: "You need Manage Server permission to send the fixed chess panel.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const channel = interaction.options.getChannel("channel") || interaction.channel;
      await chessService.sendPanel(interaction, channel);
    }
  } catch (error) {
    console.error("Interaction error:", error);
    await safeReply(interaction, {
      content: "Something went wrong while handling this chess action.",
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
  }
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

if (isLocalBaseUrl(baseUrl)) {
  console.warn("PUBLIC_BASE_URL is local. Discord invite links will only work on this machine.");
}

app.listen(port, () => {
  console.log(`Web server listening on ${baseUrl} (port ${port}).`);
});

client.login(token).catch((error) => {
  console.error("Discord login failed:", error);
  process.exit(1);
});

module.exports = {
  app,
  buildCommands,
  chessService
};
