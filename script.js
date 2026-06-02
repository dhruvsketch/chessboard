// Chess (proper legal moves + minimax)
// - Legal move generation: check legality, castling, en-passant, promotion
// - UI: click piece then click destination (legal capture squares allowed)
// - Computer: plays black using minimax with configurable depth

let selectedSquare = null;

// select all squares
const squares = document.querySelectorAll(".chessboard div");

function clearSelection() {
  if (selectedSquare) selectedSquare.style.border = "none";
  selectedSquare = null;
}

// ---- Unicode mapping ----
const UNICODE_TO_PIECE = {
  "♔": "K",
  "♕": "Q",
  "♖": "R",
  "♗": "B",
  "♘": "N",
  "♙": "P",
  "♚": "k",
  "♛": "q",
  "♜": "r",
  "♝": "b",
  "♞": "n",
  "♟": "p",
};

const PIECE_TO_UNICODE = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

function idxToRC(idx) {
  return { r: Math.floor(idx / 8), c: idx % 8 };
}
function rcToIdx(r, c) {
  return r * 8 + c;
}

function getBoardFromDOM() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  squares.forEach((sq, idx) => {
    const ch = sq.innerHTML.trim();
    if (!ch) return;
    const p = UNICODE_TO_PIECE[ch];
    if (p) {
      const { r, c } = idxToRC(idx);
      board[r][c] = p;
    }
  });
  return board;
}

function applyBoardToDOM(state) {
  // state.board[r][c]
  for (let idx = 0; idx < 64; idx++) {
    const { r, c } = idxToRC(idx);
    const p = state.board[r][c];
    squares[idx].innerHTML = p ? PIECE_TO_UNICODE[p] : "";
  }
}

function pieceColor(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? "w" : "b";
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

// ---- Game state ----
function initialState() {
  // Infer initial castling rights from the starting layout.
  // If king/rooks are missing, disable corresponding rights.
  const board = getBoardFromDOM();

  const rights = { wK: true, wQ: true, bK: true, bQ: true };

  // white pieces expected: King e1 (7,4), rooks a1(7,0), h1(7,7)
  if (board[7][4] !== "K") rights.wK = rights.wQ = false;
  if (board[7][0] !== "R") rights.wQ = false;
  if (board[7][7] !== "R") rights.wK = false;

  // black pieces expected: King e8 (0,4), rooks a8(0,0), h8(0,7)
  if (board[0][4] !== "k") rights.bK = rights.bQ = false;
  if (board[0][0] !== "r") rights.bQ = false;
  if (board[0][7] !== "r") rights.bK = false;

  return {
    board,
    turn: "w", // player starts as white (computer black)
    castling: rights,
    enPassant: null,
  };
}

function cloneState(s) {
  return {
    board: s.board.map(row => row.slice()),
    turn: s.turn,
    castling: { ...s.castling },
    enPassant: s.enPassant ? { ...s.enPassant } : null,
  };
}

function opposite(color) {
  return color === "w" ? "b" : "w";
}

// ---- Attack detection ----
function findKing(board, color) {
  const target = color === "w" ? "K" : "k";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === target) return { r, c };
    }
  }
  return null;
}

function isSquareAttacked(board, r, c, byColor) {
  // Generate pseudo-attacks for all pieces of byColor.
  for (let rr = 0; rr < 8; rr++) {
    for (let cc = 0; cc < 8; cc++) {
      const p = board[rr][cc];
      if (!p) continue;
      if (pieceColor(p) !== byColor) continue;
      const lower = p.toLowerCase();

      if (lower === "p") {
        const dir = byColor === "w" ? -1 : 1;
        for (const dc of [-1, 1]) {
          const tr = rr + dir;
          const tc = cc + dc;
          if (tr === r && tc === c) return true;
        }
      } else if (lower === "n") {
        const jumps = [
          [-2, -1], [-2, 1], [-1, -2], [-1, 2],
          [1, -2], [1, 2], [2, -1], [2, 1],
        ];
        for (const [dr, dc] of jumps) {
          const tr = rr + dr, tc = cc + dc;
          if (tr === r && tc === c) return true;
        }
      } else if (lower === "b" || lower === "r" || lower === "q") {
        const dirs = [];
        if (lower === "b" || lower === "q") dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
        if (lower === "r" || lower === "q") dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
        for (const [dr, dc] of dirs) {
          let tr = rr + dr, tc = cc + dc;
          while (inBounds(tr, tc)) {
            if (tr === r && tc === c) return true;
            if (board[tr][tc]) break;
            tr += dr; tc += dc;
          }
        }
      } else if (lower === "k") {
        const steps = [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
          [1, -1],  [1, 0],  [1, 1],
        ];
        for (const [dr, dc] of steps) {
          const tr = rr + dr, tc = cc + dc;
          if (tr === r && tc === c) return true;
        }
      }
    }
  }
  return false;
}

