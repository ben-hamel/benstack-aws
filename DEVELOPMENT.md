# Development

## Dev environments

Pick whichever works best for you:

- [Local](docs/local.md) — run directly on your host
- [Lima VM](docs/lima.md) — lightweight VM via Lima (macOS only)
- [Dev Container](docs/dev-container.md) — Docker-based container with VS Code Dev Containers

### Remote development with Rex

Forward both ports to the machine running your browser: `3001` for Vite and `3000` for the API. Keep the browser-side port numbers the same and open `http://localhost:3001` so it matches `CORS_ORIGIN`. The web app calls `http://localhost:3000` through the API forward; no direct connection to the VM's IP is needed.

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.
3. Apply the schema:

```bash
bun run db:push
```

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@benstack-aws/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
