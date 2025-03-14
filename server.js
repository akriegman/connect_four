const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database('connect_four.db');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone_number TEXT
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    board_state TEXT NOT NULL,
    current_turn TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'connect-four-aaron-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    expires: null,
    path: '/',
    httpOnly: true
  }
}));

// Helper functions
function getCurrentGame(userId, autoCreate = false) {
  console.log('Getting current game for user:', userId);
  let game = db.prepare("SELECT * FROM games WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(userId);
  
  if (!game && autoCreate) {
    createNewGame(userId);
    game = db.prepare("SELECT * FROM games WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(userId);
  }
  
  if (game) {
    game.board = JSON.parse(game.board_state);
  }
  return game;
}

function createNewGame(userId) {
  const emptyBoard = Array(6).fill().map(() => Array(7).fill(null));
  
  db.prepare(`
    INSERT INTO games (user_id, board_state, current_turn, status)
    VALUES (?, ?, ?, ?)
  `).run(userId, JSON.stringify(emptyBoard), 'user', 'active');
}

const clients = new Map();

// Helper function to setup SSE response headers
function setupSSEConnection(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders(); // Flush the headers to establish SSE connection
}

// Helper function to send SSE update
function sendGameUpdate(userId, game) {
  if (clients.has(userId)) {
    const res = clients.get(userId);
    res.write(`data: ${JSON.stringify(game)}\n\n`);
  }
}

function makeMove(game, column, player, callback) {
  column = parseInt(column);
  
  if (isNaN(column) || column < 0 || column > 6) {
    return callback(null, { success: false, message: 'Invalid column' });
  }
  
  const board = JSON.parse(game.board_state);
  
  // Find the first empty cell in the column (from bottom to top)
  let row = -1;
  for (let r = 5; r >= 0; r--) {
    if (!board[r][column]) {
      row = r;
      break;
    }
  }
  
  if (row === -1) {
    return callback(null, { success: false, message: 'Column is full' });
  }
  
  // Make the move
  board[row][column] = player;
  
  // Check for win
  const hasWon = checkWin(board, row, column, player);
  
  // Check for draw
  const isDraw = board.every(row => row.every(cell => cell !== null));
  
  // Update game state
  let status = 'active';
  let nextTurn = player === 'user' ? 'aaron' : 'user';
  
  if (hasWon) {
    status = player === 'user' ? 'user_won' : 'aaron_won';
    nextTurn = player;  // Winner's turn stays set to indicate who won
  } else if (isDraw) {
    status = 'draw';
    // Keep current turn as is for draw
  }
  
  try {
    // Update game in database
    const stmt = db.prepare(
      'UPDATE games SET board_state = ?, current_turn = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    stmt.run(JSON.stringify(board), nextTurn, status, game.id);
    
    // Get updated game state
    const updatedGame = db.prepare('SELECT * FROM games WHERE id = ?').get(game.id);
    updatedGame.board = JSON.parse(updatedGame.board_state);
    
    // Send updates to both players
    if (player === 'user') {
      sendGameUpdate(game.user_id, updatedGame);
      const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get('aaron')?.id;
      if (adminId) {
        sendGameUpdate(adminId, updatedGame);
      }
    } else {
      const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get('aaron')?.id;
      if (adminId) {
        sendGameUpdate(adminId, updatedGame);
      }
      sendGameUpdate(game.user_id, updatedGame);
    }
    
    callback(null, { success: true });
  } catch (error) {
    callback(error);
  }
}

function checkWin(board, row, col, player) {
  // Check horizontal
  for (let c = 0; c <= 3; c++) {
    if (col - c >= 0 && col - c + 3 < 7) {
      if (board[row][col-c] === player && 
          board[row][col-c+1] === player && 
          board[row][col-c+2] === player && 
          board[row][col-c+3] === player) {
        return true;
      }
    }
  }
  
  // Check vertical
  for (let r = 0; r <= 3; r++) {
    if (row - r >= 0 && row - r + 3 < 6) {
      if (board[row-r][col] === player && 
          board[row-r+1][col] === player && 
          board[row-r+2][col] === player && 
          board[row-r+3][col] === player) {
        return true;
      }
    }
  }
  
  // Check diagonal (down-right)
  for (let i = 0; i <= 3; i++) {
    if (row - i >= 0 && row - i + 3 < 6 && col - i >= 0 && col - i + 3 < 7) {
      if (board[row-i][col-i] === player && 
          board[row-i+1][col-i+1] === player && 
          board[row-i+2][col-i+2] === player && 
          board[row-i+3][col-i+3] === player) {
        return true;
      }
    }
  }
  
  // Check diagonal (up-right)
  for (let i = 0; i <= 3; i++) {
    if (row + i < 6 && row + i - 3 >= 0 && col - i >= 0 && col - i + 3 < 7) {
      if (board[row+i][col-i] === player && 
          board[row+i-1][col-i+1] === player && 
          board[row+i-2][col-i+2] === player && 
          board[row+i-3][col-i+3] === player) {
        return true;
      }
    }
  }
  
  return false;
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  
  if (user) {
    if (user.password === password) {
      req.session.userId = user.id;
      req.session.username = user.username;
      return res.json({ success: true });
    } else {
      return res.status(401).json({ error: 'Invalid password or username already taken' });
    }
  } else {
    try {
      const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, password);
      req.session.userId = result.lastInsertRowid;
      req.session.username = username;
      if (username !== 'aaron') {  // Only create a new game if not Aaron
        createNewGame(result.lastInsertRowid);
      }
      return res.json({ success: true, newUser: true });
    } catch (error) {
      // This will catch any database constraint errors (like unique constraint violations)
      return res.status(400).json({ error: error.message });
    }
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/game/state', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const game = getCurrentGame(req.session.userId, true);  // Auto-create only when explicitly getting game state
  const user = db.prepare('SELECT phone_number FROM users WHERE id = ?').get(req.session.userId);
  
  if (game) {
    game.phone_number = user.phone_number;
  }
  
  res.json(game);
});

app.post('/game/move', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { column } = req.body;
  const game = getCurrentGame(req.session.userId, false);  // Don't auto-create during moves
  
  if (game.current_turn !== 'user') {
    return res.status(400).json({ error: "It's not your turn" });
  }
  
  if (game.status !== 'active') {
    return res.status(400).json({ error: 'Game is already finished' });
  }
  
  const result = makeMove(game, column, 'user', (err, result) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    
    res.json({ success: true, game: getCurrentGame(req.session.userId) });
  });
});

