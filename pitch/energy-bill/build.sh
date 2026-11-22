#!/usr/bin/env bash
# Builds the cartoon energy bill: template + embedded fonts -> bill.html -> bill.pdf -> bill.png
set -euo pipefail
cd "$(dirname "$0")"
FONTS="${FONTS:-fonts}"

# Avenir Next is an Apple system font, so we don't commit it. Extract it on a Mac.
if [ ! -f "$FONTS/AvenirNextHeavy.woff2" ]; then
  mkdir -p "$FONTS"
  uvx --from 'fonttools[woff]' python - "$FONTS" <<'PY2'
import sys
from fontTools.ttLib import TTCollection
for f in TTCollection("/System/Library/Fonts/Avenir Next.ttc").fonts:
    n = f["name"].getDebugName(4)
    if n in ("Avenir Next Regular", "Avenir Next Demi Bold", "Avenir Next Bold", "Avenir Next Heavy"):
        f.flavor = "woff2"; f.save(f"{sys.argv[1]}/{n.replace(' ', '')}.woff2")
PY2
fi

python3 - "$FONTS" <<'PY'
import base64, sys, pathlib
d = pathlib.Path(sys.argv[1])
b64 = lambda f: base64.b64encode((d / f).read_bytes()).decode()
html = pathlib.Path("bill.template.html").read_text()
for key, f in {"REGULAR": "AvenirNextRegular", "DEMI": "AvenirNextDemiBold", "BOLD": "AvenirNextBold", "HEAVY": "AvenirNextHeavy"}.items():
    html = html.replace("{{FONT_%s}}" % key, b64(f + ".woff2"))
pathlib.Path("bill.html").write_text(html)
PY

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="$PWD/bill.pdf" "file://$PWD/bill.html" 2>/dev/null

pdfinfo bill.pdf | grep -E "Pages|Page size"
pdftoppm -png -r 110 -f 1 -l 1 -singlefile bill.pdf bill
echo "done"
