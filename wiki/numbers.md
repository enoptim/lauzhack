# Numbers

**To do:** run a verification agent on this note before the pitch. The fixes below come from one round of web research and are not checked yet.

Every number in `data/` is an assumption. The data doesn't need to match the real building, but the numbers should be believable.

## Numbers to fix

PR #5 changes sick leave, servers, the lake-water heat pump and solar in `data/generate.py`. Fresh air is already handled in Oscar's model.

- **Fresh air and work:** CO₂ alone has no proven effect on work ([review](https://doi.org/10.1111/ina.12706)). Oscar's model already handles this: it uses 0.3% per 100 ppm, with 0 as the low value (`model/README.md`). The research supports fresh air better than CO₂: 0 / 1.5 / 3% better work per extra 10 litres per second per person, below about 20 ([Seppänen 2006](https://doi.org/10.1111/j.1600-0668.2005.00394.x)).
- **Sick leave:** keep 1.53, but set the low value to 1.0 (no effect) ([Mendell 2014](https://eta-publications.lbl.gov/publications/prospective-study-ventilation-rates)).
- **Servers:** about 80,000–90,000 CHF per rack, not 25,000–30,000 ([Dell](https://www.dell.com/en-us/shop/ipovw/poweredge-r760)).
- **Lake-water heat pump:** about 4 units of heat per unit of electricity, not 5 ([EPFL](https://actu.epfl.ch/news/a-heating-plant-that-combines-renewable-energy-sou)).
- **Solar panels:** about 1,065 CHF per kWp, not 1,350 ([Swiss cost study](https://pubdb.bfe.admin.ch/de/publication/download/12226)).

## Safe to say on stage

- "We don't claim CO₂ makes people dumber. More fresh air gives about 1–3% better work, so we use 1.5% and show zero as the worst case."
- "Offices that get too hot lose a few percent of performance for each degree above about 25 °C."
- "Salaries are far bigger than the energy bill, so even a small effect on people can matter more than the energy saved."
