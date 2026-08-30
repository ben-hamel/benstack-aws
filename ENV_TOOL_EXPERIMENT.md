# SecretSpec local environment experiment

This branch replaces `apps/server/.env` for local backend development. Values
are fetched from the Bitwarden Secrets Manager project
`Benstack AWS Development`; the personal Password Manager vault is not used.

## Prerequisites

- SecretSpec 0.19.1 or newer
- The official Bitwarden Secrets Manager CLI (`bws`) 0.3.0 or newer
- A read-only access token for the `Benstack AWS Local` machine account

The regular Bitwarden Password Manager CLI (`bw`) is not required.

## Authenticate and test

Provide the scoped machine-account token as `BWS_ACCESS_TOKEN` using a secure
credential source appropriate for the machine. Do not commit the token or pass
it as a command-line argument.

From `apps/server`, verify that every required value resolves:

```sh
secretspec check --profile development --no-prompt \
  --reason "Test local backend environment loading"
```

For the normal monorepo workflow, run the usual command from the repository
root:

```sh
bun dev
```

Turbo passes only `BWS_ACCESS_TOKEN` to the server task. SecretSpec invokes the
official `bws` CLI and loads secrets from the project declared in
`apps/server/secretspec.toml`; application secrets remain scoped to the backend
process.

No Bitwarden values should be printed or committed. The original worktree and
its ignored `apps/server/.env` are not modified by this experiment.
