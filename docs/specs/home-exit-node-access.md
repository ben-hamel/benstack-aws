# Restricted app access through a home Tailscale exit node

Status: Deferred proposal - not approved for implementation

## Goal

Restrict access to the deployed app to the owner's home internet connection, while allowing access when away by routing through a Tailscale exit node at home. Allow flexible testing with different application accounts without exposing public registration to the internet.

This is connection-based access control, not proof of an individual user's identity. Keep Better Auth for application authentication and authorization.

## Proposed approach

```text
At home:
Browser -> Home internet -> AWS app

Away:
Browser -> Tailscale -> Home exit node -> Home internet -> AWS app

AWS allows the home public egress IP and rejects other sources.
```

- Run a Tailscale exit node on an existing, always-on home device (supported computer, Raspberry Pi, NAS, etc.).
- Restrict permission to use that exit node to the owner's intended Tailscale identity/devices. Review existing tailnet policy rather than assuming membership alone is sufficient.
- While away, select the home exit node on the client device.
- Enforce a default-deny IP policy for both the deployed frontend and backend.
- Use the home **public internet IP**, not a Tailscale `100.x.x.x` IP, in AWS restrictions.
- Do not use Tailscale Funnel; it publishes services to the internet.

No AWS EC2 instance is required for the home exit node. This proposal is not the AWS subnet-router/private-VPC architecture discussed as an alternative.

## Existing application context

Repository configuration inspected during discussion:

- Region: `us-east-1`.
- Frontend: S3 behind CloudFront (`infra/s3.tf`).
- Backend mode: `serverless` (`infra/terraform.tfvars`), using API Gateway HTTP API and Lambda (`infra/modules/hono-serverless-api/`).
- Better Auth runs in the application, with a Drizzle/Postgres adapter (`packages/auth/src/index.ts`).
- Custom auth behavior includes an email signup allowlist, automatic organization/owner membership creation, and active organization selection during session creation.

These observations describe repository configuration, not verified live infrastructure. Recheck before implementation.

## Security requirements

1. Protect both frontend content and all backend routes, including signup and other auth endpoints.
2. Inventory every alternative entry point: CloudFront distribution hostnames, API Gateway default hostnames, custom domains, Lambda URLs if present, and S3 access.
3. Ensure no direct origin or alternative hostname bypasses the restriction. A hidden DNS name is not a security boundary.
4. Enforce source IP using trusted platform-derived information. Do not trust arbitrary client-supplied forwarding headers.
5. Review IPv4 and IPv6 separately. Prevent unintended IPv6 bypasses or unexpected lockouts.
6. Anyone sharing the allowed home public IP can reach the app. Better Auth remains required; do not replace app permissions with IP restrictions.
7. Leave the signup allowlist intact until access restrictions are implemented and verified. Any later change to signup policy is a separate reviewed step.
8. Keep organization isolation, admin permissions, and custom signup/session behavior intact.
9. Identify required exceptions for webhooks, CI, monitoring, OAuth callbacks, and other machine clients. Avoid broad exceptions that reopen the app.
10. Review caching and browser/service-worker storage: already downloaded content cannot be recalled by an IP rule. Test denied network access independently of cached pages.

## Design work required before implementation

The enforcement mechanism is intentionally undecided. A home exit node does not itself protect AWS endpoints.

- Confirm the current deployed architecture and active hostnames.
- Verify current AWS documentation for supported controls on CloudFront and **API Gateway HTTP API**, rather than assuming REST API features apply.
- Compare frontend edge filtering options and backend enforcement options, their bypass resistance, operational complexity, and cost.
- Decide whether existing endpoints can be restricted independently or whether a protected shared ingress is preferable.
- Validate how the backend obtains the actual viewer source IP, especially if CloudFront or another proxy is introduced.
- Determine whether the home connection has a stable public IPv4 address, dynamic addressing, CGNAT, or IPv6 requirements.
- Choose a manual or authenticated automated allowlist update process for IP changes. Do not expose an unauthenticated update endpoint.
- Identify the exit-node device and review uptime, OS support, patching, Tailscale permissions, and client routing behavior.
- Retain infrastructure-as-code (existing Terraform workflow). Review changes and costs before deploying.

## Costs

- No additional AWS compute is needed solely for the VPN if the exit node runs at home.
- Home costs include device power and internet usage; performance depends on the home connection and device.
- Check eligibility and current terms for the intended Tailscale plan.
- AWS access-control components, request processing, logging, and any architectural changes may add charges. Produce an itemized estimate after choosing the enforcement design.
- Do not assume an AWS WAF deployment is free or compatible with every endpoint type.
- Avoid adding EC2, a NAT Gateway, or an AWS VPN just to follow a generic tutorial; those belong to a different design.

## Operational limitations

- Away-from-home access depends on the exit node, home internet, and Tailscale being available.
- If the home public IP changes, access remains denied until the allowlist is updated.
- A phone or laptop not using the exit node while away should be denied.
- Access through the home connection does not distinguish among home users/devices.
- The public AWS endpoints may remain internet-addressable but reject unauthorized requests. This is not the same as removing public endpoints entirely.
- Retain AWS control-plane access for recovery even when the application's network policy blocks the owner.

## Suggested future rollout

1. Review architecture, supported enforcement options, and pricing; obtain approval.
2. Configure the home exit node and restricted Tailscale policy.
3. Verify the observed public egress IP at home and while using the exit node remotely.
4. Implement AWS restrictions through reviewed infrastructure-as-code, with an explicit rollback plan.
5. Run the acceptance tests below before changing signup rules.
6. Separately decide whether production registration should be open to reachable clients, invite-only, or admin-provisioned. Test accounts should preferably use a separate test database/branch.
7. Document IP updates, recovery, monitoring, and maintenance.

## Acceptance tests

- Home connection can load the frontend, authenticate, and call protected APIs.
- An external connection without the exit node cannot fetch the app or call its APIs, including signup.
- An external connection using the authorized home exit node can use the app.
- A tailnet device without the required grant cannot use the home exit node.
- Direct API/default hostnames and direct S3/origin access cannot bypass restrictions.
- IPv6 does not bypass restrictions; permitted client routing behaves as designed.
- Switching the exit node off blocks subsequent uncached network requests from an external connection.
- Required integrations still function under explicitly documented rules.
- Existing authentication, organization boundaries, and admin permissions remain correct.
- IP change and lockout recovery procedures are tested.

## References

- AWS subnet-router architecture (alternative, not the proposed home exit-node design): https://tailscale.com/docs/install/cloud/aws
- Tailscale exit nodes: https://tailscale.com/kb/1103/exit-nodes
- Tailscale access controls: https://tailscale.com/docs/features/access-control

## Non-goals

- Implementing or deploying this proposal now.
- Migrating to Neon's managed Better Auth.
- Removing application authentication or authorization.
- Creating an AWS gateway or redesigning the app as a private VPC service without further approval.
