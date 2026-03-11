---
name: google-drive
description: Manage Google Drive files from Claude Code. List, read, create, update, move files and monitor changes.
allowed-tools: Bash(CLAUDECLAW_DIR=* ~/.venv/bin/python3 ~/.config/gdrive/drive.py *)
---

# Google Drive Skill

## Purpose

List, read, create, update, and organize files in Google Drive via Claude Code.

## Environment

The Drive CLI reads credential paths from environment variables, loaded from ClaudeClaw's `.env` via `CLAUDECLAW_DIR`. Every command MUST use this prefix:

```
CLAUDECLAW_DIR=/path/to/claudeclaw
```

Your `.env` should contain:

```
GOOGLE_CREDS_PATH=~/.config/gmail/credentials.json
GDRIVE_TOKEN_PATH=~/.config/gdrive/token.json
```

Uses the same Google Cloud project and credentials as Gmail. Only the token file is separate (different scopes).

## Commands

### List files

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py list
```

Returns JSON array: `id`, `name`, `mimeType`, `modifiedTime`, `size`, `parents`. Shows last 20 files by default.

### List with query

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py list --query "name contains 'flujo'"
```

Uses Google Drive query syntax. Common patterns:
- `name contains 'keyword'`
- `mimeType = 'application/vnd.google-apps.spreadsheet'`
- `'FOLDER_ID' in parents`
- `modifiedTime > '2025-01-01'`

### List files in a folder

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py list --folder "Folder Name"
```

### List with limit

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py list --limit 50
```

### Read a file (Google Docs / Sheets / text)

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py read <file_id>
```

- Google Docs: exported as plain text
- Google Sheets: exported as CSV (first sheet by default)
- Text/CSV/JSON files: downloaded as-is
- Other files: returns metadata only

### Read specific sheet

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py read <file_id> --sheet "Sheet2"
```

### Create a Google Doc

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py create-doc "Document Title" "Content here"
```

### Create a Google Sheet

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py create-sheet "Sheet Title" --csv "/path/to/data.csv"
```

### Update file content

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py update <file_id> "New content"
```

### Update sheet cells

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py update-cells <spreadsheet_id> --range "A1:B3" --values '[["Header1","Header2"],["val1","val2"],["val3","val4"]]'
```

### Move file to folder

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py move <file_id> "Destination Folder"
```

### Rename file

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py rename <file_id> "New Name"
```

### Recent changes

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py changes --hours 24
```

Returns files modified in the last N hours. Useful for monitoring.

### Search across all files

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py search "keyword"
```

Full-text search across file names and content.

### Upload a local file

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py upload "/path/to/local/file.pdf" --folder "Target Folder"
```

### Re-authenticate

```bash
CLAUDECLAW_DIR=/path/to/claudeclaw ~/.venv/bin/python3 ~/.config/gdrive/drive.py auth
```

## Workflow

1. Run `list` or `search` to find files
2. Run `read` to examine content
3. Run `update` or `create-*` to modify
4. Report results to user

## Drafting Rules

- Always show file content or changes to the user before making modifications
- Never delete files without explicit confirmation
- When reading spreadsheets, show data in markdown table format

## One-Time Setup

Uses the same Google Cloud project as Gmail. Only needs Drive API enabled:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your existing project (same as Gmail)
3. Enable the **Google Drive API** (APIs & Services > Library)
4. Enable the **Google Sheets API** (APIs & Services > Library)
5. The same OAuth client from Gmail works — no new credentials needed
6. Run the `auth` command (see above)
7. Browser opens, sign in, authorize Drive + Sheets scopes, done

## Error Handling

- If `credentials.json` missing, refer to Gmail skill setup (same file)
- If `token.json` missing, run auth automatically
- If file not found, suggest search alternatives
- If quota exceeded, wait and retry
