#!/bin/bash

cd "$(dirname "$0")" || exit 1

NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ] && [ -x "/Users/Valentine/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  NODE_BIN="/Users/Valentine/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
  echo "Node.js is required to run the quiz. Install Node.js, then open this file again."
  read -r -p "Press Enter to close."
  exit 1
fi

"$NODE_BIN" server.js &
SERVER_PID=$!

sleep 1
open "http://localhost:3000"

echo ""
echo "The quiz is running. Keep this window open during the presentation."
echo "Press Control-C when you are finished."
wait "$SERVER_PID"
