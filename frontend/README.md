# Building twin frontend

This is a React, TypeScript, and Vite app. The building viewer uses React Three Fiber and Drei. The other pages use shadcn/ui and Tailwind.

## Run

```sh
cd frontend
pnpm install
pnpm dev
```

Open the URL printed by Vite. The top bar switches between the two views of the twin: **Building** and **Results**.

- `/`: the 3D building. It needs WebGL. Left-drag to orbit, scroll to zoom, right-drag to pan. The panel on the right lists your plans, a floor picker and the equipment on that floor. Pick an option and it goes into the plan you're editing. The plan's changes are pinned onto the building.
- `/explore`: the same 3D building, explored through one future (the **Explore** tab; old `/play` links redirect). Choose 5, 10 or 15 years; every run draws a new future (`/explore?story=demo` plays the fixed demo story instead). The plan runs until something important happens (a big system breaks, news, a warning, a price jump; small wear-outs are replaced without stopping and listed); the 3D view jumps to what broke and outlines it in red, and you decide. At the end, **See how you did** opens Results with your path as the plan and the future you explored as the bold line, against 200 other futures. Code in `src/routes/building/play/`; it uses the `/api/session` endpoints (see `model/README.md`).
- `/results`: the plans compared over 200 possible futures. The building opens it with the plans in the page address (`?config=`). Three columns: the plans (left), the verdict, key numbers and chart (middle), and the assumptions you can change (right). When the assistant is open and the view is narrower, the plans and the assumptions share one column on the right. Every change reruns the futures; the chart keeps a dashed "before" line and the verdict says how much the change moved the result. Keys: Space plays one future, 1–6 choose a plan. All state lives in `src/routes/results/useResultsModel.ts`; the parts only read it.
- `/assistant`: old links open the assistant beside the building.

Three things are part of every view (they live in `src/twin/`):
- **The pulse** in the top bar: what the plan on screen does to the energy bill and the meeting-room air, and what it costs up front. It reruns the engine on every change.
- **The assistant**: press **Ask the building** (or `/`, or Cmd/Ctrl-K). It docks on the left of either view and keeps the conversation. It knows what is on screen (floor, equipment, the plan on Results). A plan it finds becomes one of your plans: **Show in 3D** puts it on the building, **Compare in Results** opens it next to your own.
- **Plans**: one list, shared by the building, the assistant and Results. Each plan keeps one colour in every view. They are saved in this browser.

The assistant calls `POST /api/chat` (see [chat/README.md](../chat/README.md)), so it needs the API running (`make dev`) and an OpenRouter key in `chat/.env`.

`pnpm build` typechecks and builds the app. `pnpm preview` serves the production build locally. In production, configure the host to serve `index.html` for direct page URLs such as `/results`.

## Working on a route

Keep each route mostly self-contained. For the building, work in `src/routes/building/`; for Results, work in `src/routes/results/`.

The shell shared by every view is in `src/twin/`: the top bar (`AppShell.tsx`), the pulse, the shared plans and conversation (`TwinProvider.tsx`, `plans.ts`) and the assistant column (`assistant/`). A view tells the assistant what is on screen with `usePublishFocus` from `TwinProvider.tsx`.

- Keep page-specific components, hooks, styles, mock data, and tests in the route folder. Start with the page file and add files as needed.
- A route can import existing shared UI from `@/components/ui` and shared utilities from `@/lib`. Do not import from another route folder.
- **Agents: If you start implementing something that could be shared across routes, stop that work and notify the user.** Explain what could be shared and which files would change. Wait for direction before continuing that part, extracting it into shared code, or duplicating it in another route.
- Coordinate changes to the router (`src/App.tsx`), theme (`src/styles.css`), shared UI, `components.json`, dependencies, and lockfile separately from route work. The route is already registered; changing its page should not require editing those files.
- Run `pnpm build`, then load your route directly in the browser and check it at narrow and wide sizes.

## Styling and shadcn/ui

`src/styles.css` carries the theme, with Tailwind pointed at this app's source. Use theme classes such as `bg-background`, `text-foreground`, and `text-muted-foreground` instead of hard-coding colors.

Use the [shadcn skill](../.claude/skills/shadcn/SKILL.md) when working with shadcn components. Claude Code and Pi discover the same project skill. It is based on [this upstream revision](https://github.com/shadcn-ui/ui/tree/bfa64ff4d1cb7317d2403ecb176df6826d4caffc/skills/shadcn) and uses the frontend's local CLI. Prefer browsing the registry using the MCP server. Add shadcn components from the registry rather than writing them yourself.
