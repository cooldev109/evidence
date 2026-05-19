# Postman Collection — Milestone 1

A ready-to-import Postman collection for testing every M1 endpoint in the browser (or the desktop app).

## Quickstart

1. **Get Postman.** Either:
   - Web app: https://web.postman.co (sign up free, runs in browser, install the Postman Desktop Agent when prompted so it can reach `localhost`).
   - Desktop app: https://www.postman.com/downloads (Linux, macOS, Windows).

2. **Import the collection.** In Postman, click **Import** → drop in `evidence-m1.postman_collection.json` from this folder.

3. **Start the API** (in your terminal):
   ```bash
   cd /root/projects/evidence
   DATABASE_URL=postgres://evidence:evidence@localhost:5432/evidence pnpm api:dev
   ```

4. **Seed a tenant and grab a key** (in another terminal):
   ```bash
   DATABASE_URL=postgres://evidence:evidence@localhost:5432/evidence \
     pnpm --filter @evidence/api db:seed
   ```

5. **Paste the key into the collection.** In Postman, open the `EVIDENCE — Milestone 1` collection, go to **Variables**, set `api_key` to the value printed by the seed script (starts with `evk_`). Save.

6. **Click through the requests in order.** Each request has built-in tests (the green checkmarks) and the first POST stores the event id + chainHash into collection variables so the linkage check on request #2 works automatically.

## What's in the collection

| # | Request | Tests / Notes |
|---|---------|---------------|
| 0 | `GET /health` | no auth |
| 1 | `POST /v1/events` (genesis) | asserts seq=1, prevHash=64 zeros; saves chainHash |
| 2 | `POST /v1/events` (linked) | asserts seq=2, prevHash == chain_hash_1 |
| 3 | `GET /v1/events/:id` | uses event id captured in #1 |
| 4 | `GET /v1/events/<unknown>` | asserts 404 |
| 5 | `GET /v1/events?limit=10` | list / pagination |
| 6 | `GET /v1/chain?fromSeq=1&toSeq=2` | range query |
| 7 | `GET /v1/verify` | asserts result.ok=true |
| 8 | `POST /v1/events` with externalId | run twice: first 201, second 200 + idempotent=true |
| 9 | `POST /v1/webhooks/stripe` (HMAC) | pre-request script computes the signature |
| 10 | `POST /v1/webhooks/stripe` bad sig | asserts 401 |
| 11 | `POST /v1/events` no auth | asserts 401 |
| 12 | `POST /v1/events` bad key | asserts 401 |

## Tamper-detection demo (a bit manual)

The chain integrity check is the most demonstrative thing in M1. After running requests 1, 2, 7:

```bash
# Mutate seq=1 directly in Postgres
sudo -u postgres psql evidence -c \
  "UPDATE events SET payload='{\"action\":\"HACKED\"}'::jsonb WHERE seq=1"
```

Re-run request **7 — GET /v1/verify** in Postman. You should now see:

```json
{
  "result": {
    "ok": false,
    "reason": "hash-mismatch",
    "atSeq": 1,
    "detail": "..."
  }
}
```

That's the cryptographic chain catching the tampering.

## CORS note

If you use Postman's **web** app (not the desktop app), `localhost` requests require the **Postman Desktop Agent** to be installed and running. Postman prompts you to install it on first use. The desktop app talks to `localhost` directly without it.
