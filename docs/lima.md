# Lima VM (macOS only)

## Prerequisites

```bash
brew install lima
```

## First-time setup

```bash
# Create and start the VM (run from repo root)
limactl create --name=benstack-aws ./.lima/default.ubuntu.yml && limactl start benstack-aws

# Run the install script inside the VM
limactl shell benstack-aws -- bash -c '~/install.sh'
```

## VS Code Remote SSH

Add this to the top of `~/.ssh/config` on your host:

```ssh-config
Include ~/.lima/*/ssh.config
```

Lima regenerates its SSH config on every start, so this stays current across rebuilds. The VM will appear as `lima-benstack-aws` in VS Code's Remote Explorer.

### Port forwarding

Lima automatically forwards guest ports to your Mac's localhost. When using VS Code Remote SSH, this causes conflicts — VS Code also tries to forward the same ports and auto-increments them (e.g. 3000 → 3001).

The config has a `portForwards` block that disables Lima's forwarding so VS Code can handle it exclusively:

```yaml
portForwards:
  - guestPortRange: [1, 65535]
    ignore: true
```

If you're working from the terminal instead of VS Code, comment this block out and restart the VM so Lima forwards ports directly to localhost.

To toggle this without a full rebuild, edit the live config directly and restart:

```bash
# Edit the live config
nano ~/.lima/benstack-aws/lima.yaml

# Then restart
limactl stop benstack-aws && limactl start benstack-aws
```

Just make sure to apply the same change to `.lima/ben.ubuntu.yml` in the repo so they stay in sync.

## Rebuild

```bash
limactl stop benstack-aws && limactl delete benstack-aws && limactl create --name=benstack-aws ./.lima/default.ubuntu.yml && limactl start benstack-aws
```

Then re-run the install script.
