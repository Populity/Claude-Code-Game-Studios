#!/usr/bin/env bash
# Rebuilds the app and refreshes deploy/web. Commit + push afterwards; the server picks it up in ≤5 min.
set -euo pipefail
cd "$(dirname "$0")/../apps/mobile"
npx tsc --noEmit
CI=1 npx expo export --platform web --output-dir dist
cd ../../deploy && find web -mindepth 1 -delete && cp -r ../apps/mobile/dist/. web/
sed -i 's#<title>VSV</title>#<title>VSV — битвы клипов</title><meta name="theme-color" content="\#000000"><style>html,body{background:\#000}</style>#; s#<html lang="en">#<html lang="ru">#' web/index.html
echo "deploy/web refreshed"
