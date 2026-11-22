CHROME_BIN ?= chromium

.PHONY: all clean
all: technical-report.pdf

technical-report.pdf: technical-report.tex .build/engine.pdf
	latexmk -pdf -halt-on-error -interaction=nonstopmode -outdir=.build $<
	@test "$$(LC_ALL=C pdfinfo .build/$@ | awk '/^Pages:/ {print $$2}')" = 1 || { echo "Expected a one-page PDF" >&2; exit 1; }
	cp .build/$@ $@

.build/engine.pdf: engine.mmd
	mkdir -p .build
	PUPPETEER_EXECUTABLE_PATH="$$(command -v '$(CHROME_BIN)')" mmdc -i $< -o $@

clean:
	rm -rf .build
