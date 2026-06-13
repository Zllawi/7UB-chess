function safeJsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    const replacements = {
      "<": "\\u003c",
      ">": "\\u003e",
      "&": "\\u0026",
      "\u2028": "\\u2028",
      "\u2029": "\\u2029"
    };
    return replacements[character];
  });
}

function renderChessPage({ gameId, token }) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>7UB Chess</title>
    <link rel="stylesheet" href="/assets/chess.css">
  </head>
  <body>
    <main class="chess-shell">
      <section class="board-zone">
        <div class="topbar">
          <div>
            <p class="eyebrow">7UB Chess</p>
            <h1>شطرنج مصغر</h1>
          </div>
          <div class="role-pill" id="role-pill">مشاهدة</div>
        </div>
        <div class="board-wrap">
          <div class="player-strip opponent" id="black-strip">
            <span id="black-name">Black</span>
            <strong id="black-clock">0:00</strong>
          </div>
          <div id="chess-board" class="chess-board" aria-label="Chess board"></div>
          <div class="player-strip self" id="white-strip">
            <span id="white-name">White</span>
            <strong id="white-clock">0:00</strong>
          </div>
        </div>
      </section>
      <aside class="side-panel">
        <div class="status-block">
          <span class="label">الحالة</span>
          <strong id="game-status">Loading...</strong>
          <p id="game-detail"></p>
        </div>
        <div class="actions">
          <button id="resign-button" class="danger" type="button">انسحاب</button>
          <button id="refresh-button" type="button">تحديث</button>
        </div>
        <div class="moves-block">
          <span class="label">النقلات</span>
          <ol id="move-list"></ol>
        </div>
      </aside>
    </main>
    <script>
      window.__CHESS_BOOTSTRAP__ = ${safeJsonForHtml({ gameId, token })};
    </script>
    <script src="/assets/chess.js" defer></script>
  </body>
</html>`;
}

module.exports = {
  renderChessPage
};