function isInCheck(state, color) {
  const { board } = state;
  const king = findKing(board, color);
  if (!king) return false;
  return isSquareAttacked(board, king.r, king.c, opposite(color));
}

// ---- Move generation ----
// Move object format:
// { from:{r,c}, to:{r,c}, piece, capture?:{r,c,piece}, promotion?:{piece}, enPassantCapture?:{r,c}, castling?:"K"|"Q" }

function makeMove(state, move) {
  const next = cloneState(state);
  const { from, to } = move;

  const moving = next.board[from.r][from.c];
  next.board[from.r][from.c] = null;

  // capture (normal)
  if (move.capture) {
    next.board[move.capture.r][move.capture.c] = null;
  }

  // en-passant capture
  if (move.enPassantCapture) {
    next.board[move.enPassantCapture.r][move.enPassantCapture.c] = null;
  }

  // promotion
  let placed = moving;
  if (move.promotion) {
    placed = move.promotion.piece;
  }

  next.board[to.r][to.c] = placed;

  // update castling rights if king/rook moved or rook captured
  // King move clears both for that color
  if (moving === "K") {
    next.castling.wK = false;
    next.castling.wQ = false;
  } else if (moving === "k") {
    next.castling.bK = false;
    next.castling.bQ = false;
  }

  // rook move clears appropriate right
  if (moving === "R") {
    if (from.r === 7 && from.c === 0) next.castling.wQ = false;
    if (from.r === 7 && from.c === 7) next.castling.wK = false;
  }
  if (moving === "r") {
    if (from.r === 0 && from.c === 0) next.castling.bQ = false;
    if (from.r === 0 && from.c === 7) next.castling.bK = false;
  }

  // rook capture clears rights
  if (move.capture) {
    const capPiece = move.capture.piece;
    const capR = move.capture.r;
    const capC = move.capture.c;
    if (capPiece === "R") {
      if (capR === 7 && capC === 0) next.castling.wQ = false;
      if (capR === 7 && capC === 7) next.castling.wK = false;
    } else if (capPiece === "r") {
      if (capR === 0 && capC === 0) next.castling.bQ = false;
      if (capR === 0 && capC === 7) next.castling.bK = false;
    }
  }

  // castling rook movement
  if (move.castling) {
    if (moving === "K") {
      if (move.castling === "K") {
        // rook from h1 to f1
        next.board[7][5] = next.board[7][7];
        next.board[7][7] = null;
      } else {
        // rook from a1 to d1
        next.board[7][3] = next.board[7][0];
        next.board[7][0] = null;
      }
    } else if (moving === "k") {
      if (move.castling === "K") {
        next.board[0][5] = next.board[0][7];
        next.board[0][7] = null;
      } else {
        next.board[0][3] = next.board[0][0];
        next.board[0][0] = null;
      }
    }
  }

  // en-passant target update
  next.enPassant = null;
  if (moving.toLowerCase() === "p" && Math.abs(to.r - from.r) === 2) {
    // target square is the square passed over
    const midR = (to.r + from.r) / 2;
    next.enPassant = { r: midR, c: from.c };
  }

  // switch turn
  next.turn = opposite(state.turn);
  return next;
}

function addIfCapture(moves, state, color, from, to) {
  const target = state.board[to.r][to.c];
  if (!target) return false;
  if (pieceColor(target) === color) return false;
  moves.push({ from, to, piece: state.board[from.r][from.c], capture: { r: to.r, c: to.c, piece: target } });
  return true;
}

