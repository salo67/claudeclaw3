#!/bin/bash
# Restart all ClaudeClaw servers (API + Dashboard + Bot)
# Usage: bash scripts/restart-servers.sh

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Stopping existing processes..."

# Kill any existing claudeclaw uvicorn on port 8028
for pid in $(netstat -ano 2>/dev/null | grep ":8028.*LISTENING" | awk '{print $5}' | sort -u); do
  taskkill //PID "$pid" //F //T 2>/dev/null
done

# Kill existing claudeclaw vite on port 5228
for pid in $(netstat -ano 2>/dev/null | grep ":5228.*LISTENING" | awk '{print $5}' | sort -u); do
  taskkill //PID "$pid" //F //T 2>/dev/null
done

# Kill existing bot (tsx src/index.ts)
wmic process where "name='node.exe'" get ProcessId,CommandLine 2>/dev/null | grep "claudeclaw.*index.ts" | grep -oP '\d+\s*$' | while read pid; do
  taskkill //PID "$pid" //F //T 2>/dev/null
done

sleep 2

echo "Starting API on port 8028..."
cd "$PROJECT_DIR/api"
python -c "
import socket, uvicorn
orig_bind = socket.socket.bind
def patched_bind(self, address):
    self.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    return orig_bind(self, address)
socket.socket.bind = patched_bind
uvicorn.run('main:app', host='0.0.0.0', port=8028)
" &
API_PID=$!

sleep 2

echo "Starting Dashboard on port 5228..."
cd "$PROJECT_DIR/dashboard"
npx vite --port 5228 --host 0.0.0.0 &
DASH_PID=$!

sleep 2

echo "Starting Telegram Bot..."
cd "$PROJECT_DIR"
npx tsx src/index.ts &
BOT_PID=$!

sleep 3

echo ""
echo "=== ClaudeClaw Servers ==="
echo "API:       http://localhost:8028  (PID $API_PID)"
echo "Dashboard: http://localhost:5228  (PID $DASH_PID)"
echo "Bot:       @ClauedeSalobot       (PID $BOT_PID)"
echo "=========================="
