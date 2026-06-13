import "./styles.css";

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const pieceSymbols = {
  wp: "♙",
  wn: "♘",
  wb: "♗",
  wr: "♖",
  wq: "♕",
  wk: "♔",
  bp: "♟",
  bn: "♞",
  bb: "♝",
  br: "♜",
  bq: "♛",
  bk: "♚"
};

const params = new URLSearchParams(window.location.search);
let roomId = params.get("room") || "";
let token = params.get("token") || "";
let state = null;
let selectedSquare = "";
let pending = false;
let lastLoadedAt = Date.now();
let shareLinks = null;

const app = document.getElementById("app");

app.innerHTML = `
  <main class="shell">
    <section class="play-area">
      <header class="topbar">
        <div>
          <p class="eyebrow">7UB Chess</p>
          <h1>شطرنج مصغر</h1>
        </div>
        <div class="turn-pill" id="turn-pill">دعوة</div>
      </header>

      <section class="create-panel" id="create-panel">
        <label>
          <span>اسم الأبيض / صاحب الدعوة</span>
          <input id="create-white" maxlength="24" value="White" />
        </label>
        <label>
          <span>اسم الأسود</span>
          <input id="create-black" maxlength="24" value="Black" />
        </label>
        <label>
          <span>وقت كل لاعب</span>
          <select id="create-time">
            <option value="3">3 دقائق</option>
            <option value="5">5 دقائق</option>
            <option value="10" selected>10 دقائق</option>
            <option value="15">15 دقيقة</option>
            <option value="30">30 دقيقة</option>
          </select>
        </label>
        <button id="create-button" type="button">إنشاء دعوة</button>
      </section>

      <div class="board-wrap" id="board-wrap" hidden>
        <div class="player-strip" id="top-strip">
          <span id="top-name">Black</span>
          <strong id="top-clock">0:00</strong>
        </div>
        <div class="board" id="board" aria-label="Chess board"></div>
        <div class="player-strip" id="bottom-strip">
          <span id="bottom-name">White</span>
          <strong id="bottom-clock">0:00</strong>
        </div>
      </div>
    </section>

    <aside class="control-panel">
      <section class="panel-section status-section">
        <span class="label">الحالة</span>
        <strong id="status-title">إنشاء دعوة</strong>
        <p id="status-detail">صاحب الدعوة ينشئ الغرفة، ثم يرسل رابط الأسود ورابط المشاهدة.</p>
      </section>

      <section class="panel-section links-section" id="links-section" hidden>
        <span class="label">روابط الدعوة</span>
        <div class="link-row">
          <input id="white-link" readonly />
          <button data-copy="white-link" type="button">نسخ الأبيض</button>
        </div>
        <div class="link-row">
          <input id="black-link" readonly />
          <button data-copy="black-link" type="button">نسخ الأسود</button>
        </div>
        <div class="link-row">
          <input id="watch-link" readonly />
          <button data-copy="watch-link" type="button">نسخ المشاهدة</button>
        </div>
      </section>

      <section class="panel-section actions" id="actions-section" hidden>
        <button id="start-button" type="button">بدء المباراة</button>
        <button id="resign-button" class="danger" type="button">انسحاب</button>
        <button id="refresh-button" type="button">تحديث</button>
      </section>

      <section class="panel-section moves-section" id="moves-section" hidden>
        <span class="label">النقلات</span>
        <ol id="move-list"></ol>
      </section>
    </aside>
  </main>
`;

const createPanel = document.getElementById("create-panel");
const createWhite = document.getElementById("create-white");
const createBlack = document.getElementById("create-black");
const createTime = document.getElementById("create-time");
const createButton = document.getElementById("create-button");
const boardWrap = document.getElementById("board-wrap");
const boardEl = document.getElementById("board");
const turnPill = document.getElementById("turn-pill");
const topStrip = document.getElementById("top-strip");
const bottomStrip = document.getElementById("bottom-strip");
const topName = document.getElementById("top-name");
const bottomName = document.getElementById("bottom-name");
const topClock = document.getElementById("top-clock");
const bottomClock = document.getElementById("bottom-clock");
const statusTitle = document.getElementById("status-title");
const statusDetail = document.getElementById("status-detail");
const linksSection = document.getElementById("links-section");
const whiteLink = document.getElementById("white-link");
const blackLink = document.getElementById("black-link");
const watchLink = document.getElementById("watch-link");
const actionsSection = document.getElementById("actions-section");
const startButton = document.getElementById("start-button");
const resignButton = document.getElementById("resign-button");
const refreshButton = document.getElementById("refresh-button");
const movesSection = document.getElementById("moves-section");
const moveList = document.getElementById("move-list");