function generatePseudoMoves(state, color) {
  const moves = [];
  const board = state.board;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      if (pieceColor(p) !== color) continue;
      const lower = p.toLowerCase();

      if (lower === "p") {
        const dir = color === "w" ? -1 : 1;
        const startRow = color === "w" ? 6 : 1;
        const promoRow = color === "w" ? 0 : 7;

        // forward one
        const r1 = r + dir;
        if (inBounds(r1, c) && !board[r1][c]) {
          if (r1 === promoRow) {
            for (const promo of ["Q", "R", "B", "N"]) {
              moves.push({
                from: { r, c },
                to: { r: r1, c },
                piece: p,
                promotion: { piece: color === "w" ? promo : promo.toLowerCase() },
              });
            }
          } else {
            moves.push({ from: { r, c }, to: { r: r1, c }, piece: p });
          }

          // forward two
          const r2 = r + 2 * dir;
          if (r === startRow && inBounds(r2, c) && !board[r2][c]) {
            moves.push({ from: { r, c }, to: { r: r2, c }, piece: p });
          }
        }

        // captures
        for (const dc of [-1, 1]) {
          const tr = r + dir;
          const tc = c + dc;
          if (!inBounds(tr, tc)) continue;

          const target = board[tr][tc];
          if (target && pieceColor(target) !== color) {
            if (tr === promoRow) {
              for (const promo of ["Q", "R", "B", "N"]) {
                moves.push({
                  from: { r, c },
                  to: { r: tr, c: tc },
                  piece: p,
                  capture: { r: tr, c: tc, piece: target },
                  promotion: { piece: color === "w" ? promo : promo.toLowerCase() },
                });
              }
            } else {
              moves.push({ from: { r, c }, to: { r: tr, c: tc }, piece: p, capture: { r: tr, c: tc, piece: target } });
            }
          }

          // en-passant
          if (state.enPassant && state.enPassant.r === tr && state.enPassant.c === tc) {
            // captured pawn is behind target square
            const capR = tr - dir;
            const capC = tc;
            const capPiece = board[capR][capC];
            if (capPiece && capPiece.toLowerCase() === "p" && pieceColor(capPiece) !== color) {
              moves.push({
                from: { r, c },
                to: { r: tr, c: tc },
                piece: p,
                enPassantCapture: { r: capR, c: capC },
              });
            }
          }
        }
      } else if (lower === "n") {
        const jumps = [
          [-2, -1], [-2, 1], [-1, -2], [-1, 2],
          [1, -2], [1, 2], [2, -1], [2, 1],
        ];
        for (const [dr, dc] of jumps) {
          const tr = r + dr, tc = c + dc;
          if (!inBounds(tr, tc)) continue;
          const target = board[tr][tc];
          if (!target) moves.push({ from: { r, c }, to: { r: tr, c: tc }, piece: p });
          else if (pieceColor(target) !== color) moves.push({ from: { r, c }, to: { r: tr, c: tc }, piece: p, capture: { r: tr, c: tc, piece: target } });
        }
      } else if (lower === "b" || lower === "r" || lower === "q") {
        const dirs = [];
        if (lower === "b" || lower === "q") dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
        if (lower === "r" || lower === "q") dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);

        for (const [dr, dc] of dirs) {
          let tr = r + dr, tc = c + dc;
          while (inBounds(tr, tc)) {
            const target = board[tr][tc];
            if (!target) {
              moves.push({ from: { r, c }, to: { r: tr, c: tc }, piece: p });
            } else {
              if (pieceColor(target) !== color) {
                moves.push({ from: { r, c }, to: { r: tr, c: tc }, piece: p, capture: { r: tr, c: tc, piece: target } });
              }
              break;
            }
            tr += dr; tc += dc;
          }
        }
      } else if (lower === "k") {
        const steps = [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
          [1, -1],  [1, 0],  [1, 1],
        ];
        for (const [dr, dc] of steps) {
          const tr = r + dr, tc = c + dc;
          if (!inBounds(tr, tc)) continue;
          const target = board[tr][tc];
          if (!target) moves.push({ from: { r, c }, to: { r: tr, c: tc }, piece: p });
          else if (pieceColor(target) !== color) moves.push({ from: { r, c }, to: { r: tr, c: tc }, piece: p, capture: { r: tr, c: tc, piece: target } });
        }

        // castling (basic legality includes king not in check + squares not attacked)
        const inCheckNow = isInCheck(state, color);
        if (!inCheckNow) {
          if (color === "w") {
            // king e1 => r=7,c=4
            if (state.castling.wK) {
              // squares f1,g1 empty; rook h1
              if (!board[7][5] && !board[7][6] && board[7][7] === "R") {
                if (!isSquareAttacked(board, 7, 5, "b") && !isSquareAttacked(board, 7, 6, "b")) {
                  moves.push({ from: { r, c }, to: { r: 7, c: 6 }, piece: p, castling: "K" });
                }
              }
            }
            if (state.castling.wQ) {
              if (!board[7][1] && !board[7][2] && !board[7][3] && board[7][0] === "R") {
                if (!isSquareAttacked(board, 7, 3, "b") && !isSquareAttacked(board, 7, 2, "b")) {
                  moves.push({ from: { r, c }, to: { r: 7, c: 2 }, piece: p, castling: "Q" });
                }
              }
            }
          } else {
            // black
            if (state.castling.bK) {
              if (!board[0][5] && !board[0][6] && board[0][7] === "r") {
                if (!isSquareAttacked(board, 0, 5, "w") && !isSquareAttacked(board, 0, 6, "w")) {
                  moves.push({ from: { r, c }, to: { r: 0, c: 6 }, piece: p, castling: "K" });
                }
              }
            }
            if (state.castling.bQ) {
              if (!board[0][1] && !board[0][2] && !board[0][3] && board[0][0] === "r") {
                if (!isSquareAttacked(board, 0, 3, "w") && !isSquareAttacked(board, 0, 2, "w")) {
                  moves.push({ from: { r, c }, to: { r: 0, c: 2 }, piece: p, castling: "Q" });
                }
              }
            }
          }
        }
      }
    }
  }

  return moves;
}

