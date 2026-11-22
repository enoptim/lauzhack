# Technical report (LaTeX)

Run `make -C submission/technical-report/latex` from the repository root to build `technical-report.pdf`. The build renders `engine.mmd` with Mermaid and checks that the A4 PDF is exactly one page.

To rebuild on save (requires `entr`):

```bash
printf '%s\n' submission/technical-report/latex/{technical-report.tex,engine.mmd,Makefile} | entr make -C submission/technical-report/latex
```

Requires `latexmk`, pdfLaTeX with `lmodern`, `geometry`, and `microtype`, Mermaid CLI (`mmdc`), Chromium, and `pdfinfo`. Set `CHROME_BIN` if Chromium is installed under a different name or path.
