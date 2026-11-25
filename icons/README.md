# Custom Bookmark Icons Directory (`icons/`)

This directory is dedicated to **user-supplied bookmark icons for external services**. It is intentionally kept separate from `pikbay`'s built-in UI icon sprite (`web/src/icons/`), and the repository ships zero third-party brand logos by default.

Drop your service icon files (`.svg`, `.png`, `.webp`, or `.ico`) into this directory (for container deployments, mount it read-only at `/config/icons` and set `server.icons_dir = "/config/icons"`), then reference the filename in `config.toml`:

```toml
[[groups.items]]
name = "Jellyfin"
url = "https://media.example.ts.net"
icon = "jellyfin.svg"     # Served from icons/jellyfin.svg
icon_text = "JF"          # Optional 1-3 character monogram fallback when `icon` is omitted or missing
```

## Security & Fallback Guarantees

1. **Zero External Requests**: Every icon is served same-origin from `/icons/<file>`. `pikbay` never fetches remote favicons or contacts third-party CDNs.
2. **Sandboxed SVG Delivery**: `.svg` responses include `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox` and are rendered strictly via `<img>`, blocking script execution and external fetches.
3. **Strict File Validation**: Filenames allow only ASCII letters, digits, `.`, `_`, and `-`. Subdirectories, hidden dot-files, and symlinks (`O_NOFOLLOW`) are rejected, and each file is capped at `512 KiB`.
4. **Graceful Monogram Fallback**: When `icon` is omitted or the icon file is not yet present, the UI automatically renders an engraved monogram badge (`icon_text` if configured, or initials derived from `name`).
