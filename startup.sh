#!/bin/bash
# Startup script for Azure App Service (Linux, Node).
#
# Pointed at by appCommandLine as a single word-splitting-safe command:
#
#     bash /home/site/wwwroot/startup.sh
#
# WHY A SCRIPT RATHER THAN A ONE-LINER
#
# appCommandLine does not survive quoting. Setting it to
#     bash -c 'cd /home/site/wwwroot && node ... server.ts'
# reached the container as "bash -c cd" - the quotes were lost and everything
# after the first word was dropped. A script has no quoting to lose.
#
# WHERE node_modules ACTUALLY IS
#
# This instance runs in Oryx's "compressed node_modules" mode. Its generated
# startup script extracts node_modules.tar.gz into /node_modules, exports
# NODE_PATH=/node_modules, and only then replaces wwwroot/node_modules with a
# symlink to it. Which of the two paths exists when this script runs is not
# guaranteed - the 2026-09-21 log shows the app starting BEFORE the extraction
# finished and dying on a path that appeared seconds later. So: wait for
# either, and use whichever turns up.
#
# WHY NOT node_modules/.bin/tsx
#
# "zip -rq" in the build job follows symlinks, so .bin/tsx arrives as a copy of
# cli.mjs rather than a link to it, and its relative imports resolve against
# .bin/ instead of tsx/dist/. Every route through .bin is broken - npm start,
# npx tsx, all of them. The real file is not. See docs/DEPLOYMENT.md.
set -u

cd /home/site/wwwroot || exit 1

TSX=""
for i in $(seq 1 60); do
  if [ -f /node_modules/tsx/dist/cli.mjs ]; then
    TSX=/node_modules/tsx/dist/cli.mjs
    break
  fi
  if [ -f node_modules/tsx/dist/cli.mjs ]; then
    TSX=node_modules/tsx/dist/cli.mjs
    break
  fi
  [ "$i" = 1 ] && echo "[startup] waiting for node_modules to be extracted..."
  sleep 2
done

if [ -z "$TSX" ]; then
  echo "[startup] FATAL: tsx not found after 120s. Looked for:"
  echo "[startup]   /node_modules/tsx/dist/cli.mjs"
  echo "[startup]   /home/site/wwwroot/node_modules/tsx/dist/cli.mjs"
  echo "[startup] Contents of /node_modules (first 20):"
  ls /node_modules 2>&1 | head -20
  echo "[startup] Contents of wwwroot (first 20):"
  ls -la 2>&1 | head -20
  exit 1
fi

echo "[startup] using $TSX"
# exec, so the Node process becomes PID 1 and receives the platform's signals
# directly instead of being orphaned behind a shell that ignores them.
exec node "$TSX" server.ts
