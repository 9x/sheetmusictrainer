# Local deployment (nyx server) — beta channel (tracks main = production state by default)
- Managed by Nyx; deploy script: `~/deploy/smt-beta.sh [branch]` (fetch, build, docker rebuild, restart; **default branch: main**)
- Container: `smt-beta` (nginx:alpine, 127.0.0.1:8081 **and** tailnet IP 100.64.0.4:8081), image `smt-beta-image`
- Tailnet URLs:
  - http://nyx-rg3jpx6w.internal.0jm.de/ (tailscale serve → 8081; needs MagicDNS; Chrome history may autocomplete a broken https:// variant — delete it from history)
  - **http://100.64.0.4:8081/ (preferred: Chrome never HTTPS-upgrades IP:port URLs, no MagicDNS needed)**
- Note: `tailscale serve --https` not available on this tailnet (feature not enabled); plain HTTP inside tailnet only
