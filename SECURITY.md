# Security Policy

FileDrop Temporal is designed for short-lived personal transfers.

## Do Not Commit

Never commit:

- `.upload-code`
- `public-origin.txt`
- files inside `storage/`
- `bin/cloudflared.exe`
- logs with public tunnel URLs

## Link Behavior

Download links are bearer links: anyone who receives a valid active link can download the file until it expires or the server stops.

## Recommended Use

- Share links only with trusted people.
- Keep the tunnel open only while needed.
- Close the tunnel when the transfer is finished.
- Use a named Cloudflare Tunnel and stronger auth before using this in a production context.
