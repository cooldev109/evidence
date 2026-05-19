# EVIDENCE — Deployment Guide

Deploy the M1 + M2 backend on any Linux VPS with Docker. The target throughout this guide is the Hostinger VPS at `177.7.51.251` — replace it with yours if different.

The repo ships with a `Dockerfile` and an `infra/docker/docker-compose.prod.yml` that bring up the full stack (Postgres + API + Caddy reverse proxy with auto-HTTPS) in one command.

> **HTTPS / domain note.** Browser-trusted HTTPS needs a real domain — Let's Encrypt does not issue for raw IPs. You can deploy now in HTTP at the IP, then point a domain at the VPS later. The Caddy config switches to HTTPS automatically by changing one env var (`DOMAIN`) and restarting Caddy. No re-deploy.

---

## 0. Prerequisites

- A Hostinger KVM 2 (or bigger) VPS with **Ubuntu 22.04 or 24.04**.
- Root SSH access (Hostinger emails the password when the VPS is provisioned).
- The repo: `https://github.com/cooldev109/evidence` on `main`.

From your laptop:

```bash
ssh root@177.7.51.251
```

After login, change the root password and (recommended) add your SSH public key:

```bash
passwd
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "ssh-ed25519 AAAA..."  >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Everything below runs **on the VPS** unless marked otherwise.

---

## 1. Install Docker

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw

# Docker Engine + Compose plugin (official install script)
curl -fsSL https://get.docker.com | sh

# Verify
docker --version           # 27.x or newer
docker compose version     # v2.x

# Optional: run docker as a non-root user
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
```

---

## 2. Clone the repo and configure secrets

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/cooldev109/evidence.git
cd evidence

cat > .env <<EOF
# ---- Postgres ----
POSTGRES_USER=evidence
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=evidence

# ---- API ----
LOG_LEVEL=info
WEBHOOK_HMAC_SECRET=$(openssl rand -hex 32)

# ---- Storage ----
STORAGE_BACKEND=local
RETAIN_MODE=governance
RETAIN_YEARS=5

# ---- TSA ----
TSA_DEFAULT_PROVIDER=mock
TSA_BR_PROVIDER=mock
TSA_EU_PROVIDER=mock
TSA_US_PROVIDER=mock

# ---- Reverse proxy ----
# Use :80 while you only have an IP. Switch to your domain
# (e.g. api.empresa.com.br) to enable auto-HTTPS via Let's Encrypt.
DOMAIN=:80
EOF
chmod 600 .env
```

> **Production checklist:**
> - `RETAIN_MODE=compliance` only after the client signs off (irreversible on real S3 Object Lock).
> - Replace mock TSA providers with `freetsa` (for dev) or jurisdiction-accredited TSAs (for prod).

---

## 3. Build and start the stack

```bash
cd /opt/evidence

# Build the API image and bring up everything in the background
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env up -d --build

# Watch it boot
docker compose -f infra/docker/docker-compose.prod.yml logs -f
# Ctrl-C to detach (containers keep running)
```

The first build downloads Node + pnpm dependencies and takes ~2–4 min. Subsequent builds are much faster (cached).

---

## 4. Run migrations

```bash
docker compose -f infra/docker/docker-compose.prod.yml exec api \
  pnpm --filter @evidence/api db:migrate
# expect: [migrate] applied: 0000_init.sql, 0001_tsa_storage.sql
```

---

## 5. Open the firewall

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443       # ready for HTTPS when you add a domain
ufw --force enable
ufw status
```

---

## 6. Smoke test

From your **laptop**:

```bash
curl http://177.7.51.251/health
# {"status":"ok","db":"ok"}
```

Seed a tenant on the VPS and run a full event flow:

```bash
# on the VPS
docker compose -f infra/docker/docker-compose.prod.yml exec api \
  pnpm --filter @evidence/api db:seed
# copy the printed "key" line

# back on your laptop
KEY="evk_..."
curl -X POST http://177.7.51.251/v1/events \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"source":"app","payload":{"hello":"production"}}'

curl http://177.7.51.251/v1/verify -H "Authorization: Bearer $KEY"
# {"result":{"ok":true,"verified":1},"range":{"fromSeq":1,"toSeq":null}}
```

