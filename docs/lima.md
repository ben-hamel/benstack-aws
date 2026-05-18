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

## Rebuild

```bash
limactl stop benstack-aws && limactl delete benstack-aws && limactl create --name=benstack-aws ./.lima/default.ubuntu.yml && limactl start benstack-aws
```

Then re-run the install script.
