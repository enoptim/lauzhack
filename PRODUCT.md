# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- This is a hackathon demo. The real audience is the judges at LauzHack 2026 (UBS challenge "AI Financial Twin"), on Sunday 22 November 2026.
- They watch it on a big screen on stage, from far away. They are not energy or building experts.
- Linus presents alone. He talks and clicks at the same time, so every step must need very few clicks (decision D5).
- The story inside the demo: Tom Watts, a made-up energy manager of this building, shows an upgrade to the finance director, who decides on the money (`wiki/persona.md`). Tom is a character in the pitch, not a real user we design research for.

## Product Purpose

- A digital copy of the building where the hackathon takes place (EPFL building BC).
- You change a part of the building, such as ventilation, lighting or coffee machines. The twin then shows what changes: the energy bill, the indoor air, the comfort and the money.
- It does not predict one future. It lets you explore many: what if energy prices spike, what if a heatwave comes, what if you count the effect on staff. UBS's slogan: "Don't predict the future. Make it explorable."
- Success: the judges understand in seconds what changes and why, and they believe the numbers.

## Positioning

- Other teams build a chatbot or a dashboard for a made-up person's money. We build a twin of the real building everyone is sitting in.
- Expert building software takes weeks and needs consultants. Energy dashboards show the past. This twin shows the effect of a decision before you make it, in money a finance director understands.
- Energy, comfort and money in one view, with every number honest about how sure it is.

## Operating Context

- The demo flow: move around the 3D building, pick a floor, click a part, choose an upgrade, then see the results next to today's setup.
- The 3D building view is at `/`. The results view is at `/results`. The building sends the chosen upgrades to the results view as JSON in the page address.
- The simulation engine (`model/`) does every calculation. The frontend only shows its numbers. One engine run takes about 13 ms, so the results can update live. The many-futures run takes about 4.5 s.
- No slides are allowed (D4). The app is the presentation.
- The pitch opens with a printed energy bill for this building (D3).
- Big screen: there are at most 30 seconds to connect. If that fails, Linus presents from the laptop screen. The demo must not depend on the venue Wi-Fi.
- Pitch lengths: 3 minutes on the main stage, 5 minutes for UBS (D6).

## Capabilities and Constraints

- The building's geometry is fixed. The only interactions are moving the camera and changing parts of the building (type, power, efficiency).
- The judges score: money maths (25), what-if changes (20), proof it works (15), easy to understand (15), new ideas (15), honesty (10). See `wiki/challenge.md`.
- Every number is marked by how it was made: a fact (from EPFL plans), research (a cited study), a guess (our assumption) or a result (calculated by the engine).
- Money is shown first as money only (purchase, energy, upkeep). The value of better work and fewer sick days is a switch the user turns on, because it rests on guesses.
- We say once, clearly: "The building is real. The numbers are our assumptions." (D7)
- Don't use the word "predict". Don't make a chatbot the main thing.
- No UBS loan message in the app (D8).
- Writing style: plain English for someone outside energy, finance and software (`AGENTS.md`).
- Undecided: the product name and brand. Keep the app neutral for now.

## Brand Commitments

- Look and feel: a clean modern product platform, like Linear, Claude and GitHub. The user chose this over themed directions on 2026-11-21. Their craft level is the bar.
- Charts are soft: smooth curves, gentle filled areas, thin lines, quiet axes. Not hard, poster-like or signage-like.
- Light theme. The 3D building view keeps its current look until we restyle it after the Results page.
- shadcn/ui stays the component base, restyled through the theme.

## Evidence on Hand

- Real room outlines from plan.epfl.ch, and real Lausanne weather and solar data (`data/`).
- Photos and notes of the real building in `building-context/`.
- Research sources for the people effects in `data/assumptions.csv` and `wiki/numbers.md`.
- 41 engine checks in `model/test_engine.py`.
- We have no real customers, testimonials or measured savings for this building. Do not invent any.

## Product Principles

1. **Explore, don't predict.** Always show how the result changes when the world changes, never one certain future.
2. **Honest numbers.** Every number shows whether it is a fact, research, a guess or a result.
3. **Readable from the back of the room.** One main idea per view, big numbers, few elements at a time.
4. **Few clicks.** One person must be able to tell the whole story while clicking.
5. **Money a finance director trusts.** Lead with cash, then show what depends on guesses.

## Accessibility & Inclusion

- Strong contrast and large text for a projector in a bright hall.
- Never use colour alone to carry meaning. Pair it with a label, a pattern or an icon.