app.get('/game/updates', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // For regular users, get/create their game
  const game = getCurrentGame(req.session.userId, req.session.username !== 'aaron');  // Only auto-create if not Aaron
  
  setupSSEConnection(res);
  clients.set(req.session.userId, res);
  
  // Send initial game state
  if (game) {
    res.write(`data: ${JSON.stringify(game)}\n\n`);
  }
});

app.post('/user/phone', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { phoneNumber } = req.body;
  db.prepare('UPDATE users SET phone_number = ? WHERE id = ?').run(phoneNumber, req.session.userId);
  
  // Retrieve updated user information
  const updatedUser = db.prepare('SELECT id, username, phone_number FROM users WHERE id = ?').get(req.session.userId);
  
  // Send SSE update to admin
  const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get('aaron')?.id;
  if (adminId) {
    sendGameUpdate(adminId, { user: updatedUser });
  }
  
  res.json({ success: true });
});

app.get('/admin/games', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  
  if (user.username !== 'aaron') {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const games = db.prepare(`
    SELECT g.*, u.username, u.phone_number 
    FROM games g 
    JOIN users u ON g.user_id = u.id 
    ORDER BY 
      CASE g.status 
        WHEN 'active' THEN 0 
        ELSE 1 
      END,
      g.updated_at DESC
  `).all();
  
  res.json(games);
});

app.post('/admin/move', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  
  if (user.username !== 'aaron') {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const { gameId, column } = req.body;
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (game.current_turn !== 'aaron') {
    return res.status(400).json({ error: "It's not your turn" });
  }
  
  if (game.status !== 'active') {
    return res.status(400).json({ error: 'Game is already finished' });
  }
  
  const result = makeMove(game, column, 'aaron', (err, result) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    
    res.json({ success: true });
  });
});

app.post('/game/new', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  createNewGame(req.session.userId);
  const game = getCurrentGame(req.session.userId);
  
  res.json({ success: true, game });
});

// Update resign endpoint to set proper state
app.post('/game/resign', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const game = getCurrentGame(req.session.userId);
  
  if (game.status !== 'active') {
    return res.status(400).json({ error: 'Game is already finished' });
  }
  
  // Update game status - on resign, it's Aaron's win and Aaron's turn
  db.prepare('UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('aaron_won', game.id);
  
  // Get the same game with updated state
  const updatedGame = db.prepare('SELECT * FROM games WHERE id = ?').get(game.id);
  updatedGame.board = JSON.parse(updatedGame.board_state);
  
  // Notify both players
  sendGameUpdate(req.session.userId, updatedGame);
  
  const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get('aaron')?.id;
  if (adminId) {
    sendGameUpdate(adminId, updatedGame);
  }
  
  res.json({ success: true });
});

// Add this endpoint to get current user info
app.get('/auth/user', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT id, username, phone_number FROM users WHERE id = ?').get(req.session.userId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json(user);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 