# Varlock local environment experiment

This branch replaces plaintext local backend variables with values fetched from
Bitwarden Secrets Manager. It does not grant the application access to the
personal Bitwarden Password Manager vault.

## Bitwarden layout

- Organization: `Hamel Tech`
- Project: `Benstack AWS Development`
- Machine account: `Benstack AWS Local`
- Permission: `Can read` on `Benstack AWS Development`
- Access tokens: one separately revocable token per development machine

The committed `apps/server/.env.schema` references each Secrets Manager secret
by UUID. Those identifiers are safe to commit; secret values are not.

## Set up a development machine

Create a unique access token under the `Benstack AWS Local` machine account.
Name it after the device so it can be revoked independently.

Create the ignored `apps/server/.env.local` yourself with this placeholder:

```dotenv
BITWARDEN_ACCESS_TOKEN=varlock(prompt)
```

From the repository root, validate the configuration:

```sh
bun secrets:init
```

Paste the access token only into Varlock's hidden prompt. Varlock replaces the
placeholder with a locally encrypted value. The token is typed as
`bitwardenAccessToken`, which is internal by default and is not injected into
the application.

After setup, start the entire monorepo normally from its root:

```sh
bun dev
```

The Bitwarden Password Manager CLI is not required for this setup. No raw token
or secret value should be printed, committed, or passed on a command line.

## Production boundary

The backend development script explicitly runs through Varlock. Production
builds do not load the Bitwarden-backed schema, and no Bitwarden machine token
is provided to CI, ECS, or Lambda. AWS supplies production configuration from
SSM Parameter Store using IAM roles, and the application's runtime environment
schema continues to validate those injected values.
