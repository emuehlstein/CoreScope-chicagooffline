# CoreScope — Chicago Offline Fork

This is the chicagooffline.com deployment fork of [CoreScope](https://github.com/Kpa-clawbot/CoreScope), the MeshCore mesh network analyzer.

## Quick Links

- **Production:** https://scope.chicagooffline.com
- **Development:** https://dev-scope.chicagooffline.com
- **Landing:** https://chicagooffline.com
- **Health Check:** https://health.chicagooffline.com

## Branch Strategy

| Branch | Purpose | Deploys To | Stability |
|--------|---------|-----------|-----------|
| `master` | Upstream tracking (read-only) | — | Upstream |
| `deploy/chicagooffline-dev` | Development builds + Chicago customizations | dev-scope.chicagooffline.com | Testing |
| `deploy/chicagooffline-prod` | Production releases (promotion-only) | scope.chicagooffline.com | Stable |

### Promotion Path

```
upstream/master
    ↓ (merge + test)
deploy/chicagooffline-dev (dev-scope)
    ↓ (verify, then merge)
deploy/chicagooffline-prod (scope) [PROD]
```

**How to promote dev → prod:**
```bash
git checkout deploy/chicagooffline-prod
git pull origin deploy/chicagooffline-prod
git merge deploy/chicagooffline-dev
git push origin deploy/chicagooffline-prod
```

## Customizations

### Theme & Branding

**Files:**
- `public/chicagooffline-theme.css` — Chicago Offline color palette (Signal Cyan, Mesh Green, Beacon Amber)
- `public/map-layers.js` — Basemap layer catalog and configuration

**Colors:**
| Token | Hex | Usage |
|-------|-----|-------|
| Signal Cyan | `#00E5FF` | Primary accent, links |
| Beacon Amber | `#FFB300` | Alerts, CTAs |
| Mesh Green | `#39FF14` | Status, online nodes |
| Background | `#0C0F1A` | Dark mode base |

### UI Enhancements

1. **Theme Toggle** (`public/style.css`, `public/app.js`)
   - Bubble switch (sun/moon icons) instead of simple button
   - Persistent localStorage state

2. **Navigation** (`public/index.html`)
   - Reordered links: Map → Live → Channels → Nodes → Packets
   - Removed emojis from nav labels (Live 🔴 → Live)
   - Improved responsive display

3. **Google Analytics** (`public/index.html`)
   - Environment-specific GA4 tracking (dev vs prod)
   - `G-WKMJ5XBF62` (dev), `G-KX3PSRD0JT` (prod)

## Deployment

### Prerequisites

- SSH access to prod EC2 (`18.189.179.41`)
- Deploy credentials in `~/.ssh/chicagooffline-ec2.pem`
- Secrets configured in `chimesh-mqtt` Actions (GitHub)

### Automated Deploy (Recommended)

Deployment is triggered automatically by pushes to `chimesh-mqtt` branches:

```bash
cd ~/chimesh-mqtt
git checkout main                    # for dev
# or: git checkout prod             # for production

git pull origin <branch>
git push origin <branch>             # triggers GitHub Actions → EC2 deploy
```

The `deploy-compose.sh` script automatically selects:
- `deploy/chicagooffline-dev` when `ENVIRONMENT=dev`
- `deploy/chicagooffline-prod` when `ENVIRONMENT=production`

### Manual Deploy

If needed, SSH into the prod EC2 instance and run:

```bash
ssh -i ~/.ssh/chicagooffline-ec2.pem ubuntu@18.189.179.41

# On the EC2 instance:
cd ~/chimesh-mqtt
ENVIRONMENT=dev bash deploy-compose.sh      # Deploy dev
# or:
ENVIRONMENT=production bash deploy-compose.sh  # Deploy prod
```

## Syncing with Upstream

### When New Upstream Features Land

1. **On your local machine:**
   ```bash
   cd CoreScope-chicagooffline
   git fetch upstream
   git checkout deploy/chicagooffline-dev
   git merge upstream/master
   ```

2. **Resolve conflicts** (if any)
   - Chicago Offline customizations should override upstream on conflict
   - Files to watch: `public/index.html`, `public/style.css`, `public/app.js`

3. **Test locally** and on dev-scope, then **merge to prod:**
   ```bash
   git checkout deploy/chicagooffline-prod
   git merge deploy/chicagooffline-dev
   git push origin deploy/chicagooffline-prod
   ```

4. **Trigger deployment** via `chimesh-mqtt` push

## Contributors

### Core Team
- **Eric Muehlstein** (@emuehlstein) — Chicago Offline owner, infrastructure, deployment
- **Upstream:** [Kpa-clawbot](https://github.com/Kpa-clawbot/CoreScope) — CoreScope maintainer

### UI/UX
- **Jourdan** — Chicago Offline color system design

### MeshCore & Ecosystem
- **agessaman** — MeshCore protocol, upstream CoreScope contributions
- **yellowcooln** — meshcore-mqtt-live-map
- **Cisien** — meshcoretomqtt bridge

## File Structure

```
CoreScope-chicagooffline/
├── CHICAGOOFFLINE.md              # This file
├── public/
│   ├── chicagooffline-theme.css   # Brand theme (NEW)
│   ├── map-layers.js              # Basemap config (NEW)
│   ├── index.html                 # Title, GA, theme toggle (MODIFIED)
│   ├── style.css                  # Theme toggle CSS (MODIFIED)
│   ├── app.js                     # Theme persistence logic (MODIFIED)
│   └── ...                        # Upstream CoreScope files
├── docs/                          # Deployment, API, user guide
├── cmd/                           # Go backend (server, ingestor)
└── ...                            # Upstream CoreScope files
```

## Customization Guide

### Adding New Brand Colors

Edit `public/chicagooffline-theme.css`:

```css
:root {
  --co-cyan:      #00E5FF;  /* Update hex here */
  /* ... other colors */
}
```

### Updating Theme Toggle

Edit `public/style.css` (`.theme-toggle-*` rules) and `public/app.js` (toggle handler).

### Changing Navigation Links

Edit `public/index.html` (`.nav-links` section):

```html
<a href="#/map" class="nav-link" data-route="map" data-priority="high">Map</a>
```

Use `data-priority="high"` for always-visible links on mobile.

## Troubleshooting

### Dev-scope shows wrong version

1. Check branch: `git branch -vv` (should be on `deploy/chicagooffline-dev`)
2. Verify recent merge: `git log --oneline -5`
3. Check deployment status: Visit `https://github.com/emuehlstein/chimesh-mqtt/actions`

### Prod deploy failed

1. Check EC2 logs: `ssh -i ~/.ssh/chicagooffline-ec2.pem ubuntu@18.189.179.41 'docker compose logs corescope'`
2. Verify branch: Ensure `deploy/chicagooffline-prod` has the right commits
3. Re-trigger: Push to `chimesh-mqtt/prod` again

### Theme not applying

1. Clear browser cache (Cmd+Shift+R on macOS)
2. Check `public/chicagooffline-theme.css` is loaded (DevTools Network tab)
3. Verify CSS variables in DevTools: Inspect element → Computed

## License

CoreScope upstream is under its original license. Chicago Offline customizations are part of the chicagooffline.com project.

---

**Questions?** Open an issue on the [CoreScope upstream repo](https://github.com/Kpa-clawbot/CoreScope) or reach out to Eric.
