# Varlock local environment experiment

This branch replaces `apps/server/.env` for local backend development. Values
are read from hidden custom fields on the Bitwarden Password Manager item
`benstack-aws development`.

## Tomorrow: authenticate and test

Varlock 1.17.1 and the Bitwarden plugin 2.0.1 are installed as backend
development dependencies. Install the official Bitwarden CLI, then log in once:

```sh
cd apps/server
bw login
```

From `apps/server`, validate the configuration. The first load will prompt to
unlock Bitwarden:

```sh
varlock load
```

Start the backend without creating an `.env` file:

```sh
varlock run -- bun run dev
```

No Bitwarden values should be printed or committed. The original worktree and
its ignored `apps/server/.env` are not modified by this experiment.
