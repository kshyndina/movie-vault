#!/bin/bash
# Rebuild movies.json from data/ and push to GitHub Pages.
set -e
cd "$(dirname "$0")"
python3 ../merge.py 2>/dev/null || python3 merge.py
git add -A
git commit -m "update: rebuild movies.json" || echo "nothing to commit"
git push
echo "pushed. Pages will redeploy in ~1 min: https://kshyndina.github.io/movie-vault/"
