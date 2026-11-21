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
