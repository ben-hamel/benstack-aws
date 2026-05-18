# Dev Container

A dev container config is provided in `.devcontainer/`. It uses the official Bun image and includes Node, Docker-in-Docker, and Claude Code.

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/)
- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

## Getting started

Open the project in VS Code and click **Reopen in Container** when prompted, or run:

```
Dev Containers: Reopen in Container
```

from the command palette. VS Code will build the container and install all dependencies automatically.

Ports `3000`, `5173`, and `5432` are forwarded to your host automatically.