function colorLabel(color) {
  return color === "w" ? "الأبيض" : "الأسود";
}

function playerName(color) {
  if (!state) return colorLabel(color);
  return color === "w" ? state.players.white.name : state.players.black.name;
}

function orientation() {
  return state?.playerColor === "b" ? "black" : "white";
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function displayedClocks() {
  if (!state?.clocks) return { w: 0, b: 0 };
  const clocks = {
    w: Number(state.clocks.whiteMs || 0),
    b: Number(state.clocks.blackMs || 0)
  };
  if (state.status === "active" && state.turn) {
    const elapsed = Math.max(0, Date.now() - lastLoadedAt);
    clocks[state.turn] = Math.max(0, clocks[state.turn] - elapsed);
  }
  return clocks;
}

function squareFrom(row, col) {
  const boardOrientation = orientation();
  const file = boardOrientation === "black" ? files[7 - col] : files[col];
  const rank = boardOrientation === "black" ? row + 1 : 8 - row;
  return `${file}${rank}`;
}

function pieceAt(square) {
  if (!state || !square) return null;
  const fileIndex = files.indexOf(square[0]);
  const rank = Number(square[1]);
  const rowIndex = 8 - rank;
  if (fileIndex < 0 || rowIndex < 0 || rowIndex > 7) return null;
  return state.board[rowIndex][fileIndex];
}

function legalMovesFrom(square) {
  if (!state || !square) return [];
  return (state.legalMoves || []).filter((move) => move.from === square);
}

function canSelect(square) {
  const piece = pieceAt(square);
  return Boolean(
    state?.canMove &&
      piece &&
      piece.color === state.playerColor &&
      legalMovesFrom(square).length
  );
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

async function loadRoom() {
  if (!roomId) return;
  const url = new URL("/api/room", window.location.origin);
  url.searchParams.set("id", roomId);
  if (token) url.searchParams.set("token", token);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "تعذر تحميل الغرفة.");
  state = payload.room;
  if (state.links) shareLinks = state.links;
  lastLoadedAt = Date.now();
  if (selectedSquare && !canSelect(selectedSquare)) selectedSquare = "";
  render();
}

async function createRoom() {
  if (pending) return;
  pending = true;
  createButton.disabled = true;
  statusDetail.textContent = "جاري إنشاء الدعوة...";
  try {
    const payload = await postJson("/api/rooms", {
      whiteName: createWhite.value,
      blackName: createBlack.value,
      timeMinutes: createTime.value
    });
    state = payload.room;
    roomId = state.id;
    shareLinks = state.links;
    token = new URL(shareLinks.white).searchParams.get("token") || "";
    window.history.replaceState(null, "", `/?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`);
    render();
  } catch (error) {
    statusTitle.textContent = "خطأ";
    statusDetail.textContent = error.message;
  } finally {
    pending = false;
    createButton.disabled = false;
  }
}

async function startRoom() {
  if (!state?.canStart || pending) return;
  pending = true;
  try {
    const payload = await postJson("/api/room", {
      action: "start",
      roomId,
      token
    });
    state = payload.room;
    lastLoadedAt = Date.now();
    render();
  } catch (error) {
    statusDetail.textContent = error.message;
  } finally {
    pending = false;
  }
}

async function sendMove(from, to) {
  if (!state?.canMove || pending) return;
  const promotionMoves = legalMovesFrom(from).filter((move) => move.to === to && move.promotion);
  let promotion = "";
  if (promotionMoves.length) {
    const requested = window.prompt("ترقية البيدق: q للوزير، r للرخ، b للفيل، n للحصان", "q");
    promotion = ["q", "r", "b", "n"].includes(String(requested || "").toLowerCase())
      ? String(requested).toLowerCase()
      : "q";
  }

  pending = true;
  try {
    const payload = await postJson("/api/room", {
      action: "move",
      roomId,
      token,
      from,
      to,
      promotion
    });
    state = payload.room;
    selectedSquare = "";
    lastLoadedAt = Date.now();
    render();
  } catch (error) {
    statusDetail.textContent = error.message;
    await loadRoom().catch(() => null);
  } finally {
    pending = false;
  }
}

async function resign() {
  if (!state?.canResign || pending) return;
  if (!window.confirm(`${playerName(state.playerColor)} ينسحب؟`)) return;
  pending = true;
  try {
    const payload = await postJson("/api/room", {
      action: "resign",
      roomId,
      token
    });
    state = payload.room;
    selectedSquare = "";
    lastLoadedAt = Date.now();
    render();
  } catch (error) {
    statusDetail.textContent = error.message;
  } finally {
    pending = false;
  }
}

function statusCopy() {
  if (!roomId) {
    return {
      title: "إنشاء دعوة",
      detail: "صاحب الدعوة ينشئ الغرفة، ثم يرسل رابط الأسود ورابط المشاهدة.",
      pill: "دعوة"
    };
  }
  if (!state) {
    return {
      title: "تحميل",
      detail: "جاري تحميل الغرفة...",
      pill: "تحميل"
    };
  }
  if (state.status === "waiting") {
    if (state.isOwner) {
      return {
        title: "في انتظار الأسود",
        detail: state.players.black.joined
          ? "اللاعب الأسود دخل. صاحب الدعوة يقدر يبدأ المباراة الآن."
          : "أرسل رابط الأسود للاعب الثاني. زر البدء يظهر بعد دخوله.",
        pill: "انتظار"
      };
    }
    return {
      title: "في انتظار البداية",
      detail: state.role === "black"
        ? "دخلت كلاعب أسود. صاحب الدعوة فقط يبدأ المباراة."
        : "أنت تشاهد الغرفة. صاحب الدعوة فقط يبدأ المباراة.",
      pill: state.role === "spectator" ? "مشاهد" : colorLabel(state.playerColor)
    };
  }
  if (state.status === "finished") {
    return {
      title: state.result?.winnerColor
        ? `الفائز: ${playerName(state.result.winnerColor)}`
        : "تعادل",
      detail: state.result?.summary || "انتهت المباراة.",
      pill: "انتهت"
    };
  }

  const check = state.inCheck ? " يوجد كش." : "";
  return {
    title: state.canMove ? "دورك" : `دور ${playerName(state.turn)}`,
    detail: state.role === "spectator"
      ? `أنت تشاهد فقط. الدور على ${playerName(state.turn)}.${check}`
      : `أنت تلعب كـ ${colorLabel(state.playerColor)}. الدور على ${playerName(state.turn)}.${check}`,
    pill: state.role === "spectator" ? "مشاهد" : colorLabel(state.playerColor)
  };
}

function renderBoard() {
  boardEl.innerHTML = "";
  if (!state) return;
  const targets = new Set(legalMovesFrom(selectedSquare).map((move) => move.to));
  const lastMove = state.lastMove || {};

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = squareFrom(row, col);
      const piece = pieceAt(square);
      const fileIndex = files.indexOf(square[0]);
      const rank = Number(square[1]);
      const node = document.createElement("button");
      node.type = "button";
      node.className = [
        "square",
        (fileIndex + rank) % 2 === 0 ? "light" : "dark",
        canSelect(square) ? "own" : "",
        selectedSquare === square ? "selected" : "",
        targets.has(square) ? "target" : "",
        square === lastMove.from || square === lastMove.to ? "last" : ""
      ]
        .filter(Boolean)
        .join(" ");
      node.setAttribute("aria-label", square);
      if (piece) {
        const symbol = document.createElement("span");
        symbol.className = piece.color === "w" ? "piece-white" : "piece-black";
        symbol.textContent = pieceSymbols[`${piece.color}${piece.type}`] || "";
        node.appendChild(symbol);
      }
      node.addEventListener("click", () => handleSquareClick(square));
      boardEl.appendChild(node);
    }
  }
}

