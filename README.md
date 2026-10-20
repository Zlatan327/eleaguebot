# eLeagueBot: eFootball League Manager WhatsApp Bot ⚽🤖

A resilient WhatsApp bot engineered for managing competitive eFootball leagues directly from your WhatsApp group: standings, round-robin fixtures, score submission, deadlines, and **safe mid-season late player additions** without breaking existing matches or the table.

---

## 🌟 Key Features

1. **Deterministic Standings Table:** Standings calculated on-the-fly with standard football tiebreakers (*Points > Goal Difference > Goals For > Head-to-Head > Total Wins*).
2. **Safe Mid-Season Late-Joiner Integration:**
   - Adds a player mid-season (`!addlateplayer Name`).
   - Automatically generates matches **only** against existing active players.
   - Slots matches fairly into remaining weeks with realistic deadlines.
   - Leaves every previously played or scheduled match 100% untouched.
3. **Flexible Result Entry:**
   - Manual text format: `!result PlayerA 3-1 PlayerB` or `!result 5 3-1`.
   - Reply to any fixture message with `3-1`.
   - Result editing & reverting: `!editresult` and `!revertresult` for instant typo recovery.
   - Forfeits: `!forfeit <match_id> <winner>` records standard 3-0 walkover wins.
4. **Google AI Studio Screenshot Reading (Vision AI):**
   - Supports Google AI Studio API keys (`GEMINI_API_KEY`).
   - Members can simply send a photo or screenshot of the post-match eFootball stats screen with caption `!result`.
   - Automatically extracts team/player names and score using Gemini multimodal vision.
5. **Admin Access Control & Group Locking:**
   - Lock the bot to a designated league group via `!setgroup`.
   - Admin-only commands for player management, fixture generation, deadlines, and overrides.
6. **Dual Mode:**
   - **WhatsApp Web Mode:** Persistent browser session (`LocalAuth`) with QR code terminal login.
   - **Interactive CLI Test Harness:** Test every command and scenario locally in terminal without a phone (`npm run cli`).

---

## 🚀 Quick Start

### 1. Requirements
- Node.js 18+ (tested on Node.js 24)
- Git (optional)
- WhatsApp account (secondary number recommended for dedicated bot hosting)

### 2. Installation
```bash
# Clone or navigate to the project directory
cd "efootball bot"

# Dependencies are already installed or run:
npm install
```

