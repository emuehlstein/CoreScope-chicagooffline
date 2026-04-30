# CoreScope — Chicago Offline Fork

This is the [chicagooffline.com](https://chicagooffline.com) fork of [CoreScope](https://github.com/Kpa-clawbot/CoreScope), the MeshCore mesh network analyzer.

## What This Fork Is For

- **Chicagoland-specific tweaks** to CoreScope for the Chicago mesh community
- **Feature development** in clean branches that can be:
  - Deployed to `dev-scope.chicagooffline.com` for testing
  - Promoted to `scope.chicagooffline.com` for production
  - Submitted as PRs upstream to `Kpa-clawbot/CoreScope` if useful to the broader community

## Source-Level IATA Filtering

CoreScope supports per-source `iataFilter` in `mqttSources[]`. This lets you ingest traffic from brokers that carry multiple regions (e.g. ChiMesh) while only storing packets from Chicagoland regions.

```json
{
  "mqttSources": [
    {
      "name": "chicagooffline",
      "url": "mqtt://mqtt.chicagooffline.com:1883",
      "topics": ["meshcore/ORD/#"],
      "iataFilter": ["ORD"]
    },
    {
      "name": "chimesh",
      "url": "mqtt://mqtt.chimesh.org:1883",
      "topics": ["meshcore/#"],
      "iataFilter": ["ORD"]
    }
  ]
}
```

Packets from any IATA code not in `iataFilter` are silently dropped by the ingestor before storage. If `iataFilter` is omitted, all regions are accepted. See `config.chicagooffline.example.json` for a full Chicago-specific config example.

**Status messages** are never dropped by the IATA filter (needed for node heartbeat/offline detection).

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `master` | Synced with upstream — **never commit directly** |
| `deploy/chicagooffline` | Deployment branch for chicagooffline.com (merges from master + feature branches) |
| `feature/*` | Individual features, branched from `master`, kept PR-ready for upstream |

## Quick Start (dev-scope)

```bash
# On the chicagooffline EC2 instance:
git clone git@github.com:emuehlstein/CoreScope-chicagooffline.git
cd CoreScope-chicagooffline
git checkout deploy/chicagooffline

# Build and run (external Caddy handles TLS/routing)
docker compose -f docker-compose.chicagooffline.yml build
docker compose -f docker-compose.chicagooffline.yml up -d
```

The container joins the `chicagooffline-net` Docker network. The existing external Caddy routes `dev-scope.chicagooffline.com` → `corescope-dev:3000`.

## Syncing with Upstream

```bash
git fetch upstream
git checkout master
git merge upstream/master
git push origin master

# Then update deploy branch
git checkout deploy/chicagooffline
git merge master
git push origin deploy/chicagooffline
```

## Contributing Features

1. Branch from `master`: `git checkout -b feature/my-feature master`
2. Develop and test locally or on dev-scope
3. When ready for chicagooffline: merge into `deploy/chicagooffline`
4. When ready for upstream: open PR against `Kpa-clawbot/CoreScope:master`

## Architecture

- **EC2 Instance:** `13.58.181.117` (us-east-2)
- **External Caddy** handles TLS for all `*.chicagooffline.com` vhosts
- **corescope** (prod) runs upstream GHCR image → `scope.chicagooffline.com`
- **corescope-dev** (this fork) → `dev-scope.chicagooffline.com`
- **MQTT broker** on port 1883 (shared by prod + dev via `host.docker.internal`)
- **Mesh Health Check** → `health.chicagooffline.com`
