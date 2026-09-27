# Deploying RagPilot to a VPS

One Ubuntu 22.04/24.04 VPS runs everything. Docker Compose runs Postgres (pgvector), the FastAPI API and the Next.js frontend. nginx on the host terminates TLS and proxies to them:

| Path | Upstream |
| --- | --- |
| `/api/`, `/health`, `/version`, `/docs`, `/openapi.json` | FastAPI, `127.0.0.1:4000` |
| everything else | Next.js, `127.0.0.1:3000` |

The frontend and the API share one origin: `https://rag.umairamir.com`.

## 1. DNS

At the DNS provider for `umairamir.com`, add an **A record**: `rag` pointing to the VPS IPv4 address. If the VPS has IPv6, also add an **AAAA** record. Check that it resolves:

```sh
dig +short rag.umairamir.com
```

## 2. Install Docker, nginx and certbot

```sh
sudo apt update && sudo apt install -y ca-certificates curl git nginx certbot python3-certbot-nginx
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

The containers publish their ports on `127.0.0.1` only, so they are not reachable from outside.

## 3. Clone and configure

```sh
sudo mkdir -p /opt/ragpilot && sudo chown $USER /opt/ragpilot
git clone <repo-url> /opt/ragpilot && cd /opt/ragpilot
cp backend/.env.example backend/.env
nano backend/.env
```

In `backend/.env`, set at least these values:

- `AUTH_SECRET`: generate it with `python3 -c "import secrets;print(secrets.token_urlsafe(48))"`
- `APP_URL=https://rag.umairamir.com` and `API_URL=https://rag.umairamir.com`
- `OPENAI_API_KEY` (plus `OPENAI_BASE_URL` / models if you use another provider)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (see step 6)
- one email transport (`RESEND_API_KEY`, or `GMAIL_*`, or `SMTP_*`) and `EMAIL_FROM`
- `ADMIN_EMAILS`

Compose sets `DATABASE_URL` itself. To change the database password (recommended), create `/opt/ragpilot/.env` next to `docker-compose.yml`:

```sh
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
```

## 4. Start the stack

```sh
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:4000/health
curl -sI http://127.0.0.1:3000 | head -1
```

The API container runs `alembic upgrade head` on every start, before it launches uvicorn. Logs: `docker compose logs -f api`.

## 5. nginx and TLS

```sh
sudo cp deploy/nginx/connection-upgrade.conf /etc/nginx/conf.d/
sudo cp deploy/nginx/rag.umairamir.com.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/rag.umairamir.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d rag.umairamir.com --redirect -m you@example.com --agree-tos
```

certbot edits the site file to add HTTPS and the HTTP→HTTPS redirect, and it installs an auto-renew timer (check it with `sudo certbot renew --dry-run`).

## 6. Google OAuth

In Google Cloud Console, go to APIs & Services → Credentials → your OAuth client (type "Web application"):

- Authorized JavaScript origin: `https://rag.umairamir.com`
- Authorized redirect URI: `https://rag.umairamir.com/api/auth/callback/google`

Copy the client ID and secret into `backend/.env`, then run `docker compose up -d api`.

## Updating

```sh
cd /opt/ragpilot
git pull
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
docker image prune -f
```

Migrations run automatically when the new API container starts. If you change `NEXT_PUBLIC_*` values, the `web` image has to be rebuilt, because they are baked in at build time.

## Backups

```sh
docker compose exec -T db pg_dump -U ragpilot ragpilot | gzip > ragpilot-$(date +%F).sql.gz
```