function handleSquareClick(square) {
  if (!state?.canMove) return;
  if (!selectedSquare) {
    if (canSelect(square)) {
      selectedSquare = square;
      renderBoard();
    }
    return;
  }
  if (square === selectedSquare) {
    selectedSquare = "";
    renderBoard();
    return;
  }
  if (canSelect(square)) {
    selectedSquare = square;
    renderBoard();
    return;
  }
  if (legalMovesFrom(selectedSquare).some((move) => move.to === square)) {
    void sendMove(selectedSquare, square);
    return;
  }
  selectedSquare = "";
  renderBoard();
}

function renderMoves() {
  moveList.innerHTML = "";
  for (let index = 0; index < (state?.moves || []).length; index += 2) {
    const item = document.createElement("li");
    const whiteMove = state.moves[index]?.san || "";
    const blackMove = state.moves[index + 1]?.san || "";
    item.textContent = `${Math.floor(index / 2) + 1}. ${whiteMove}${blackMove ? `   ${blackMove}` : ""}`;
    moveList.appendChild(item);
  }
}

function renderLinks() {
  const visible = Boolean(shareLinks && state?.canShare);
  linksSection.hidden = !visible;
  if (!visible) return;
  whiteLink.value = shareLinks.white || "";
  blackLink.value = shareLinks.black || "";
  watchLink.value = shareLinks.watch || "";
}

