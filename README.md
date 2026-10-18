# Lucky Arcade VIP — Telegram Mini App with backend

A black-and-gold Telegram Mini App demo with verified Telegram login, persistent profiles, server-side virtual rewards, daily bonus and a shared leaderboard.

## Included
- VIP black-and-gold responsive interface
- Telegram Web App identity verified server-side with Telegram's HMAC validation
- SQLite database for accounts, points, personal record, round history and daily bonus claim
- Server-generated rewards (the client cannot choose the reward amount)
- Shared top-20 leaderboard
- Free virtual points only; no deposits, cash wagering, purchases, or withdrawals

## Requirements
- Node.js 20+
- Telegram bot created through @BotFather
- HTTPS hosting for Telegram Web Apps in production

## Run locally
1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Put your bot token in `TELEGRAM_BOT_TOKEN`.
4. Run `npm install`, then `npm start`.
5. Open `http://localhost:3000` in a browser. For Telegram login, the deployed page must be opened as a Telegram Mini App and served over HTTPS.

### Local demo mode
For a local UI smoke test only, set `DEV_MODE=true`, run `npm start`, and send `x-demo-user: local-test` from a test client. This mode bypasses Telegram authentication and must never be enabled in production. The UI itself will use Telegram initData when available.

## Deploy
Deploy the project to a Node-capable HTTPS host (for example, a VPS or a Node web service). Set `TELEGRAM_BOT_TOKEN` as a server-side environment variable and `DEV_MODE=false`. Persistent storage is required for SQLite; on ephemeral hosts use a persistent volume and set `DB_PATH` to that volume. Do not expose the bot token to browser code.

In @BotFather, configure the bot's Mini App / Web App URL to your HTTPS deployment URL.

## Important implementation notes
- This is a starter project, not deployed automatically. You must configure the bot and hosting.
- SQLite is suitable for a small prototype. For larger production traffic, use PostgreSQL, migrations, rate limits, backups and monitoring.
- Add rate limiting and operational monitoring before public release. Telegram initData is checked for signature and freshness; do not trust identity values supplied by the browser.
- Daily bonus resets by UTC calendar date.