function generateLegalMoves(state, color) {
  const pseudo = generatePseudoMoves(state, color);
  const legal = [];

  for (const mv of pseudo) {
    const next = makeMove(state, mv);
    // after makeMove, next.turn is opposite(state.turn)
    // legality: own king must not be in check
    if (!isInCheck(next, color)) legal.push(mv);
  }
  return legal;
}

function gameOver(state) {
  // returns {over:boolean, result:"w"|"b"|"draw"|null}
  const legal = generateLegalMoves(state, state.turn);
  if (legal.length > 0) return { over: false, result: null };

  // no legal moves
  const inCheck = isInCheck(state, state.turn);
  if (inCheck) {
    return { over: true, result: opposite(state.turn) }; // side that is not in check wins
  }
  return { over: true, result: "draw" };
}

// ---- Minimax with legality ----
function evaluateMaterial(board) {
  const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const lower = p.toLowerCase();
      const v = VALUES[lower] || 0;
      score += (p === p.toUpperCase()) ? v : -v;
    }
  }
  return score;
}

function minimax(state, depth, alpha, beta, maximizingColor) {
  const over = gameOver(state);
  if (over.over) {
    if (over.result === "draw") return { move: null, score: 0 };
    // result is winner color
    return { move: null, score: over.result === maximizingColor ? 1e9 : -1e9 };
  }

  if (depth === 0) {
    return { move: null, score: evaluateMaterial(state.board) };
  }

  const legalMoves = generateLegalMoves(state, state.turn);
  if (legalMoves.length === 0) {
    // handled by gameOver, but keep safe
    return { move: null, score: evaluateMaterial(state.board) };
  }

  const maximizing = state.turn === maximizingColor;

  let bestMove = null;
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const mv of legalMoves) {
    const child = makeMove(state, mv);
    const res = minimax(child, depth - 1, alpha, beta, maximizingColor);
    const s = res.score;

    if (maximizing) {
      if (s > bestScore) {
        bestScore = s;
        bestMove = mv;
      }
      alpha = Math.max(alpha, bestScore);
      if (beta <= alpha) break;
    } else {
      if (s < bestScore) {
        bestScore = s;
        bestMove = mv;
      }
      beta = Math.min(beta, bestScore);
      if (beta <= alpha) break;
    }
  }

  return { move: bestMove, score: bestScore };
}

// ---- UI move handling + promotion UI ----
const COMPUTER_COLOR = "b"; // computer plays black
const PLAYER_COLOR = "w";   // human plays white (other side)
const DEFAULT_DEPTH = 2;

let state = initialState();
state.turn = PLAYER_COLOR;

// promotion picker overlay
let promotionPending = null; // { from,to, color, moves } where moves are promotion variants
function ensurePromotionUI() {
  let el = document.getElementById("promotion-overlay");
  if (el) return el;

  el = document.createElement("div");
  el.id = "promotion-overlay";
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.background = "rgba(0,0,0,0.35)";
  el.style.display = "none";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.zIndex = "999";
  el.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:16px;min-width:240px;">
      <div style="font-weight:700;margin-bottom:12px;">Choose promotion</div>
      <div id="promotion-buttons" style="display:flex;gap:10px;justify-content:space-between;">
        <button data-piece="Q" style="font-size:28px;padding:10px 12px;">♕</button>
        <button data-piece="R" style="font-size:28px;padding:10px 12px;">♖</button>
        <button data-piece="B" style="font-size:28px;padding:10px 12px;">♗</button>
        <button data-piece="N" style="font-size:28px;padding:10px 12px;">♘</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-piece]");
    if (!btn) return;
    if (!promotionPending) return;

    const choice = btn.getAttribute("data-piece"); // Q/R/B/N
    const promoPiece = state.turn === "w" ? choice : choice.toLowerCase();

    const moves = promotionPending.moves;
    const chosenMove = moves.find(m => m.promotion && m.promotion.piece === promoPiece);
    if (!chosenMove) return;

    promotionPending = null;
    el.style.display = "none";

    state = makeMove(state, chosenMove);
    applyBoardToDOM(state);
    clearSelection();

    // computer turn
    if (state.turn === COMPUTER_COLOR) {
      setTimeout(() => computerTurn(), 50);
    }
  });

  return el;
}

