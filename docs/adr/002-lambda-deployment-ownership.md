# ADR 002: Lambda Deployment Ownership

- Status: Proposed
- Date: 2026-09-01
- Codex session title: Run safe Terraform plan
- Codex session ID: `01a05a77-9091-7d21-b566-586bae5d838f`

## Context

Terraform manages the three Lambda functions in this repository and sets each
function's `source_code_hash` from a locally generated ZIP archive. GitHub
Actions also builds ZIP archives and deploys them directly with
`aws lambda update-function-code`.

The overlapping ownership causes Terraform to propose Lambda code updates after
GitHub Actions has deployed the application. A plan observed the following:

```text
Plan: 0 to add, 3 to change, 0 to destroy.
```

The affected functions were:

- `benstack-api`
- `benstack-receipt-processor`
- `benstack-receipt-processor-serverless`

## Investigation

Repeated local builds produced identical JavaScript and ZIP hashes. The local
build is reproducible and does not create a perpetual diff by itself.

Read-only downloads of the deployed Lambda packages showed that their internal
JavaScript differs from the current local build:

| Artifact | Deployed size | Local size |
| --- | ---: | ---: |
| Receipt processor `index.js` | 1,829,207 bytes | 1,826,866 bytes |
| API `index.mjs` | 6,054,280 bytes | 6,096,711 bytes |

Two deployment paths currently package code differently:

- Terraform uses the `hashicorp/archive` provider, which normalizes ZIP
  metadata.
- GitHub Actions uses the system `zip` command and deploys directly through the
  AWS CLI.

The workflows also request `bun-version: latest`, while this repository pins
Bun 1.3.9 in `mise.toml`. Differences in Bun versions or build environments can
change compiled bundles, while different ZIP tools can change the outer archive
hash even when file contents match.

## Options

### 1. GitHub Actions owns Lambda code

Terraform owns function configuration, IAM, networking, environment variables,
logging, triggers, and permissions. GitHub Actions owns application builds and
code deployments.

This is the recommended option for this repository because application code is
deployed more frequently than infrastructure.

Implementation considerations:

- Tell Terraform not to reconcile Lambda code changes made by the deployment
  workflows.
- Remove unnecessary application build requirements from ordinary Terraform
  plans where practical.
- Pin GitHub Actions to Bun 1.3.9 instead of `latest`.
- Use a consistent and reproducible packaging process in CI.
- Preserve a bootstrap artifact or another explicit process for creating a new
  Lambda function before its first application deployment.

### 2. Terraform owns Lambda infrastructure and code

GitHub Actions builds the artifacts and performs a Terraform plan and apply.
Direct `aws lambda update-function-code` calls are removed.

This creates a single owner but couples routine code deployments to Terraform
state, locking, infrastructure variables, and apply permissions.

## Proposed Decision

Adopt option 1: GitHub Actions owns Lambda application code and Terraform owns
Lambda infrastructure.

This document remains `Proposed` until the Terraform lifecycle behavior and CI
workflow changes are implemented and reviewed.

## Implementation Plan

1. Pin Bun 1.3.9 in both Lambda deployment workflows.
2. Define the Terraform lifecycle boundary for all three Lambda functions so
   external code deployments do not produce infrastructure drift.
3. Decide how Terraform will bootstrap newly created functions without making
   every plan depend on current production bundles.
4. Make local and CI packaging deterministic and use one packaging approach.
5. Run formatting, validation, TFLint, and a full AWS-backed Terraform plan.
6. Deploy application code through GitHub Actions.
7. Run another Terraform plan and confirm it reports no Lambda code changes.

## Verification Criteria

- Unchanged source produces identical artifacts across repeated builds.
- GitHub Actions uses a pinned Bun version.
- A GitHub Actions code deployment does not cause a subsequent Terraform plan
  to propose Lambda code updates.
- Terraform continues detecting changes to Lambda infrastructure and
  configuration.
- Terraform reports no unexpected additions, replacements, or deletions.

## Returning to the Conversation

Copy and run:

```bash
codex resume 01a05a77-9091-7d21-b566-586bae5d838f
```

Alternatively, run `codex resume` and select **Run safe Terraform plan** from
the session picker.

Continue from the proposed decision and implementation plan above.