### 3. Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Key configuration settings:
- `DEFAULT_DEADLINE_DAYS=3`: Match deadline duration in days.
- `INITIAL_ADMIN_PHONE=1234567890`: Your WhatsApp phone number (auto-registers as Super Admin).
- `SUBMISSION_POLICY=players_or_admin`: Either match players or admins can submit results (`admin_only` for strict control).
- `GEMINI_API_KEY=`: (Optional) Paste your API key from [Google AI Studio](https://aistudio.google.com/) for screenshot OCR.

---

## 📸 Using Google AI Studio for Image Reading

You can use a free API key from **Google AI Studio** to let members submit match screenshots:
1. Go to [Google AI Studio](https://aistudio.google.com/) and click **Get API Key**.
2. Copy your key and add it to `.env`:
   ```env
   GEMINI_API_KEY=your_google_ai_studio_api_key_here
   GEMINI_VISION_MODEL=gemini-2.5-flash
   ```
3. Whenever a player sends a screenshot of the post-match screen into the WhatsApp group with caption `!result`, the bot reads the image and records the score automatically!

---

## 💻 Running the Bot

### Production WhatsApp Mode
```bash
npm start
```
1. A QR code will display in your terminal.
2. Open WhatsApp on your phone $\to$ **Linked Devices** $\to$ **Link a Device**.
3. Scan the terminal QR code.
4. Session is saved in `.wwebjs_auth` so you only scan once!

### Interactive CLI Test Mode (No Phone Needed)
```bash
npm run cli
```
Launches an interactive terminal session where you can type bot commands and test full league workflows instantly:
```text
eLeagueBot> !addplayer Messi
[WhatsApp Bot Reply]:
✅ Player Messi added to the league.

eLeagueBot> !addplayer Ronaldo
[WhatsApp Bot Reply]:
✅ Player Ronaldo added to the league.

eLeagueBot> !generatefixtures
[WhatsApp Bot Reply]:
✅ Fixtures Generated Successfully!
• Total Fixtures: 1
• Total Weeks: 1
• Rounds: 1 (Single)

eLeagueBot> !result Messi 3-1 Ronaldo
[WhatsApp Bot Reply]:
✅ Match Result Recorded!
Match: [#1] Week 1
Score: Messi 3 - 1 Ronaldo
```

### Running Automated Test Suites
```bash
npm test
```
Runs both unit test suites (`league.test.js` and `latePlayer.test.js`) verifying tie-breakers, late player integration, forfeits, and result reversions.

---

## 📖 Command Reference

### Public Commands
| Command | Syntax | Description |
| :--- | :--- | :--- |
| `!table` / `!standings` | `!table` | Display mobile-optimized league standings table |
| `!fixtures` | `!fixtures [week]` | View fixtures for current week or all weeks |
| `!myfixtures` | `!myfixtures [player]` | View upcoming matches & deadlines for a player |
| `!result` | `!result <id> <score>`<br>`!result <P1> <score> <P2>` | Record score (or reply to a fixture with `3-1`) |
| `!rules` / `!help` | `!help` | Show commands guide |

### Admin Commands
| Command | Syntax | Description |
| :--- | :--- | :--- |
| `!addplayer` | `!addplayer <name> [@phone]` | Register a player before season kickoff |
| `!addlateplayer` | `!addlateplayer <name> [@phone]` | Safely slot a mid-season joiner into remaining weeks |
| `!generatefixtures` | `!generatefixtures [rounds]` | Generate round-robin tournament schedule (1 or 2 rounds) |
| `!setdeadline` | `!setdeadline <days>` | Set default match deadline duration |
| `!extenddeadline` | `!extenddeadline <id> <days>`| Extend deadline for postponed fixture |
| `!forfeit` | `!forfeit <id> <winner>` | Award 3-0 walkover win to the winner |
| `!editresult` | `!editresult <id> <score>` | Correct an erroneously recorded score |
| `!revertresult` | `!revertresult <id>` | Revert played match back to pending |
| `!setweek` | `!setweek <number>` | Advance or set active league week |
| `!setgroup` | `!setgroup` | Lock bot to current WhatsApp group |
| `!addadmin` | `!addadmin <phone>` | Register a league admin |
| `!admins` | `!admins` | List registered league administrators |
| `!removeplayer` | `!removeplayer <name>` | Deactivate a player |

### 📥 Ongoing League Onboarding Commands
| Command | Syntax | Description |
| :--- | :--- | :--- |
| `!importtable` | `!importtable` (multiline) | Bulk import existing standings: `<Name> <P> <W> <D> <L> <GF> <GA> [PTS]` |
| `!setbaseline` | `!setbaseline <name> <P> <W> <D> <L> <GF> <GA> [PTS]` | Set baseline historical stats for an individual player |
| `!backfill` | `!backfill <week> <Home> <Score> <Away>` | Record an already-played match from prior weeks |
| `!importfixtures` | `!importfixtures <week>` (multiline) | Import custom fixture matchups for upcoming weeks |
| `!claimadmin` | `!claimadmin <token>` | Securely authenticate as admin using setup token |
| `!linkplayer` | `!linkplayer <name> <phone>` | Bind WhatsApp phone number to player name |
| `!claimplayer` | `!claimplayer <name>` | Self-bind WhatsApp account to player profile |

---

## 🗄️ Architecture & Folder Structure

```
efootball bot/
├── src/
│   ├── index.js                  # Main entry point (CLI vs WhatsApp switch)
│   ├── config.js                 # Environment & defaults configuration
│   ├── database/
│   │   ├── db.js                 # SQLite database & transaction helper
│   │   ├── schema.sql            # Table definitions & indexes
│   │   └── repositories/
│   │       ├── playerRepo.js     # Player CRUD
│   │       ├── fixtureRepo.js    # Fixture queries & mutations
│   │       ├── settingsRepo.js   # Settings KV store
│   │       └── adminRepo.js      # Admin permission manager
│   ├── services/
│   │   ├── leagueService.js      # Deterministic standings & result logic
│   │   ├── fixtureGenerator.js   # Berger round-robin & late-joiner engine
│   │   ├── deadlineService.js    # Deadline calculations & overdue tracking
│   │   ├── messageFormatter.js   # Monospace mobile table formatters
│   │   └── visionService.js      # Google AI Studio Gemini vision integration
│   ├── handlers/
│   │   ├── commandHandler.js     # Command routing & authorization guard
│   │   └── parser.js             # Robust tokenizer & score extractor
│   └── whatsapp/
│       ├── client.js             # whatsapp-web.js client with LocalAuth & media
│       └── mockClient.js         # Interactive CLI REPL for zero-phone testing
├── tests/
│   ├── league.test.js            # Core league unit & integration tests
│   └── latePlayer.test.js        # Stress tests for late player slotting
├── .env                          # Local environment configuration
├── .env.example                  # Template configuration
└── package.json                  # Node dependencies & npm scripts
```
