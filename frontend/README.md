# Building twin frontend

This is a React, TypeScript, and Vite app. The building viewer uses React Three Fiber and Drei. The other pages use shadcn/ui and Tailwind.

## Run

```sh
cd frontend
pnpm install
pnpm dev
```

Open the URL printed by Vite. Change the path in your browser's address bar to switch pages; there is no in-app navigation yet.

- `/` — 3D building viewer. It requires WebGL. Left-drag to orbit, scroll to zoom, and right-drag to pan.
- `/assistant` — Assistant placeholder.
- `/results` — Results placeholder.

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