If you see that, deployment is live.

---

## 7. Enable HTTPS once a domain is pointed here

When the client registers a domain and adds an `A` record pointing it at `177.7.51.251`:

```bash
cd /opt/evidence
sed -i 's/^DOMAIN=.*/DOMAIN=api.empresa.com.br/' .env   # adjust to the real domain
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env up -d
```

Caddy auto-provisions a Let's Encrypt certificate on the first inbound request. HTTPS is live within ~30 seconds. No re-build, no downtime beyond the Caddy restart.

---

## 8. Day-to-day operations

```bash
# Tail logs
docker compose -f infra/docker/docker-compose.prod.yml logs -f api
docker compose -f infra/docker/docker-compose.prod.yml logs -f caddy

# Restart after env changes
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env up -d

# Pull new code and re-deploy
cd /opt/evidence
git pull
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env up -d --build
docker compose -f infra/docker/docker-compose.prod.yml exec api \
  pnpm --filter @evidence/api db:migrate

# Stop everything (data volumes persist)
docker compose -f infra/docker/docker-compose.prod.yml down

# Stop everything AND delete data (destructive — don't use in production)
docker compose -f infra/docker/docker-compose.prod.yml down -v
```

### Daily Postgres backup

```bash
mkdir -p /var/backups/evidence

cat > /etc/cron.daily/evidence-pgdump <<'EOF'
#!/bin/bash
set -e
TS=$(date +%Y%m%d-%H%M%S)
docker exec evidence-postgres pg_dump -U evidence -Fc evidence \
  > /var/backups/evidence/evidence-$TS.dump
find /var/backups/evidence -type f -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/evidence-pgdump
```

This keeps 14 daily snapshots. **Copy them off the VPS** before going production (rclone to an S3-compatible bucket, scp to another server, whatever fits).

### Evidence store backup

The `evidence-store` volume holds the canonical envelopes. Until we migrate to an Object-Lock-enabled S3-compatible bucket, back it up the same way:

```bash
docker run --rm \
  -v evidence_evidence-store:/data:ro \
  -v /var/backups/evidence:/backup \
  alpine tar czf /backup/evidence-store-$(date +%Y%m%d).tgz -C /data .
```

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `docker compose up` errors `POSTGRES_PASSWORD is required` | `.env` missing or not loaded | Ensure you pass `--env-file .env` |
| API container restart-loops | DB unreachable or migration not run | `docker compose logs api`; run the migration step |
| `curl http://IP/health` times out | UFW blocking port 80 | `ufw allow 80 && ufw reload` |
| 502 from Caddy | API container down | `docker compose ps`; `docker compose logs api` |
| Slow first build | Normal | Subsequent builds use cache. Allow ~3 min on first deploy. |

---

## 10. Production checklist before go-live

- [ ] `POSTGRES_PASSWORD` is unique, stored in a password manager, not in git.
- [ ] `WEBHOOK_HMAC_SECRET` is a unique 32-byte hex string per environment.
- [ ] `RETAIN_MODE=compliance` flipped on (only after client sign-off — Compliance mode is irreversible on real S3 Object Lock).
- [ ] At least one production TSA configured (`TSA_BR_PROVIDER=icp-brasil` once credentials are in place).
- [ ] Daily Postgres backup confirmed running and **copied off-VPS**.
- [ ] Evidence store backed up off-VPS (or already migrated to an Object-Lock-enabled S3-compatible bucket).
- [ ] A real domain is pointed at the VPS and HTTPS is active.
- [ ] Monitoring/alerting in place hitting `/health` (Uptime Kuma, Better Uptime, or similar).
- [ ] `ufw` enabled with only 22, 80, 443 open.
- [ ] SSH password authentication disabled (`PasswordAuthentication no` in `/etc/ssh/sshd_config`), key-only access.

---

## Appendix — bare-metal alternative (no Docker)

If for some reason you cannot or do not want to use Docker on the VPS (e.g., minimal-RAM plan, ops policy), the previous version of this guide installed Node + pnpm + Postgres + Caddy directly with `apt` and ran the API via `systemd`. That path is documented in commit history if you ever need it; the Docker path above is the recommended one going forward.
