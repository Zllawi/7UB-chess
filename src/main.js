import { Chess } from "chess.js";
import "./styles.css";

const STORAGE_KEY = "7ub-chess-state-v1";
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

const app = document.getElementById("app");

let chess = new Chess();
let moves = [];
let selectedSquare = "";
let orientation = "white";
let status = "setup";
let result = null;
let activeTurnStartedAt = 0;
let clockSeconds = {
  w: 10 * 60,
  b: 10 * 60
};
let timeControlMinutes = 10;
let playerNames = {
  w: "White",
  b: "Black"
};

app.innerHTML = `
  <main class="shell">
    <section class="play-area">
      <header class="topbar">
        <div>
          <p class="eyebrow">7UB Chess</p>
          <h1>شطرنج مصغر</h1>
        </div>
        <div class="turn-pill" id="turn-pill">إعداد</div>
      </header>

      <div class="board-wrap">
        <div class="player-strip" id="black-strip">
          <span id="black-name">Black</span>
          <strong id="black-clock">10:00</strong>
        </div>
        <div class="board" id="board" aria-label="Chess board"></div>
        <div class="player-strip" id="white-strip">
          <span id="white-name">White</span>
          <strong id="white-clock">10:00</strong>
        </div>
      </div>
    </section>

    <aside class="control-panel">
      <section class="panel-section setup-grid" id="setup-panel">
        <label>
          <span>الأبيض</span>
          <input id="white-input" maxlength="24" value="White" />
        </label>
        <label>
          <span>الأسود</span>
          <input id="black-input" maxlength="24" value="Black" />
        </label>
        <label>
          <span>وقت كل لاعب</span>
          <select id="time-select">
            <option value="3">3 دقائق</option>
            <option value="5">5 دقائق</option>
            <option value="10" selected>10 دقائق</option>
            <option value="15">15 دقيقة</option>
            <option value="30">30 دقيقة</option>
          </select>
        </label>
        <button id="start-button" type="button">بدء مباراة</button>
      </section>

      <section class="panel-section status-section">
        <span class="label">الحالة</span>
        <strong id="status-title">اضبط المباراة</strong>
        <p id="status-detail">اختار الأسماء والوقت ثم ابدأ اللعب على نفس الجهاز.</p>
      </section>

      <section class="panel-section actions">
        <button id="flip-button" type="button">قلب الرقعة</button>
        <button id="resign-button" class="danger" type="button" disabled>انسحاب</button>
        <button id="reset-button" type="button">تصفير</button>
      </section>

      <section class="panel-section moves-section">
        <span class="label">النقلات</span>
        <ol id="move-list"></ol>
      </section>
    </aside>
  </main>
`;

const boardEl = document.getElementById("board");
const turnPill = document.getElementById("turn-pill");
const whiteNameEl = document.getElementById("white-name");
const blackNameEl = document.getElementById("black-name");
const whiteClockEl = document.getElementById("white-clock");
const blackClockEl = document.getElementById("black-clock");
const whiteStrip = document.getElementById("white-strip");
const blackStrip = document.getElementById("black-strip");
const statusTitle = document.getElementById("status-title");
const statusDetail = document.getElementById("status-detail");
const moveList = document.getElementById("move-list");
const setupPanel = document.getElementById("setup-panel");
const whiteInput = document.getElementById("white-input");
const blackInput = document.getElementById("black-input");
const timeSelect = document.getElementById("time-select");
const startButton = document.getElementById("start-button");
const flipButton = document.getElementById("flip-button");
const resignButton = document.getElementById("resign-button");
const resetButton = document.getElementById("reset-button");

function colorLabel(color) {
  return color === "w" ? "الأبيض" : "الأسود";
}

function clampName(value, fallback) {
  const normalized = String(value || "").trim().slice(0, 24);
  return normalized || fallback;
}

function formatClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(totalSeconds || 0)));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getDisplayedClock() {
  const output = { ...clockSeconds };
  if (status !== "active" || !activeTurnStartedAt) return output;
  const turn = chess.turn();
  const elapsed = Math.floor((Date.now() - activeTurnStartedAt) / 1000);
  output[turn] = Math.max(0, output[turn] - elapsed);
  return output;
}

function applyClock() {
  if (status !== "active" || !activeTurnStartedAt) return;
  const turn = chess.turn();
  const elapsed = Math.floor((Date.now() - activeTurnStartedAt) / 1000);
  clockSeconds[turn] = Math.max(0, clockSeconds[turn] - elapsed);
  activeTurnStartedAt = Date.now();
  if (clockSeconds[turn] <= 0) {
    finishGame({
      winner: turn === "w" ? "b" : "w",
      reason: `انتهى وقت ${colorLabel(turn)}.`
    });
  }
}

