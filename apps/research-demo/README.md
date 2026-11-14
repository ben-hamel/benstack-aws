# Disposable receipt/research browser demo

Run from the repository root:

```bash
bun run demo:research
```

Open **http://127.0.0.1:4173/receipts** (use `127.0.0.1`, not `localhost`). No login
or database configuration is required. The demo creates a new in-memory PostgreSQL
instance, applies checked-in migrations only there, and starts a loopback API and
Vite frontend. It does not start the normal server, access AWS/S3, connect to
Neon/RDS, load personal worker credentials, or invoke models/search/page readers.

## Click through

1. In the yellow demo banner, click **Download demo receipt**.
2. On **Receipts**, click **Upload JSON** and choose `demo-receipts.json`.
3. Click **Product research**. Two explicitly fictional proposals appear.
4. Select SKU `900000000001`, check **Product name** and **Size (quoted)**, then
   **Approve selected fields**. Unknown fields cannot be selected.
5. Select SKU `900000000002`, enter a rejection reason, then **Reject proposal**.
6. Return to **Receipts** and expand the fictional warehouse receipt. The first
   item shows approved metadata and its original receipt description. The second
   keeps its original description. Prices remain $10.00 and $15.00, total $25.00.
7. **Reset demo** clears this disposable state. Stopping/restarting also clears it.

This is a UI/workflow demonstration, NOT real Costco evidence or product validation.
Names, item numbers, quotes, owner session and sources are fabricated. Synthetic
source URLs render as non-clickable text. The backend accepts only the exact
bundled fixture (array or `{ receipts: [...] }`); real/modified receipt data is
refused before persistence. The normal upload UI uses a local upload-slot endpoint,
not an AWS presigned URL. The actual shared import, queue, validation, approval,
audit and receipt-enrichment services still run against the in-memory database.

The launcher strips inherited settings except PATH/HOME/LANG/TERM. Its child uses
`bun --no-env-file`; Vite uses `configFile: false` and `envFile: false`. Frontend API
and demo flags are defined explicitly for the loopback origin. A backend fetch
guard blocks external destinations as defense in depth. This is trusted local demo
code, not a general OS/network sandbox. App and worker production defaults are not
enabled or changed by starting it.

Loopback is the default. To access from another device on your tailnet, bind to
this machine's specific Tailscale IPv4 address:

```bash
bun run demo:research -- --host 100.67.130.3
```

Then open `http://100.67.130.3:4173/receipts`. Public and wildcard bindings are
rejected. Anyone allowed to reach this port on your tailnet can use the fake-auth
demo; only use fictional data. The API stays on loopback behind Vite's proxy.

Alternatively, forward the port in a separate terminal on your own computer:

```bash
ssh -N -L 4173:127.0.0.1:4173 <your-dev-machine>
```

Then open the same `127.0.0.1` URL locally. For another local port:

```bash
bun run demo:research -- --port 4176
```

Do not deploy this fake-auth service or use it with real data. No demo module is
imported by the normal server, and the demo does not run under ordinary `bun run dev`.

## Verification

```bash
bun run --cwd apps/research-demo check-types
bun run --cwd apps/research-demo test
# One-time browser download; standard Playwright OS prerequisites also apply.
cd apps/research-demo && bun x --no-install playwright install chromium && cd ../..
bun run test:research-browser
```

The browser suite starts a separate disposable instance on port 4175; it will not
reuse a running server. Its three tests verify upload -> proposal -> selected
approval/rejection -> receipt display, blocked real inputs, sample download/reset,
no browser JS exceptions, and no external page requests. Screenshots/traces go to
ignored `apps/research-demo/test-results/`. Six API/environment tests cover fixture
restrictions, trusted origins, a local upload slot, duplicate reuse, reset, and
credential/environment stripping. These supplement, not replace, production auth,
native PostgreSQL, provider quality, network, backup and migration rehearsals.

### Minimal Fedora hosts

On this Fedora 44 cloud machine, Chromium's libraries/fonts were absent. Signed
Fedora RPMs were downloaded, signature-checked, and extracted **without sudo or
system installation** under `~/.cache/benstack-browser-libs/`. The Playwright config
automatically uses that cache's `root/usr/lib64` and `fonts.conf` when present, only
for its test browser. `RESEARCH_DEMO_BROWSER_LIB_DIR` can explicitly select another
library folder. None of those settings are passed to the demo API process.

Other machines need their own normal Playwright prerequisites; the cache is not
part of Git. On supported Ubuntu CI runners the browser job installs Playwright's
standard browser dependencies. You do not need a test browser installed to run
the demo and open it from your own computer's browser.
