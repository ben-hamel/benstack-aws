# Local Setup

## Prerequisites

- [Bun](https://bun.sh)
- [AWS CLI](https://aws.amazon.com/cli/) — for deploying and accessing production resources
- [AWS Session Manager Plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) — required for production database access

## Getting started

Install dependencies:

```bash
bun install
```

Then start the dev server:

```bash
bun run dev
```

- Web: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3000](http://localhost:3000)