function openPromotionUI(pendingMoves) {
  promotionPending = pendingMoves; // store directly for simplicity
  const el = ensurePromotionUI();
  el.style.display = "flex";

  // update buttons to match side
  const isWhite = state.turn === "w";
  const map = isWhite
    ? { Q: "♕", R: "♖", B: "♗", N: "♘" }
    : { Q: "♛", R: "♜", B: "♝", N: "♞" };

  const buttons = el.querySelectorAll("button[data-piece]");
  buttons.forEach(b => {
    const piece = b.getAttribute("data-piece");
    b.textContent = map[piece] || b.textContent;
  });
}

function computerTurn() {
  if (state.turn !== COMPUTER_COLOR) return;

  const over = gameOver(state);
  if (over.over) return;

  const depth = DEFAULT_DEPTH;
  const res = minimax(state, depth, -Infinity, Infinity, COMPUTER_COLOR);
  if (!res.move) return;

  // if move is promotion with multiple choices, we already have one in move
  state = makeMove(state, res.move);
  applyBoardToDOM(state);
  clearSelection();
}

function coordFromSquare(square) {
  const idx = Array.from(squares).indexOf(square);
  const { r, c } = idxToRC(idx);
  return { r, c };
}

function legalMovesForSquare(from) {
  const legal = generateLegalMoves(state, PLAYER_COLOR);
  return legal.filter(m => m.from.r === from.r && m.from.c === from.c);
}

// Highlight legal destinations for selected piece (minimal)
function highlightMoves(moves) {
  const dests = new Map();
  for (const mv of moves) dests.set(`${mv.to.r},${mv.to.c}`, mv);
  squares.forEach(sq => {
    sq.style.outline = "none";
  });

  for (const mv of moves) {
    const idx = rcToIdx(mv.to.r, mv.to.c);
    squares[idx].style.outline = "3px solid rgba(0, 150, 255, 0.6)";
  }
}

function clearHighlights() {
  squares.forEach(sq => (sq.style.outline = "none"));
}

// ---- UI events ----
squares.forEach(square => {
  square.addEventListener("click", () => {
    // if promotion UI is open, ignore clicks
    const overlay = document.getElementById("promotion-overlay");
    if (overlay && overlay.style.display !== "none") return;

    // handle only on human turn
    if (state.turn !== PLAYER_COLOR) return;

    const { r, c } = coordFromSquare(square);
    const p = state.board[r][c];

    if (selectedSquare === null) {
      if (!p) return;
      if (pieceColor(p) !== PLAYER_COLOR) return;

      selectedSquare = square;
      selectedSquare.style.border = "3px solid red";

      const from = { r, c };
      const moves = legalMovesForSquare(from);
      highlightMoves(moves);
      return;
    }

    // clicked same square => unselect
    if (square === selectedSquare) {
      clearSelection();
      clearHighlights();
      return;
    }

    // attempt move: selectedSquare -> clicked square
    const from = coordFromSquare(selectedSquare);
    const moves = legalMovesForSquare(from);

    const chosen = moves.find(m => m.to.r === r && m.to.c === c);
    if (!chosen) {
      // if clicked another own piece, re-select
      if (p && pieceColor(p) === PLAYER_COLOR) {
        clearSelection();
        clearHighlights();
        selectedSquare = square;
        selectedSquare.style.border = "3px solid red";
        const newMoves = legalMovesForSquare({ r, c });
        highlightMoves(newMoves);
      }
      return;
    }

    // promotion requires UI choice
    if (chosen.promotion) {
      const allPromotions = moves.filter(m => m.promotion && m.to.r === chosen.to.r && m.to.c === chosen.to.c);
      if (allPromotions.length > 1) {
        // store pending moves and open UI
        promotionPending = allPromotions;
        // switch state.turn doesn't happen until actual move; promotion UI assumes it is still player's turn.
        openPromotionUI(allPromotions);
        return;
      }
    }

    // apply move
    state = makeMove(state, chosen);
    applyBoardToDOM(state);
    clearSelection();
    clearHighlights();

    const over = gameOver(state);
    if (over.over) return;

    // computer move
    if (state.turn === COMPUTER_COLOR) {
      setTimeout(() => computerTurn(), 50);
    }
  });
});

// initial paint
applyBoardToDOM(state);

