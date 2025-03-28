# Connect Four with Aaron - Project Guidelines (Copied from .cursorrules)

This web application allows users to play Connect Four against Aaron Kriegman. The unique twist is that Aaron is the only opponent available to all users.

## System Overview

The application consists of:

1. **Combined User/Admin Interface**: A single page application that shows either the user interface or admin interface based on the username
   - Regular users see their game board and can make moves when it's their turn
   - Aaron sees all active games and can respond to any user's moves

2. **Backend**: Handles game logic, authentication, and real-time updates

## Key Features

- User authentication (username/password) with persistent sessions
- Real-time game updates via Server-Sent Events (SSE)
- Game state persistence in SQLite database
- Optional phone number storage for manual notifications (auto-saves on change)
- Game completion detection and restart functionality
- Ability for users to resign games
- Admin dashboard for Aaron to manage all active games

## Technical Stack

- **Frontend**: HTML, CSS, JavaScript (Single page application)
- **Backend**: Node.js/Express
- **Database**: SQLite with better-sqlite3
- **Hosting**: fly.io
- **Real-time Updates**: Server-Sent Events (SSE)
- **Session Management**: express-session with persistent cookies

## Authentication

The system uses a simple username/password authentication with persistent sessions. Passwords are stored in plaintext - this is an intentional design choice communicated to users via a warning message. Sessions persist until the user explicitly logs out.

## Notifications

The system stores phone numbers but does not automatically send notifications. Aaron can manually text users when it's their turn. Phone numbers are automatically saved when changed, with subtle feedback to the user.

## Data Model

Users:
- id (primary key)
- username (unique)
- password (stored in plaintext)
- phone_number (optional)

Games:
- id (primary key)
- user_id (foreign key)
- board_state (JSON string)
- current_turn ("user" or "aaron")
- status ("active", "user_won", "aaron_won", "draw")
- created_at
- updated_at

## API Endpoints

- `POST /auth/login` - Login or create account
- `GET /auth/user` - Get current user info
- `GET /game/state` - Get current game state
- `POST /game/move` - Make a move
- `POST /game/resign` - Resign current game
- `POST /game/new` - Start a new game
- `GET /game/updates` - SSE endpoint for real-time updates
- `POST /user/phone` - Update phone number
- `GET /admin/games` - Get all active games (Aaron only)
- `POST /admin/move` - Make a move as Aaron (Aaron only)

## Implementation Notes

- The system uses a single HTML page that shows different interfaces based on the logged-in user
- Real-time updates are implemented using Server-Sent Events
- The board is represented as a 2D array with 6 rows and 7 columns
- Game state is persisted in the database, allowing users to return to their games
- Users can resign games and start new games after completion
- The admin interface auto-refreshes every 30 seconds
- All fetch requests include credentials for session management
- Phone numbers auto-save with subtle feedback
- Status messages use color-coded text without backgrounds

## Known Issues/Limitations

- Better-sqlite3 requires Node.js v18
- The application doesn't implement automatic notifications