function squareFrom(row, col) {
  const file = orientation === "black" ? files[7 - col] : files[col];
  const rank = orientation === "black" ? row + 1 : 8 - row;
  return `${file}${rank}`;
}

function pieceAt(square) {
  return chess.get(square);
}

function legalMovesFrom(square) {
  if (status !== "active") return [];
  return chess.moves({ square, verbose: true });
}

function canSelect(square) {
  const piece = pieceAt(square);
  return Boolean(piece && piece.color === chess.turn() && legalMovesFrom(square).length);
}

function serializeState() {
  return {
    fen: chess.fen(),
    moves,
    orientation,
    status,
    result,
    activeTurnStartedAt,
    clockSeconds,
    timeControlMinutes,
    playerNames
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return;
    chess = new Chess(saved.fen || undefined);
    moves = Array.isArray(saved.moves) ? saved.moves : [];
    orientation = saved.orientation === "black" ? "black" : "white";
    status = ["setup", "active", "finished"].includes(saved.status) ? saved.status : "setup";
    result = saved.result || null;
    activeTurnStartedAt = Number(saved.activeTurnStartedAt || 0);
    clockSeconds = {
      w: Math.max(0, Number(saved.clockSeconds?.w || 600)),
      b: Math.max(0, Number(saved.clockSeconds?.b || 600))
    };
    timeControlMinutes = Math.max(1, Number(saved.timeControlMinutes || 10));
    playerNames = {
      w: clampName(saved.playerNames?.w, "White"),
      b: clampName(saved.playerNames?.b, "Black")
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function statusCopy() {
  if (status === "setup") {
    return {
      title: "اضبط المباراة",
      detail: "اختار الأسماء والوقت ثم ابدأ اللعب على نفس الجهاز.",
      pill: "إعداد"
    };
  }

  if (status === "finished") {
    if (result?.winner) {
      return {
        title: `الفائز: ${playerNames[result.winner]}`,
        detail: result.reason || "انتهت المباراة.",
        pill: "انتهت"
      };
    }
    return {
      title: "تعادل",
      detail: result?.reason || "انتهت المباراة بالتعادل.",
      pill: "تعادل"
    };
  }

  const turn = chess.turn();
  const check = chess.isCheck() ? " يوجد كش." : "";
  return {
    title: `دور ${playerNames[turn]}`,
    detail: `يلعب ${colorLabel(turn)} الآن.${check}`,
    pill: colorLabel(turn)
  };
}

function renderBoard() {
  boardEl.innerHTML = "";
  const targetSquares = new Set(legalMovesFrom(selectedSquare).map((move) => move.to));
  const lastMove = moves.at(-1) || {};

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = squareFrom(row, col);
      const piece = pieceAt(square);
      const fileIndex = files.indexOf(square[0]);
      const rank = Number(square[1]);
      const button = document.createElement("button");
      button.type = "button";
      button.className = [
        "square",
        (fileIndex + rank) % 2 === 0 ? "light" : "dark",
        canSelect(square) ? "own" : "",
        selectedSquare === square ? "selected" : "",
        targetSquares.has(square) ? "target" : "",
        square === lastMove.from || square === lastMove.to ? "last" : ""
      ]
        .filter(Boolean)
        .join(" ");
      button.dataset.square = square;
      button.setAttribute("aria-label", square);

      if (piece) {
        const symbol = document.createElement("span");
        symbol.className = piece.color === "w" ? "piece-white" : "piece-black";
        symbol.textContent = pieceSymbols[`${piece.color}${piece.type}`] || "";
        button.appendChild(symbol);
      }

      button.addEventListener("click", () => handleSquareClick(square));
      boardEl.appendChild(button);
    }
  }
}

function renderMoves() {
  moveList.innerHTML = "";
  for (let index = 0; index < moves.length; index += 2) {
    const item = document.createElement("li");
    const whiteMove = moves[index]?.san || "";
    const blackMove = moves[index + 1]?.san || "";
    item.textContent = `${Math.floor(index / 2) + 1}. ${whiteMove}${blackMove ? `   ${blackMove}` : ""}`;
    moveList.appendChild(item);
  }
}

function render() {
  const clocks = getDisplayedClock();
  const copy = statusCopy();
  whiteNameEl.textContent = playerNames.w;
  blackNameEl.textContent = playerNames.b;
  whiteClockEl.textContent = formatClock(clocks.w);
  blackClockEl.textContent = formatClock(clocks.b);
  whiteStrip.classList.toggle("active", status === "active" && chess.turn() === "w");
  blackStrip.classList.toggle("active", status === "active" && chess.turn() === "b");
  setupPanel.classList.toggle("locked", status === "active");
  resignButton.disabled = status !== "active";
  statusTitle.textContent = copy.title;
  statusDetail.textContent = copy.detail;
  turnPill.textContent = copy.pill;
  whiteInput.value = playerNames.w;
  blackInput.value = playerNames.b;
  timeSelect.value = String(timeControlMinutes);
  renderMoves();
  renderBoard();
}

function finishGame(nextResult) {
  status = "finished";
  result = nextResult;
  selectedSquare = "";
  activeTurnStartedAt = 0;
  saveState();
  render();
}

function checkGameEnd(lastMove) {
  if (chess.isCheckmate()) {
    finishGame({
      winner: lastMove.color,
      reason: `كش مات. ${playerNames[lastMove.color]} فاز.`
    });
    return true;
  }

  if (chess.isDraw()) {
    let reason = "انتهت المباراة بالتعادل.";
    if (chess.isStalemate()) reason = "تعادل: لا توجد حركة قانونية.";
    else if (chess.isInsufficientMaterial()) reason = "تعادل: قطع غير كافية للمات.";
    else if (chess.isThreefoldRepetition()) reason = "تعادل: تكرار الوضع ثلاث مرات.";
    finishGame({ winner: null, reason });
    return true;
  }

  return false;
}

function makeMove(from, to) {
  applyClock();
  if (status !== "active") return;

  const promotionMoves = legalMovesFrom(from).filter((move) => move.to === to && move.promotion);
  let promotion = "";
  if (promotionMoves.length) {
    const requested = window.prompt("ترقية البيدق: q للوزير، r للرخ، b للفيل، n للحصان", "q");
    promotion = ["q", "r", "b", "n"].includes(String(requested || "").toLowerCase())
      ? String(requested).toLowerCase()
      : "q";
  }

  const move = chess.move({ from, to, promotion: promotion || undefined });
  if (!move) return;
  moves.push({
    color: move.color,
    from: move.from,
    to: move.to,
    san: move.san,
    piece: move.piece,
    captured: move.captured || "",
    promotion: move.promotion || ""
  });
  selectedSquare = "";

  if (!checkGameEnd(move)) {
    activeTurnStartedAt = Date.now();
    saveState();
    render();
  }
}

function handleSquareClick(square) {
  if (status !== "active") return;
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
    makeMove(selectedSquare, square);
    return;
  }

  selectedSquare = "";
  renderBoard();
}

