(function () {
  const bootstrap = window.__CHESS_BOOTSTRAP__ || {};
  const gameId = String(bootstrap.gameId || "");
  const token = String(bootstrap.token || "");

  const boardEl = document.getElementById("chess-board");
  const statusEl = document.getElementById("game-status");
  const detailEl = document.getElementById("game-detail");
  const rolePill = document.getElementById("role-pill");
  const whiteName = document.getElementById("white-name");
  const blackName = document.getElementById("black-name");
  const whiteClock = document.getElementById("white-clock");
  const blackClock = document.getElementById("black-clock");
  const whiteStrip = document.getElementById("white-strip");
  const blackStrip = document.getElementById("black-strip");
  const moveList = document.getElementById("move-list");
  const resignButton = document.getElementById("resign-button");
  const refreshButton = document.getElementById("refresh-button");

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

  let state = null;
  let selectedSquare = "";
  let lastLoadedAt = Date.now();
  let pendingMove = false;

  function apiUrl(path) {
    const url = new URL(path, window.location.origin);
    if (token) url.searchParams.set("token", token);
    return url.toString();
  }

  function colorLabel(color) {
    return color === "w" ? "الأبيض" : "الأسود";
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function setDetail(message, isError) {
    detailEl.textContent = message || "";
    detailEl.classList.toggle("toast", Boolean(isError));
  }

  function pieceAt(square) {
    if (!state || !square) return null;
    const fileIndex = files.indexOf(square[0]);
    const rank = Number(square[1]);
    const rowIndex = 8 - rank;
    if (fileIndex < 0 || rowIndex < 0 || rowIndex > 7) return null;
    return state.board[rowIndex][fileIndex];
  }

  function squareFrom(row, col, orientation) {
    const file = orientation === "black" ? files[7 - col] : files[col];
    const rank = orientation === "black" ? row + 1 : 8 - row;
    return `${file}${rank}`;
  }

  function legalMovesFrom(square) {
    if (!state || !square) return [];
    return (state.legalMoves || []).filter((move) => move.from === square);
  }

  function isLegalTarget(from, to) {
    return legalMovesFrom(from).some((move) => move.to === to);
  }

  function canMovePiece(square) {
    const piece = pieceAt(square);
    return Boolean(
      state &&
        state.status === "active" &&
        state.role === "player" &&
        state.playerColor === state.turn &&
        piece &&
        piece.color === state.playerColor &&
        legalMovesFrom(square).length
    );
  }

  function statusText() {
    if (!state) return "Loading...";
    if (state.status === "open") return "في انتظار لاعب ثان";
    if (state.status === "active") {
      return state.playerColor === state.turn ? "دورك" : `دور ${colorLabel(state.turn)}`;
    }
    if (state.result?.winnerId) return "انتهت بفائز";
    if (state.result?.reason === "expired") return "الدعوة انتهت";
    return "تعادل";
  }

  function detailText() {
    if (!state) return "";
    if (state.status === "open") {
      const expires = state.inviteExpiresAt
        ? Math.max(0, Math.ceil((state.inviteExpiresAt - Date.now()) / 1000))
        : 0;
      return `المضيف يلعب بالأبيض. تنتهي الدعوة خلال ${expires} ثانية.`;
    }
    if (state.status === "active") {
      const check = state.inCheck ? " يوجد كش." : "";
      return state.role === "player"
        ? `أنت تلعب كـ ${colorLabel(state.playerColor)}.${check}`
        : `أنت تشاهد المباراة.${check}`;
    }
    return state.result?.summary || "انتهت المباراة.";
  }

  function updateClocks() {
    if (!state?.clocks) return;
    let whiteMs = Number(state.clocks.whiteMs || 0);
    let blackMs = Number(state.clocks.blackMs || 0);
    if (state.status === "active" && state.turn) {
      const elapsed = Math.max(0, Date.now() - lastLoadedAt);
      if (state.turn === "w") whiteMs = Math.max(0, whiteMs - elapsed);
      if (state.turn === "b") blackMs = Math.max(0, blackMs - elapsed);
    }
    whiteClock.textContent = formatClock(whiteMs);
    blackClock.textContent = formatClock(blackMs);
  }

  function renderMoves() {
    moveList.innerHTML = "";
    const moves = state?.moves || [];
    for (let index = 0; index < moves.length; index += 2) {
      const item = document.createElement("li");
      const whiteMove = moves[index]?.san || "";
      const blackMove = moves[index + 1]?.san || "";
      item.textContent = `${Math.floor(index / 2) + 1}. ${whiteMove}${blackMove ? `   ${blackMove}` : ""}`;
      moveList.appendChild(item);
    }
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    if (!state) return;
    const orientation = state.playerColor === "b" ? "black" : "white";
    const targetSquares = new Set(legalMovesFrom(selectedSquare).map((move) => move.to));
    const lastMove = state.lastMove || {};

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const square = squareFrom(row, col, orientation);
        const piece = pieceAt(square);
        const fileIndex = files.indexOf(square[0]);
        const rank = Number(square[1]);
        const node = document.createElement("button");
        node.type = "button";
        node.className = [
          "square",
          (fileIndex + rank) % 2 === 0 ? "light" : "dark",
          canMovePiece(square) ? "own" : "",
          square === selectedSquare ? "selected" : "",
          targetSquares.has(square) ? "target" : "",
          square === lastMove.from || square === lastMove.to ? "last" : ""
        ]
          .filter(Boolean)
          .join(" ");
        node.dataset.square = square;
        node.setAttribute("aria-label", square);
        if (piece) {
          const span = document.createElement("span");
          span.className = piece.color === "w" ? "piece-white" : "piece-black";
          span.textContent = pieceSymbols[`${piece.color}${piece.type}`] || "";
          node.appendChild(span);
        }
        node.addEventListener("click", () => handleSquareClick(square));
        boardEl.appendChild(node);
      }
    }
  }

  function render() {
    if (!state) return;
    whiteName.textContent = state.players?.white?.tag || "White";
    blackName.textContent = state.players?.black?.tag || "Waiting";
    rolePill.textContent = state.role === "player" ? `لاعب ${colorLabel(state.playerColor)}` : "مشاهد";
    statusEl.textContent = statusText();
    setDetail(detailText(), false);
    whiteStrip.classList.toggle("active", state.status === "active" && state.turn === "w");
    blackStrip.classList.toggle("active", state.status === "active" && state.turn === "b");
    resignButton.disabled = !(state.status === "active" && state.role === "player");
    updateClocks();
    renderMoves();
    renderBoard();
  }

  async function loadState() {
    const response = await fetch(apiUrl(`/api/chess/${encodeURIComponent(gameId)}`), {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("تعذر تحميل المباراة.");
    state = await response.json();
    lastLoadedAt = Date.now();
    if (selectedSquare && !canMovePiece(selectedSquare)) selectedSquare = "";
    render();
  }

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || "Request failed.");
    return payload;
  }

  async function sendMove(from, to) {
    if (pendingMove) return;
    const promotionMoves = legalMovesFrom(from).filter((move) => move.to === to && move.promotion);
    let promotion = "";
    if (promotionMoves.length) {
      const requested = window.prompt("ترقية البيدق: q للوزير، r للرخ، b للفيل، n للحصان", "q");
      promotion = ["q", "r", "b", "n"].includes(String(requested || "").toLowerCase())
        ? String(requested).toLowerCase()
        : "q";
    }

    pendingMove = true;
    try {
      state = await postJson(`/api/chess/${encodeURIComponent(gameId)}/move`, {
        token,
        from,
        to,
        promotion
      });
      selectedSquare = "";
      lastLoadedAt = Date.now();
      render();
    } catch (error) {
      setDetail(error.message, true);
      await loadState().catch(() => null);
    } finally {
      pendingMove = false;
    }
  }

  function handleSquareClick(square) {
    if (!state || state.status !== "active" || state.role !== "player") return;
    if (!selectedSquare) {
      if (canMovePiece(square)) {
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
    if (canMovePiece(square)) {
      selectedSquare = square;
      renderBoard();
      return;
    }
    if (isLegalTarget(selectedSquare, square)) {
      void sendMove(selectedSquare, square);
      return;
    }
    selectedSquare = "";
    renderBoard();
  }

  async function resign() {
    if (!state || state.status !== "active" || state.role !== "player") return;
    const confirmed = window.confirm("تأكيد الانسحاب من المباراة؟");
    if (!confirmed) return;
    try {
      state = await postJson(`/api/chess/${encodeURIComponent(gameId)}/resign`, { token });
      lastLoadedAt = Date.now();
      selectedSquare = "";
      render();
    } catch (error) {
      setDetail(error.message, true);
    }
  }

  refreshButton.addEventListener("click", () => {
    loadState().catch((error) => setDetail(error.message, true));
  });
  resignButton.addEventListener("click", () => {
    void resign();
  });

  setInterval(() => {
    updateClocks();
    if (state?.status === "open") setDetail(detailText(), false);
  }, 250);

  setInterval(() => {
    if (!pendingMove) loadState().catch(() => null);
  }, 2000);

  loadState().catch((error) => {
    statusEl.textContent = "خطأ";
    setDetail(error.message, true);
  });
})();
