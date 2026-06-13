const crypto = require("node:crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { Chess } = require("chess.js");

const CUSTOM_PREFIX = "hub_chess";
const DEFAULT_TIME_MINUTES = 10;
const MIN_TIME_MINUTES = 1;
const MAX_TIME_MINUTES = 120;
const DEFAULT_INVITE_MINUTES = 3;
const MIN_INVITE_MINUTES = 1;
const MAX_INVITE_MINUTES = 15;
const FINISHED_GAME_TTL_MS = 6 * 60 * 60 * 1000;

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createGameId() {
  return crypto.randomBytes(6).toString("base64url");
}

function createToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function normalizeBaseUrl(baseUrl, port) {
  const resolved = String(baseUrl || `http://localhost:${port || 3000}`).trim();
  return resolved.replace(/\/+$/, "");
}

function userTag(user) {
  return String(user?.tag || user?.username || user?.id || "Player");
}

function mentionUser(userId) {
  return userId ? `<@${userId}>` : "Unknown player";
}

function colorLabel(color) {
  return color === "w" ? "الأبيض" : "الأسود";
}

function opponentColor(color) {
  return color === "w" ? "b" : "w";
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function safeServiceError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function safeReply(interaction, payload) {
  const attempts = interaction.deferred
    ? ["editReply", "followUp", "reply"]
    : interaction.replied
      ? ["followUp", "reply", "editReply"]
      : ["reply", "followUp", "editReply"];

  for (const attempt of attempts) {
    try {
      if (attempt === "editReply") {
        const { flags, ...editablePayload } = payload || {};
        return await interaction.editReply(editablePayload);
      }
      return await interaction[attempt](payload);
    } catch (error) {
      if (error?.code === 10062) return null;
      if (error?.code === 40060 || error?.code === "InteractionNotReplied") continue;
      throw error;
    }
  }
  return null;
}

function createChessService({ baseUrl, port, logger = console, getDiscordClient } = {}) {
  const games = new Map();
  const timers = new Map();

  function gameUrl(gameId, token = "") {
    const url = new URL(`/chess/${encodeURIComponent(gameId)}`, normalizeBaseUrl(baseUrl, port));
    if (token) url.searchParams.set("token", token);
    return url.toString();
  }

  function clearGameTimers(gameId) {
    const entry = timers.get(gameId);
    if (!entry) return;
    for (const timer of Object.values(entry)) {
      if (timer) clearTimeout(timer);
    }
    timers.delete(gameId);
  }

  function setGameTimer(gameId, key, timer) {
    const entry = timers.get(gameId) || {};
    if (entry[key]) clearTimeout(entry[key]);
    entry[key] = timer;
    timers.set(gameId, entry);
    if (typeof timer?.unref === "function") timer.unref();
  }

  function hydrateChess(game) {
    const chess = new Chess();
    for (const move of game.moves || []) {
      chess.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion || undefined
      });
    }
    return chess;
  }

  function resolveRole(game, token) {
    if (!token) return { role: "spectator", color: null };
    if (token === game.players.w?.token) return { role: "player", color: "w" };
    if (token === game.players.b?.token) return { role: "player", color: "b" };
    return { role: "spectator", color: null };
  }

  function resolveUserColor(game, userId) {
    const normalized = String(userId || "");
    if (normalized && game.players.w?.id === normalized) return "w";
    if (normalized && game.players.b?.id === normalized) return "b";
    return null;
  }

  function displayedRemainingMs(game, now = Date.now()) {
    const remaining = {
      w: Number(game.remainingMs?.w || 0),
      b: Number(game.remainingMs?.b || 0)
    };
    if (game.status !== "active" || !game.activeTurnStartedAt) return remaining;
    const chess = hydrateChess(game);
    const turn = chess.turn();
    remaining[turn] = Math.max(0, remaining[turn] - Math.max(0, now - game.activeTurnStartedAt));
    return remaining;
  }

  function applyClock(game, now = Date.now()) {
    if (game.status !== "active" || !game.activeTurnStartedAt) return null;
    const chess = hydrateChess(game);
    const turn = chess.turn();
    const elapsed = Math.max(0, now - game.activeTurnStartedAt);
    game.remainingMs[turn] = Math.max(0, Number(game.remainingMs[turn] || 0) - elapsed);
    game.activeTurnStartedAt = now;
    return { color: turn, remainingMs: game.remainingMs[turn] };
  }

  function serializeBoard(chess) {
    return chess.board().map((row) =>
      row.map((piece) =>
        piece
          ? {
              color: piece.color,
              type: piece.type
            }
          : null
      )
    );
  }

  function serializeMove(move) {
    return {
      from: move.from,
      to: move.to,
      san: move.san,
      lan: move.lan,
      color: move.color,
      piece: move.piece,
      captured: move.captured || "",
      promotion: move.promotion || "",
      flags: move.flags || ""
    };
  }

  function serializeGame(game, token = "") {
    if (!game) return null;
    const chess = hydrateChess(game);
    const role = resolveRole(game, token);
    const remaining = displayedRemainingMs(game);
    const legalMoves =
      game.status === "active" && role.color === chess.turn()
        ? chess.moves({ verbose: true }).map(serializeMove)
        : [];

    return {
      id: game.id,
      status: game.status,
      createdAt: game.createdAt,
      inviteExpiresAt: game.inviteExpiresAt,
      startedAt: game.startedAt,
      finishedAt: game.finishedAt,
      timeControlSeconds: game.timeControlSeconds,
      turn: game.status === "active" ? chess.turn() : null,
      fen: chess.fen(),
      pgn: chess.pgn(),
      board: serializeBoard(chess),
      inCheck: chess.isCheck(),
      legalMoves,
      lastMove: game.moves.at(-1) || null,
      moves: game.moves,
      players: {
        white: {
          id: game.players.w?.id || "",
          tag: game.players.w?.tag || ""
        },
        black: game.players.b
          ? {
              id: game.players.b.id,
              tag: game.players.b.tag
            }
          : null
      },
      role: role.role,
      playerColor: role.color,
      result: game.result || null,
      clocks: {
        whiteMs: remaining.w,
        blackMs: remaining.b,
        white: formatClock(remaining.w),
        black: formatClock(remaining.b),
        activeTurnStartedAt: game.status === "active" ? game.activeTurnStartedAt : null,
        serverNow: Date.now()
      },
      links: {
        watch: gameUrl(game.id),
        player: role.color ? gameUrl(game.id, token) : ""
      }
    };
  }

  function inviteModal() {
    return new ModalBuilder()
      .setCustomId(`${CUSTOM_PREFIX}_modal:create`)
      .setTitle("دعوة شطرنج")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("time_minutes")
            .setLabel("وقت كل لاعب بالدقائق")
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(3)
            .setRequired(true)
            .setPlaceholder(String(DEFAULT_TIME_MINUTES))
            .setValue(String(DEFAULT_TIME_MINUTES))
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("invite_minutes")
            .setLabel("مدة انتظار الدعوة بالدقائق")
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(2)
            .setRequired(true)
            .setPlaceholder(String(DEFAULT_INVITE_MINUTES))
            .setValue(String(DEFAULT_INVITE_MINUTES))
        )
      );
  }

  function makeLinkRow({ label, url }) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url)
      )
    ];
  }

  function buildPlayerLinkPayload(game, token, message) {
    const role = resolveRole(game, token);
    const components = makeLinkRow({
      label: role.color ? `اللعب كـ ${colorLabel(role.color)}` : "مشاهدة",
      url: role.color ? gameUrl(game.id, token) : gameUrl(game.id)
    });

    if (game.status === "active" && role.color) {
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_PREFIX}_resign:${game.id}`)
            .setLabel("انسحاب")
            .setStyle(ButtonStyle.Danger)
        )
      );
    }

    return {
      content: message,
      components,
      flags: MessageFlags.Ephemeral
    };
  }

  function buildGameEmbed(game) {
    const chess = hydrateChess(game);
    const remaining = displayedRemainingMs(game);
    const embed = new EmbedBuilder()
      .setTitle("7UB Chess")
      .setColor(game.status === "finished" ? 0x2ecc71 : game.status === "active" ? 0x3498db : 0xf1c40f)
      .addFields(
        {
          name: "الأبيض",
          value: `${mentionUser(game.players.w?.id)}\n${formatClock(remaining.w)}`,
          inline: true
        },
        {
          name: "الأسود",
          value: game.players.b
            ? `${mentionUser(game.players.b.id)}\n${formatClock(remaining.b)}`
            : "في انتظار لاعب",
          inline: true
        },
        {
          name: "الحالة",
          value:
            game.status === "open"
              ? `الدعوة تنتهي <t:${Math.floor(game.inviteExpiresAt / 1000)}:R>`
              : game.status === "active"
                ? `الدور: ${colorLabel(chess.turn())}${chess.isCheck() ? " - كش" : ""}`
                : game.result?.summary || "انتهت المباراة",
          inline: false
        }
      )
      .setFooter({ text: `Game ${game.id}` })
      .setTimestamp(new Date(game.updatedAt || game.createdAt));

    if (game.status === "active" && game.moves.length > 0) {
      embed.addFields({
        name: "آخر نقلة",
        value: game.moves.at(-1).san,
        inline: true
      });
    }

    return embed;
  }

  function buildGameComponents(game) {
    const row = new ActionRowBuilder();
    if (game.status === "open") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_PREFIX}_join:${game.id}`)
          .setLabel("انضمام")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_PREFIX}_open:${game.id}`)
          .setLabel("مشاهدة")
          .setStyle(ButtonStyle.Secondary)
      );
      return [row];
    }

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_PREFIX}_open:${game.id}`)
        .setLabel(game.status === "active" ? "فتح اللعبة" : "مشاهدة النتيجة")
        .setStyle(game.status === "active" ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
    return [row];
  }

  function buildGameMessage(game) {
    return {
      content: game.status === "open" ? "دعوة شطرنج مفتوحة." : null,
      embeds: [buildGameEmbed(game)],
      components: buildGameComponents(game)
    };
  }

  function buildPanelMessage() {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle("7UB Chess")
          .setDescription("اضغط الزر لإنشاء دعوة شطرنج بوقت تختاره. أي عضو يمكنه الانضمام أو المشاهدة.")
          .setColor(0x5865f2)
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_PREFIX}_panel_create`)
            .setLabel("إنشاء دعوة")
            .setStyle(ButtonStyle.Primary)
        )
      ]
    };
  }

  async function getDiscordMessage(game) {
    const discordClient = typeof getDiscordClient === "function" ? getDiscordClient() : null;
    if (!discordClient || !game.channelId || !game.messageId) return null;
    const channel = await discordClient.channels.fetch(game.channelId).catch(() => null);
    if (!channel || typeof channel.messages?.fetch !== "function") return null;
    return channel.messages.fetch(game.messageId).catch(() => null);
  }

  async function syncDiscordGameMessage(game) {
    game.updatedAt = Date.now();
    const message = await getDiscordMessage(game);
    if (!message) return;
    await message.edit(buildGameMessage(game)).catch((error) => {
      logger.warn?.(`Failed to edit chess message ${game.id}: ${error?.message || error}`);
    });
  }

  async function sendResultAnnouncement(game) {
    if (game.announcementMessageId || !game.channelId) return;
    const discordClient = typeof getDiscordClient === "function" ? getDiscordClient() : null;
    if (!discordClient) return;
    const channel = await discordClient.channels.fetch(game.channelId).catch(() => null);
    if (!channel || typeof channel.send !== "function") return;

    const result = game.result || {};
    const content = result.winnerId
      ? `انتهت مباراة الشطرنج. الفائز: ${mentionUser(result.winnerId)} (${colorLabel(result.winnerColor)}).`
      : "انتهت مباراة الشطرنج بالتعادل.";
    const message = await channel
      .send({
        content,
        components: makeLinkRow({
          label: "مشاهدة المباراة",
          url: gameUrl(game.id)
        })
      })
      .catch((error) => {
        logger.warn?.(`Failed to send chess result ${game.id}: ${error?.message || error}`);
        return null;
      });
    if (message?.id) game.announcementMessageId = message.id;
  }

  async function finishGame(game, result) {
    if (!game || game.status === "finished") return game;
    game.status = "finished";
    game.finishedAt = Date.now();
    game.activeTurnStartedAt = null;
    game.result = {
      winnerColor: result?.winnerColor || null,
      winnerId: result?.winnerColor ? game.players[result.winnerColor]?.id || null : null,
      loserColor: result?.loserColor || null,
      loserId: result?.loserColor ? game.players[result.loserColor]?.id || null : null,
      reason: result?.reason || "finished",
      summary: result?.summary || "انتهت المباراة"
    };
    clearGameTimers(game.id);
    await syncDiscordGameMessage(game);
    await sendResultAnnouncement(game);
    const cleanupTimer = setTimeout(() => {
      games.delete(game.id);
      clearGameTimers(game.id);
    }, FINISHED_GAME_TTL_MS);
    setGameTimer(game.id, "cleanup", cleanupTimer);
    return game;
  }

  async function expireInvite(game) {
    if (!game || game.status !== "open") return;
    game.status = "finished";
    game.finishedAt = Date.now();
    game.result = {
      winnerColor: null,
      winnerId: null,
      loserColor: null,
      loserId: null,
      reason: "expired",
      summary: "انتهت الدعوة بدون انضمام لاعب ثان."
    };
    clearGameTimers(game.id);
    await syncDiscordGameMessage(game);
    const cleanupTimer = setTimeout(() => {
      games.delete(game.id);
      clearGameTimers(game.id);
    }, FINISHED_GAME_TTL_MS);
    setGameTimer(game.id, "cleanup", cleanupTimer);
  }

  function scheduleInviteExpiry(game) {
    const delay = Math.max(1000, game.inviteExpiresAt - Date.now());
    const timer = setTimeout(() => {
      const current = games.get(game.id);
      void expireInvite(current).catch((error) => {
        logger.warn?.(`Failed to expire chess invite ${game.id}: ${error?.message || error}`);
      });
    }, delay);
    setGameTimer(game.id, "invite", timer);
  }

  function scheduleTurnTimeout(game) {
    if (!game || game.status !== "active") return;
    const chess = hydrateChess(game);
    const turn = chess.turn();
    const remaining = displayedRemainingMs(game)[turn];
    const timer = setTimeout(() => {
      const current = games.get(game.id);
      if (!current || current.status !== "active") return;
      const clock = applyClock(current);
      if (clock && clock.remainingMs <= 0) {
        const winnerColor = opponentColor(clock.color);
        void finishGame(current, {
          winnerColor,
          loserColor: clock.color,
          reason: "timeout",
          summary: `انتهى وقت ${colorLabel(clock.color)}.`
        }).catch((error) => {
          logger.warn?.(`Failed to finish chess timeout ${game.id}: ${error?.message || error}`);
        });
        return;
      }
      scheduleTurnTimeout(current);
    }, Math.max(500, remaining + 250));
    setGameTimer(game.id, "turn", timer);
  }

  function createInvite({ guildId, channelId, host, timeMinutes, inviteMinutes }) {
    const time = clampInteger(timeMinutes, MIN_TIME_MINUTES, MAX_TIME_MINUTES, DEFAULT_TIME_MINUTES);
    const invite = clampInteger(inviteMinutes, MIN_INVITE_MINUTES, MAX_INVITE_MINUTES, DEFAULT_INVITE_MINUTES);
    const now = Date.now();
    const game = {
      id: createGameId(),
      guildId: String(guildId || ""),
      channelId: String(channelId || ""),
      messageId: "",
      status: "open",
      createdAt: now,
      updatedAt: now,
      inviteExpiresAt: now + invite * 60 * 1000,
      startedAt: null,
      finishedAt: null,
      timeControlSeconds: time * 60,
      activeTurnStartedAt: null,
      remainingMs: {
        w: time * 60 * 1000,
        b: time * 60 * 1000
      },
      players: {
        w: {
          id: String(host?.id || ""),
          tag: userTag(host),
          token: createToken()
        },
        b: null
      },
      moves: [],
      result: null,
      announcementMessageId: ""
    };
    games.set(game.id, game);
    scheduleInviteExpiry(game);
    return game;
  }

  function attachMessage(gameId, message) {
    const game = games.get(gameId);
    if (!game || !message?.id) return null;
    game.messageId = message.id;
    game.channelId = String(message.channelId || game.channelId || "");
    return game;
  }

  async function joinGame(gameId, user) {
    const game = games.get(gameId);
    if (!game) throw safeServiceError("not_found", "Game not found.", 404);
    if (game.status === "open" && Date.now() > game.inviteExpiresAt) {
      await expireInvite(game);
      throw safeServiceError("expired", "Invitation expired.", 410);
    }
    if (game.status !== "open") {
      const color = resolveUserColor(game, user?.id);
      if (color) return { game, color, alreadyJoined: true };
      throw safeServiceError("not_open", "This game is not open for joining.");
    }
    if (String(user?.id || "") === game.players.w.id) {
      return { game, color: "w", alreadyJoined: true };
    }

    game.players.b = {
      id: String(user?.id || ""),
      tag: userTag(user),
      token: createToken()
    };
    game.status = "active";
    game.startedAt = Date.now();
    game.activeTurnStartedAt = game.startedAt;
    game.updatedAt = game.startedAt;
    clearGameTimers(game.id);
    scheduleTurnTimeout(game);
    await syncDiscordGameMessage(game);
    return { game, color: "b", alreadyJoined: false };
  }

  async function resignGame(gameId, userId) {
    const game = games.get(gameId);
    if (!game) throw safeServiceError("not_found", "Game not found.", 404);
    if (game.status !== "active") throw safeServiceError("not_active", "This game is not active.");
    const loserColor = resolveUserColor(game, userId);
    if (!loserColor) throw safeServiceError("not_player", "Only players can resign.", 403);
    applyClock(game);
    const winnerColor = opponentColor(loserColor);
    await finishGame(game, {
      winnerColor,
      loserColor,
      reason: "resign",
      summary: `${colorLabel(loserColor)} انسحب.`
    });
    return game;
  }

  function resolveTokenColor(game, token) {
    const role = resolveRole(game, token);
    if (!role.color) throw safeServiceError("not_player", "A player token is required.", 403);
    return role.color;
  }

  function assertSquare(value) {
    const square = String(value || "").trim().toLowerCase();
    if (!/^[a-h][1-8]$/.test(square)) throw safeServiceError("bad_square", "Invalid square.");
    return square;
  }

  async function makeMove(gameId, { token, from, to, promotion } = {}) {
    const game = games.get(gameId);
    if (!game) throw safeServiceError("not_found", "Game not found.", 404);
    if (game.status !== "active") throw safeServiceError("not_active", "This game is not active.");

    const playerColor = resolveTokenColor(game, token);
    let chess = hydrateChess(game);
    if (chess.turn() !== playerColor) throw safeServiceError("not_turn", "It is not your turn.");

    const clock = applyClock(game);
    if (clock && clock.remainingMs <= 0) {
      const winnerColor = opponentColor(clock.color);
      await finishGame(game, {
        winnerColor,
        loserColor: clock.color,
        reason: "timeout",
        summary: `انتهى وقت ${colorLabel(clock.color)}.`
      });
      throw safeServiceError("timeout", "Your clock ran out.", 409);
    }

    chess = hydrateChess(game);
    const moveFrom = assertSquare(from);
    const moveTo = assertSquare(to);
    const requestedPromotion = String(promotion || "").trim().toLowerCase();
    const legalMoves = chess
      .moves({ verbose: true })
      .filter((move) => move.from === moveFrom && move.to === moveTo);
    const selectedMove =
      legalMoves.find((move) => move.promotion && move.promotion === requestedPromotion) ||
      legalMoves.find((move) => !move.promotion) ||
      legalMoves.find((move) => move.promotion === "q") ||
      legalMoves[0];

    if (!selectedMove) throw safeServiceError("illegal_move", "Illegal move.");
    const move = chess.move({
      from: moveFrom,
      to: moveTo,
      promotion: selectedMove.promotion || requestedPromotion || undefined
    });
    if (!move) throw safeServiceError("illegal_move", "Illegal move.");

    game.moves.push({
      at: Date.now(),
      color: move.color,
      from: move.from,
      to: move.to,
      san: move.san,
      lan: move.lan,
      piece: move.piece,
      captured: move.captured || "",
      promotion: move.promotion || "",
      flags: move.flags || "",
      before: move.before,
      after: move.after
    });
    game.updatedAt = Date.now();
    game.activeTurnStartedAt = game.updatedAt;

    if (chess.isCheckmate()) {
      await finishGame(game, {
        winnerColor: move.color,
        loserColor: opponentColor(move.color),
        reason: "checkmate",
        summary: `كش مات. الفائز ${colorLabel(move.color)}.`
      });
      return serializeGame(game, token);
    }

    if (chess.isDraw()) {
      let summary = "انتهت المباراة بالتعادل.";
      if (chess.isStalemate()) summary = "تعادل: لا توجد حركة قانونية.";
      else if (chess.isInsufficientMaterial()) summary = "تعادل: قطع غير كافية للمات.";
      else if (chess.isThreefoldRepetition()) summary = "تعادل: تكرار الوضع ثلاث مرات.";
      await finishGame(game, {
        winnerColor: null,
        loserColor: null,
        reason: "draw",
        summary
      });
      return serializeGame(game, token);
    }

    scheduleTurnTimeout(game);
    await syncDiscordGameMessage(game);
    return serializeGame(game, token);
  }

  async function resignByToken(gameId, token) {
    const game = games.get(gameId);
    if (!game) throw safeServiceError("not_found", "Game not found.", 404);
    const color = resolveTokenColor(game, token);
    return resignGame(gameId, game.players[color].id);
  }

  async function handleInteraction(interaction) {
    const customId = String(interaction.customId || "");
    if (interaction.isButton?.() && customId === `${CUSTOM_PREFIX}_panel_create`) {
      await interaction.showModal(inviteModal());
      return true;
    }

    if (interaction.isModalSubmit?.() && customId === `${CUSTOM_PREFIX}_modal:create`) {
      const timeMinutes = interaction.fields.getTextInputValue("time_minutes");
      const inviteMinutes = interaction.fields.getTextInputValue("invite_minutes");
      const game = createInvite({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        host: interaction.user,
        timeMinutes,
        inviteMinutes
      });
      const message = await interaction.channel?.send?.(buildGameMessage(game));
      attachMessage(game.id, message);
      await safeReply(
        interaction,
        buildPlayerLinkPayload(game, game.players.w.token, "تم إنشاء الدعوة. هذا رابط لعبك الخاص كالأبيض.")
      );
      return true;
    }

    if (!interaction.isButton?.() || !customId.startsWith(`${CUSTOM_PREFIX}_`)) return false;

    const [, actionAndId] = customId.split(`${CUSTOM_PREFIX}_`);
    const [action, gameId] = String(actionAndId || "").split(":");
    const game = games.get(gameId);
    if (!game) {
      await safeReply(interaction, {
        content: "هذه المباراة غير موجودة أو انتهت من ذاكرة البوت.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (action === "open") {
      const color = resolveUserColor(game, interaction.user?.id);
      const token = color ? game.players[color]?.token : "";
      await safeReply(
        interaction,
        buildPlayerLinkPayload(
          game,
          token,
          color ? `رابطك الخاص للعب كـ ${colorLabel(color)}.` : "تقدر تشاهد المباراة من هنا."
        )
      );
      return true;
    }

    if (action === "join") {
      try {
        const result = await joinGame(game.id, interaction.user);
        const token = game.players[result.color]?.token || "";
        await safeReply(
          interaction,
          buildPlayerLinkPayload(
            game,
            token,
            result.alreadyJoined
              ? `أنت داخل المباراة كـ ${colorLabel(result.color)}.`
              : `انضممت للمباراة كـ ${colorLabel(result.color)}.`
          )
        );
      } catch (error) {
        await safeReply(interaction, {
          content: error?.message || "تعذر الانضمام للمباراة.",
          flags: MessageFlags.Ephemeral
        });
      }
      return true;
    }

    if (action === "resign") {
      try {
        await resignGame(game.id, interaction.user?.id);
        await safeReply(interaction, {
          content: "تم تسجيل الانسحاب وإنهاء المباراة.",
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        await safeReply(interaction, {
          content: error?.message || "تعذر الانسحاب من المباراة.",
          flags: MessageFlags.Ephemeral
        });
      }
      return true;
    }

    return false;
  }

  async function sendPanel(interaction, channel) {
    const targetChannel = channel || interaction.channel;
    if (!targetChannel || typeof targetChannel.send !== "function") {
      await safeReply(interaction, {
        content: "لا يمكن إرسال لوحة الشطرنج في هذه القناة.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    await targetChannel.send(buildPanelMessage());
    await safeReply(interaction, {
      content: `تم إرسال لوحة الشطرنج في ${targetChannel}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  return {
    buildPanelMessage,
    createInvite,
    gameUrl,
    getState(gameId, token = "") {
      const game = games.get(String(gameId || ""));
      return game ? serializeGame(game, token) : null;
    },
    handleInteraction,
    inviteModal,
    joinGame,
    makeMove,
    resignByToken,
    resignGame,
    sendPanel
  };
}

module.exports = {
  CUSTOM_PREFIX,
  createChessService
};
