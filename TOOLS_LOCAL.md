# Local deployment (nyx server) — beta channel
- Managed by Nyx; deploy script: `~/deploy/smt-beta.sh [branch]` (fetch, build, docker rebuild, restart)
- Container: `smt-beta` (nginx:alpine, 127.0.0.1:8081), image `smt-beta-image`
- Tailnet URL: http://nyx-rg3jpx6w.internal.0jm.de/ (tailscale serve → 8081)
- Note: `tailscale serve --https` not available on this tailnet (feature not enabled); plain HTTP inside tailnet only
