# Development

## Dev environments

Pick whichever works best for you:

- [Local](docs/local.md) — run directly on your host
- [Lima VM](docs/lima.md) — lightweight VM via Lima (macOS only)
- [Dev Container](docs/dev-container.md) — Docker-based container with VS Code Dev Containers

## Local secrets

Backend development secrets are stored in the Bitwarden Secrets Manager project
`Benstack AWS Development` and loaded through Varlock. Each development machine
should use its own access token so that access can be revoked per device.

1. In Bitwarden Secrets Manager, create an access token for the machine account
   `Benstack AWS Local`. Give the token a name that identifies this device.
2. Create the ignored file `apps/server/.env.local` with this placeholder:

   ```dotenv
   BITWARDEN_ACCESS_TOKEN=varlock(prompt)
   ```

3. From the repository root, initialize the token:

   ```bash
   bun secrets:init
   ```

4. Paste the access token into Varlock's hidden prompt. Varlock replaces the
   placeholder with a device-encrypted value; do not paste the plaintext token
   directly into the file.

After this one-time setup, start the monorepo normally from its root with
`bun dev`. Application secrets are fetched from the assigned Bitwarden project;
the machine token does not grant access to the personal Password Manager vault.

Varlock and Bitwarden are used only for local backend development. Production
builds do not load the Bitwarden-backed schema. In AWS, ECS and Lambda receive
their configuration from SSM Parameter Store through IAM-scoped infrastructure.

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Add the database connection secret to the Bitwarden Secrets Manager project.
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
- `bun run db:prod`: Connect to the production RDS database via ECS Exec (requires AWS CLI + Session Manager plugin)
