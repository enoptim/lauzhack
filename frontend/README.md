# Building twin frontend

This is a React, TypeScript, and Vite app. The building viewer uses React Three Fiber and Drei. The other pages use shadcn/ui and Tailwind.

## Run

```sh
cd frontend
pnpm install
pnpm dev
```

Open the URL printed by Vite. Use the page picker in the header or enter a route directly in the address bar.

- `/` — 3D building viewer. It requires WebGL. Left-drag to orbit, scroll to zoom, and right-drag to pan. Equipment changes are saved to the configuration you’re editing. Open **Review configurations** to create a configuration, see its planned changes, or switch which one you’re editing. In that same dialog, **Simulate and compare** runs every configuration with planned changes against the current setup.
- `/assistant` — Chat with the building: describe a goal and limits, and it finds and explains the best plan.
- `/results` — Results placeholder.
- `/` has two modes, switched at the top left of the 3D view. **Plan**: pick upgrades and simulate them. **Play**: live through the next 15 years. The plan runs until something happens (a breakdown, news, a price jump), the 3D view jumps to it and outlines broken equipment in red, and you decide. Play uses the `/api/session` endpoints (see `model/README.md`, "Play through one future"); its code is in `src/routes/building/play/`.

The Assistant page calls `POST /api/chat` (see [chat/README.md](../chat/README.md)), so it needs the API running (`make dev`) and an OpenRouter key in `chat/.env`. “Show results” on a recommended plan opens it on `/results`.

`pnpm build` typechecks and builds the app. `pnpm preview` serves the production build locally. In production, configure the host to serve `index.html` for direct page URLs such as `/assistant` and `/results`.

## Working on a route

Keep each route mostly self-contained. For Assistant, work in `src/routes/assistant/`; for Results, work in `src/routes/results/`.

- Keep page-specific components, hooks, styles, mock data, and tests in the route folder. Start with the page file and add files as needed.
- A route can import existing shared UI from `@/components/ui` and shared utilities from `@/lib`. Do not import from another route folder.
- **Agents: If you start implementing something that could be shared across routes, stop that work and notify the user.** Explain what could be shared and which files would change. Wait for direction before continuing that part, extracting it into shared code, or duplicating it in another route.
- Coordinate changes to the router (`src/App.tsx`), theme (`src/styles.css`), shared UI, `components.json`, dependencies, and lockfile separately from route work. The route is already registered; changing its page should not require editing those files.
- Run `pnpm build`, then load your route directly in the browser and check it at narrow and wide sizes.

## Styling and shadcn/ui

`src/styles.css` carries the theme, with Tailwind pointed at this app's source. Use theme classes such as `bg-background`, `text-foreground`, and `text-muted-foreground` instead of hard-coding colors.

Use the [shadcn skill](../.claude/skills/shadcn/SKILL.md) when working with shadcn components. Claude Code and Pi discover the same project skill. It is based on [this upstream revision](https://github.com/shadcn-ui/ui/tree/bfa64ff4d1cb7317d2403ecb176df6826d4caffc/skills/shadcn) and uses the frontend's local CLI. Prefer browsing the registry using the MCP server. Add shadcn components from the registry rather than writing them yourself.