function renderClocks() {
  if (!state) return;
  const clocks = displayedClocks();
  const bottomColor = orientation() === "black" ? "b" : "w";
  const topColor = bottomColor === "w" ? "b" : "w";
  bottomName.textContent = playerName(bottomColor);
  topName.textContent = playerName(topColor);
  bottomClock.textContent = formatClock(clocks[bottomColor]);
  topClock.textContent = formatClock(clocks[topColor]);
  bottomStrip.classList.toggle("active", state.status === "active" && state.turn === bottomColor);
  topStrip.classList.toggle("active", state.status === "active" && state.turn === topColor);
}

function render() {
  const copy = statusCopy();
  createPanel.hidden = Boolean(roomId);
  boardWrap.hidden = !roomId || !state;
  actionsSection.hidden = !roomId || !state;
  movesSection.hidden = !roomId || !state;
  startButton.hidden = !state?.isOwner;
  startButton.disabled = !state?.canStart || pending;
  resignButton.hidden = state?.role === "spectator";
  resignButton.disabled = !state?.canResign || pending;
  statusTitle.textContent = copy.title;
  statusDetail.textContent = copy.detail;
  turnPill.textContent = copy.pill;
  renderLinks();
  renderClocks();
  renderMoves();
  renderBoard();
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const input = document.getElementById(button.dataset.copy);
    await navigator.clipboard.writeText(input.value);
    button.textContent = "تم النسخ";
    setTimeout(() => {
      button.textContent =
        button.dataset.copy === "white-link"
          ? "نسخ الأبيض"
          : button.dataset.copy === "black-link"
            ? "نسخ الأسود"
            : "نسخ المشاهدة";
    }, 1200);
  });
});

createButton.addEventListener("click", () => void createRoom());
startButton.addEventListener("click", () => void startRoom());
resignButton.addEventListener("click", () => void resign());
refreshButton.addEventListener("click", () => void loadRoom().catch((error) => {
  statusDetail.textContent = error.message;
}));

setInterval(() => {
  if (!state) return;
  renderClocks();
}, 250);

setInterval(() => {
  if (!roomId || pending) return;
  void loadRoom().catch(() => null);
}, 2000);

if (roomId) {
  loadRoom().catch((error) => {
    statusTitle.textContent = "خطأ";
    statusDetail.textContent = error.message;
  });
} else {
  render();
}
