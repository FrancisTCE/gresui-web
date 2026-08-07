# GRESUI — A fast, friendly PostgreSQL client in your browser

[![npm version](https://img.shields.io/npm/v/gresui-web)](https://www.npmjs.com/package/gresui-web)

gresui is a web app for browsing PostgreSQL databases, built with Bun and
React. Tbh there was ai coding in this, code was reviewed. I did this because I found
that I had a necessity for a simpler and good looking postgres client without all the
visual clutter pgadmin gives. feel free to do what you want with this. I decided to share
this because it ended up being useful for me, hopefully also for you.

![GRESUI](https://i.imgur.com/vxNY9AX.png)
![GRESUI](https://i.imgur.com/ethkeZh.png)
![GRESUI](https://i.imgur.com/3RGv4EU.png)

## Install

```sh
npm install -g gresui-web
```

Then run:

```sh
gresui-web
```

This starts a small local backend (it brings its own Bun runtime — nothing
extra to install) and opens the app in your default browser. Everything runs
locally on your machine; the backend is only reachable on `127.0.0.1`.
Requires Node.js 22+.

## Features

- Connection management with save/delete
- Schema and table browser sidebar
- Data grid with filtering, sorting, and pagination
- SQL editor with syntax highlighting and history
- EXPLAIN support
- Full CRUD operations (insert, update, delete)
- Dark and light themes
- **MCP server** — exposes the connected database to AI clients (Claude
  Desktop, Cursor, …) with per-key tool scopes and table allowlists

## Prerequisites

- [Node.js](https://nodejs.org) 22+
- [Bun](https://bun.sh) 1.3.x — for `npm run dev` (the published CLI bundles
  its own Bun runtime, so end users don't need it)
- [Docker](https://www.docker.com) (optional, for a local test database)

## Quick start (dev mode)

```sh
# 1. Install dependencies
npm install

# 2. Build the React frontend once
npm run build

# 3. Start the backend (serves the built frontend)
npm run dev
```

## Configuration & data storage

All config — connections, settings, SQL history — lives in a single SQLite
database (`gresui.db`) in the config directory:

| OS      | Location                                             |
|---------|------------------------------------------------------|
| Linux   | `$XDG_CONFIG_HOME/gresui` or `~/.config/gresui`       |
| macOS   | `~/Library/Application Support/gresui`                |
| Windows | `%APPDATA%\gresui`                                   |

`GRESUI_CONFIG_DIR` overrides the location (used by tests; also handy for
portable setups). The directory is created mode `0700` and `gresui.db` mode
`0600`. Pre-SQLite `connections.json` / `settings.json` / `history.json`
files are imported once on first launch, then removed.

## Security

Connection passwords are encrypted at rest with AES-256-GCM under a per-machine
random key, decrypted only in-process when the app reads them.

- **Key storage**: the key lives in the OS keychain where available — macOS
  Keychain, Linux Secret Service (GNOME/KDE keyring) — otherwise in a `0600`
  `gresui.key` file in the config directory (headless Linux, Windows v1).
- **Keychain migration**: existing file-key installs move the key into the
  keychain automatically on the next launch with a keychain present; the file
  is then removed, so config-dir backups stop carrying the key.
- **Key loss**: if the key can't be found (keychain entry deleted, config dir
  wiped), stored passwords read as empty — reconnect and re-enter them; the
  next save re-encrypts.
- **Troubleshooting**: `GRESUI_KEY_SOURCE=file|keychain|auto` forces a
  provider (useful on headless machines or to re-run keychain migration).

What this protects against: exposure of the database file alone (backups, sync
tools, file indexing, casual reads). It does not defend against full compromise
of the running app or, on Linux, same-user processes — the Secret Service
answers the same user without prompting.

## MCP (Model Context Protocol)

Adds an MCP service layer to the tables you choose — it's fancy.

gresui ships a built-in MCP server that exposes the database you're connected
to as read-only tools for AI clients (Claude Desktop, Cursor, any MCP client).
No separate server to install, nothing to configure by hand: open the app,
connect to your database, hit the **MCP** button in the top bar, enable the
server, and create an API key.

### What you get

| Tool             | What it does                                        |
|------------------|-----------------------------------------------------|
| `list_schemas`   | All non-system schemas in the connected database    |
| `list_tables`    | Tables/views in a schema (respects the key's table allowlist) |
| `get_table`      | Columns, primary keys, row estimate for a table     |
| `get_rows`       | Fetch rows with optional `where` (raw SQL), `orderBy`, `limit`, `offset` |
| `row_count`      | Exact row count, optionally filtered                |
| `list_indexes`   | Indexes on a table with their definitions           |
| `get_status`     | Connection status (never throws)                    |

Every key is a **bearer API key** that can be scoped to a subset of the tools
and optionally restricted to specific `schema.table` names — so you can hand
Claude exactly the tables you want it to query directly and nothing else.
Tools are read-only by construction: there is no `run_sql`. Two honest
caveats: the table allowlist gates *direct* table access (a restricted key
can still read other tables the connected DB user can read via `where`
subqueries), and `get_rows`/`row_count` take raw SQL in `where` — same trust
level as the filter bar. Give keys only to clients you trust with the
connected user's database, and connect with a least-privileged DB user if you
need real isolation. The tools run against the app's active connection, so
disconnect and they answer "Not connected" until you reconnect.

### Setup

1. Launch gresui and connect to your database.
2. Click **MCP** in the top bar (left of "Open SQL"), then **Enable**.
3. **New Key** — name it, pick tool scopes (or "Select all"), optionally
   restrict tables, and copy the generated key (shown once).
4. Add the copied config to your MCP client. Claude Desktop example
   (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gresui": {
      "url": "http://127.0.0.1:3939/mcp",
      "headers": { "Authorization": "Bearer <KEY>" }
    }
  }
}
```

The server listens on `127.0.0.1:3939` (loopback only — never exposed to the
network); if the port is taken it falls back to a random port, and the URL
shown in the MCP page is always the authoritative one. Disabled by default;
the toggle persists across restarts. Keys are stored encrypted at rest with
the same machinery as connection passwords.

## Architecture

The backend (`backend/main.ts`, `backend/`) is a Bun process running a
loopback-only HTTP static file server (never exposed beyond `127.0.0.1`) and a
PostgreSQL driver wrapper (`postgres.js`). It serves the prebuilt React app and
exposes a typed JSON-RPC endpoint (`/rpc`) that the frontend calls over HTTP.
When enabled, it also runs the MCP server (`backend/mcp.ts`) on loopback port
3939, which authenticates per-request bearer keys against encrypted key
storage and dispatches read-only tool calls to the same active session.

The frontend (`web/src/`) is a React 19 SPA built with Vite 7, Tailwind CSS 4,
and Radix UI primitives. It runs in your browser and talks to the backend
through the RPC contract.

Shared types (`shared/types.ts`, `shared/rpc.ts`) define the RPC contract
between backend and frontend.

## Tech stack

| Backend               | Frontend                          |
|-----------------------|-----------------------------------|
| Bun                   | React 19                          |
| postgres.js           | Vite 7                            |
| @modelcontextprotocol/sdk | Tailwind CSS 4                 |
| zod                   | Radix UI                          |
|                       | CodeMirror (SQL editor)           |
|                       | TanStack Table / Virtual          |

## License

MIT — see LICENSE.
