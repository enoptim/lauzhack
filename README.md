# Building twin · LauzHack 2026

A digital copy of the building we're sitting in. Change the heating, the ventilation or the lights, and see what it does to the energy bill, the indoor air and the money, before you spend anything.

Built in 24 hours for the UBS challenge "AI Financial Twin" at [LauzHack 2026](https://lauzhack.com) by Enoptim: Casper, Oscar, Theodor and Linus.

> Don't predict the future. Make it explorable.

## Where to look

- [AGENTS.md](AGENTS.md): what we're building, who does what, and how we write.
- [wiki/index.md](wiki/index.md): research, decisions and pitch notes.
- [wiki/decisions.md](wiki/decisions.md): what the team has decided. Read this before you change direction.

## Run it

You need Python 3 and Node.js. Run this once:

```sh
make setup
```

It installs the simulation's web server in `model/.venv` and the 3D app's packages in `frontend/node_modules`.

Then start both parts with one command:

```sh
make dev
```

- 3D app: http://localhost:5173
- Simulation API: http://localhost:8000 (the 3D app reaches it through `/api`)
- Ctrl+C stops both.

Other commands:
- `make api` or `make frontend` starts only one part.
- `make test` runs the simulation's checks.
- Press the ` key in the app (or open http://localhost:5173/?debug) to see the raw simulation result. It shows that the app and the simulation are connected.

How the simulation works and what the API returns: [model/README.md](model/README.md).

The assistant needs an OpenRouter key in `chat/.env`. Ask Theodor for it. See [chat/README.md](chat/README.md).
