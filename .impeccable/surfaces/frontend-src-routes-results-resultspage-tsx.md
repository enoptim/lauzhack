---
version: 1
slug: "frontend-src-routes-results-resultspage-tsx"
primary_target: "frontend/src/routes/results/ResultsPage.tsx"
related_targets: []
---

# Results page (/results)

Mode: Operate. A working decision screen, shown on a big screen on stage.

Audience and job: hackathon judges watch Linus decide on one building upgrade. They must see in seconds what it costs, when it pays back, and how that changes when the world changes.

Content: plan summary; today vs after (energy bill, kWh, meeting-room CO2, payback); money over time vs doing nothing with what-if lines and a futures band; break-even sentence; where the money comes from; warnings by year; top assumptions with fact/research/guess labels. All numbers from the engine API.

Constraints: light theme; shadcn base; few clicks; money only by default, staff effects behind a switch; no "predict".

## Direction contract

THESIS: One calm decision screen where the money line is the hero. Refuses the tile-wall dashboard: one chart owns the page, everything else answers it.
OWN-WORLD: Linear/Claude/GitHub-grade light platform. Near-white ground, hairline borders, generous radius, one indigo accent, warm amber second series, red only for warnings. Soft smooth curves with gradient fills fading to nothing.
STORY: The visitor reads the verdict, sees the line cross zero, toggles a what-if or the staff-effects switch, and watches the line and verdict move together.
FIRST VIEWPORT: Slim top bar with plan and cost. Verdict sentence large at left top, three stat values beside it. The money-over-time chart fills the width below, with what-if chips above it. Hatched red band marks the years below the savings minimum. Secondary panels below the fold.
FORM: canon (category standard, user's choice of Linear/Claude/GitHub as bar); seed:3b27528b834c7003.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
