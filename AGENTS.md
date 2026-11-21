# Building Digital Twin — LauzHack 2026

## Context
- Challenge: UBS "AI Financial Twin" ("Don't predict the future. Make it explorable."). Instead of a personal finance twin, we build a digital twin of a building. UBS has approved this approach, and creativity earns bonus points.
- Deadline: 22 November 2026, 12:00 (24-hour hackathon).
- The challenge repo (rubric, FAQ, synthetic data) is private: github.com/sschallenges2026/ai-financial-twin-lauzhack-2026. It needs an invited GitHub account.

## Team
- Casper: frontend, 3D building UI
- Oscar: simulation and mathematical modelling
- Theodor: datasets feeding the model and the UI
- Linus: pitch and project management

## Product
A Sims-like 3D digital twin of a building. It helps building managers and other stakeholders decide on investments before making them: e.g. a new air filter, an HVAC upgrade, a heat pump, insulation, new monitors, or a different coffee machine.

Demo flow:
1. The user moves the camera around a 3D building.
2. Click the building → a floor → a component (e.g. the 2nd-floor HVAC).
3. A panel offers ~5 alternative upgrades for that component.
4. Picking one reruns the simulation and shows the results next to the current setup.

Outputs per scenario:
- Energy use and energy cost
- Indoor air quality (e.g. CO₂) and temperature
- Number of occupants the building supports (for planned expansion)
- Financials: investment cost, monthly/yearly savings, payback time, ROI

Scope: the only interactions are moving the camera and changing the components (type, power draw, efficiency, etc.). The building's geometry itself is not editable.

## Enoptim context
- For Enoptim-specific context (product, customers, pilots, competitors, past pitches), read Alexandria, Enoptim's Obsidian vault. It's cloned at different paths on different machines: look for an `alexandria` folder next to this repo (`../alexandria`), and ask the user if it isn't there.
- Alexandria's own `AGENTS.md` and safety rules apply when you read or change it.

## Wiki
- `wiki/` holds the team's research, decisions and pitch material. One topic per note.
- Read `wiki/decisions.md` before you start. Don't go against a numbered decision. To change one, add a new decision that replaces it.
- Don't use tables in the wiki. Use headings and short lists.
- `wiki/index.md` lists every note in `wiki/` with a one-line summary. Keep it up to date: whenever you add, rename or delete a wiki note, update the index in the same change.

## Writing style
Everything in this repo (wiki, pitch, app text) must be easy to understand for someone outside energy, finance and software.
- Use a technical word only where it earns its place, i.e. where a plain word would be less precise. Explain it in plain words the first time. Avoid jargon that only sounds clever.
- Main point first. One idea per sentence. Short sentences.
- Short lists, not long paragraphs. No tables in the wiki.
