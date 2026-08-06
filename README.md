# gresui-web — gresui as a web app

gresui is a fast, friendly PostgreSQL client. This is the web-only version:
a small local backend (bun) that serves the same React frontend in your
browser. No desktop window, no native runtime — just your browser.

## Install

```sh
npm install -g gresui-web
```

Then run:

```sh
gresui-web
```

The backend starts on a loopback port and opens your browser. Everything runs
locally; nothing is exposed beyond `127.0.0.1`.

## Development

```sh
npm install        # frontend build tooling
npm run build      # vite build → dist/
npm run dev        # bun run backend/main.ts
```

## Configuration

Same as gresui: `~/.config/gresui/gresui.db` (Linux), `~/Library/Application
Support/gresui` (macOS), `%APPDATA%\gresui` (Windows). `GRESUI_CONFIG_DIR`
overrides the location. Existing gresui connections carry over.

## License

MIT — see LICENSE.
