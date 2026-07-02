# FileDrop Temporal

Share large files from your own PC with temporary public links. Your computer stores the file, the app exposes only this transfer panel, and each upload expires automatically after 1 hour.

## Why

FileDrop Temporal is useful when you occasionally need to send a big APK, ZIP, video, build, or project file without uploading it to a cloud drive first.

## Features

- Local storage on your PC.
- Temporary download links.
- Per-file expiration times.
- Automatic cleanup when links expire.
- Private upload code.
- Responsive browser interface.
- Optional Electron desktop shell.
- Cloudflare Tunnel quick-share workflow.
- No checked-in secrets or transferred files.

## Quick Start

Install dependencies:

```powershell
npm install
```

Run the local web app:

```powershell
npm start
```

Open:

```text
http://localhost:8787
```

The first run creates `.upload-code`. That file is private and ignored by Git.

## Share Through The Internet

Install the local tunnel helper:

```powershell
npm run setup-tunnel
```

Start the temporary public tunnel:

```powershell
npm run tunnel
```

Then upload from your PC at:

```text
http://localhost:8787
```

The app copies public links that look like:

```text
https://example.trycloudflare.com/d/transfer-id
```

Keep the terminal open while your friend downloads. If your PC sleeps, shuts down, or loses internet, the link stops working.

Each upload can choose its own expiration time from the web UI. The default is 1 hour and the default maximum is 24 hours.

The default max file size is 25 GB. Real transfers still depend on your free disk space, connection speed, and how long your PC stays awake.

## Desktop App

Run the Electron prototype:

```powershell
npm run desktop
```

The desktop shell can start the local server, open the tunnel, show the current public link, and embed the uploader UI.

## Windows Launchers

The `launchers/` folder includes simple `.cmd` files:

- `Encender FileDrop Temporal.cmd`
- `Apagar FileDrop Temporal.cmd`
- `Abrir FileDrop Desktop.cmd`

You can create desktop shortcuts to those files.

## Configuration

Environment variables:

```powershell
$env:PORT=8788
$env:FILEDROP_CODE="MY-CODE"
$env:FILEDROP_MAX_SIZE="50gb"
$env:FILEDROP_TTL_MS="3600000"
$env:FILEDROP_MAX_TTL_MS="86400000"
```

## Security Notes

This is a personal sharing tool, not a zero-trust enterprise product.

- The upload screen is protected by a private code.
- Download links are long, random, and temporary.
- Anyone with an active download link can download the file.
- Quick Cloudflare tunnels are convenient, but not intended as a production SLA.
- Do not share sensitive files unless you understand the risk.

## Repository Hygiene

Ignored by Git:

- `.upload-code`
- `public-origin.txt`
- `bin/`
- `storage/`
- `node_modules/`

That keeps private codes, downloaded tunnel binaries, transfer logs, and shared files out of the public repo.
