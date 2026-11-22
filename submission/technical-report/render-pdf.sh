#!/usr/bin/env bash
set -euo pipefail

report_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
output="$report_dir/technical-report.pdf"

for tool in mmdc markdown_py pdfinfo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$tool" >&2
    exit 1
  fi
done

browser=${CHROME_BIN:-}
if [[ -z $browser ]]; then
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    if browser=$(command -v "$candidate"); then break; fi
  done
fi
if [[ -z $browser ]] || ! command -v "$browser" >/dev/null 2>&1; then
  printf 'Chromium or Chrome is required. Set CHROME_BIN to its executable if needed.\n' >&2
  exit 1
fi
browser=$(command -v "$browser")

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

# Use native SVG text for the diagram labels.
printf '%s\n' '{"htmlLabels":false}' > "$work/mermaid.json"
PUPPETEER_EXECUTABLE_PATH="$browser" mmdc -c "$work/mermaid.json" \
  -i "$report_dir/technical-report.md" -o "$work/report.md"

{
  cat <<'HTML'
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>What-If LauzHack — Technical Report</title>
<style>
@page { size: A4; margin: 16mm 18mm; }
body { margin: 0; padding: 0; max-width: none; font: 11pt/1.35 sans-serif; color: #171717; }
h1 { font-size: 20pt; margin: 0 0 12pt; }
h2 { font-size: 13pt; margin: 11pt 0 4pt; break-after: avoid; }
p { margin: 0 0 7pt; }
img { display: block; margin: 6pt auto; max-width: 100%; max-height: 65mm; break-inside: avoid; }
</style>
<body>
HTML
  markdown_py -x fenced_code "$work/report.md"
  printf '\n</body>\n</html>\n'
} > "$work/report.html"

"$browser" --headless --no-pdf-header-footer --user-data-dir="$work/chrome" \
  --print-to-pdf="$work/report.pdf" "file://$work/report.html"

pages=$(LC_ALL=C pdfinfo "$work/report.pdf" | awk '/^Pages:/ {print $2}')
if [[ $pages != 1 ]]; then
  printf 'Expected one page, got %s. PDF not updated.\n' "${pages:-unknown}" >&2
  exit 1
fi

mv -- "$work/report.pdf" "$output"
printf 'Wrote %s (1 page)\n' "$output"