function startGame() {
  timeControlMinutes = Math.max(1, Number(timeSelect.value || 10));
  playerNames = {
    w: clampName(whiteInput.value, "White"),
    b: clampName(blackInput.value, "Black")
  };
  chess = new Chess();
  moves = [];
  selectedSquare = "";
  status = "active";
  result = null;
  clockSeconds = {
    w: timeControlMinutes * 60,
    b: timeControlMinutes * 60
  };
  activeTurnStartedAt = Date.now();
  saveState();
  render();
}

function resetGame() {
  const shouldReset = status === "setup" || window.confirm("تأكيد تصفير المباراة؟");
  if (!shouldReset) return;
  chess = new Chess();
  moves = [];
  selectedSquare = "";
  status = "setup";
  result = null;
  activeTurnStartedAt = 0;
  clockSeconds = {
    w: timeControlMinutes * 60,
    b: timeControlMinutes * 60
  };
  localStorage.removeItem(STORAGE_KEY);
  render();
}

startButton.addEventListener("click", startGame);
flipButton.addEventListener("click", () => {
  orientation = orientation === "white" ? "black" : "white";
  saveState();
  renderBoard();
});
resignButton.addEventListener("click", () => {
  if (status !== "active") return;
  const loser = chess.turn();
  const winner = loser === "w" ? "b" : "w";
  if (!window.confirm(`${playerNames[loser]} ينسحب؟`)) return;
  applyClock();
  finishGame({
    winner,
    reason: `${playerNames[loser]} انسحب.`
  });
});
resetButton.addEventListener("click", resetGame);

setInterval(() => {
  if (status !== "active") return;
  applyClock();
  saveState();
  render();
}, 1000);

loadState();
render();
