# Hosted deployment profile

`docker-compose.hosted.yml` is an opt-in hardening overlay for a private
single-tenant or early hosted pilot. It includes the static consumer cockpit,
API, and private worker. It does not create a cloud VM or public
authentication layer by itself.

## Start

Set `ORCHA_WORKER_AUTH_TOKEN` in the deployment environment or an ignored
Compose `.env` file, then validate and start the stack:

```powershell
$env:ORCHA_WORKER_AUTH_TOKEN = '<high-entropy-secret>'
docker compose -f infra/docker-compose.yml -f infra/docker-compose.hosted.yml config --quiet
docker compose -f infra/docker-compose.yml -f infra/docker-compose.hosted.yml up --build -d
```

The same workflow can be run through the scoped PowerShell wrapper:

```powershell
.\scripts\start-orcha-hosted.ps1 -EnvironmentFile .env
.\scripts\stop-orcha-hosted.ps1 -EnvironmentFile .env
```

The start wrapper checks Docker Engine, validates the merged Compose profile
without printing resolved values, starts the services, and waits for both the
cockpit and `/health/ready`. The stop wrapper runs `down` only; it retains the
named database, feedback, and workspace volumes.

The `${...:?}` interpolation deliberately refuses to render the hosted
profile without a worker token. The API and worker both require the same
token, while the worker remains un-published, the API remains bound to
`127.0.0.1:8080`, and the cockpit is available to the host at
`127.0.0.1:3000`. The Nginx cockpit proxies `/v1/*` and `/api/*` to the API
over the private Compose network, including streamed chat responses. Put a
separately authenticated reverse proxy or a managed Cloudflare connector in
front of `127.0.0.1:3000`; do not publish port 8765 or expose the cockpit
without authentication.

The cockpit image listens on internal port `8080` as the unprivileged `nginx`
user; Compose maps it to host loopback port `3000`. This avoids a privileged
container listener and keeps the read-only, capability-dropped profile
compatible with Nginx cache and log tmpfs mounts.

For a Linux host that should recover the stack after reboot, install the
included `infra/orcha-hosted.service` after placing the extracted kit at
`/opt/orcha` and creating `/etc/orcha/orcha.env` with mode `0600`:

```bash
sudo install -d -m 0700 /etc/orcha
sudo install -m 0600 /path/to/orcha.env /etc/orcha/orcha.env
sudo install -m 0644 /opt/orcha/infra/orcha-hosted.service /etc/systemd/system/orcha-hosted.service
sudo systemctl daemon-reload
sudo systemctl enable --now orcha-hosted.service
```

Build or pull the images before enabling the unit. It validates Compose without
printing resolved values, starts the private stack after Docker is available,
and stops without deleting named volumes. The unit does not provision a VM,
public ingress, or user authentication; put a separately managed and
authenticated Cloudflare connector or reverse proxy in front of host loopback
port `3000`.

The overlay keeps all services as non-root image users, drops all
Linux capabilities, prevents privilege escalation, limits process count and
memory, and makes the container root filesystem read-only. The durable API
database/feedback volume and worker workspace volume remain writable by the
image user. Inspect `/health/ready` only through the control-plane ingress
after startup.

The repository root `.dockerignore` is part of this boundary: it excludes
ignored environment files, local state, dependencies, caches, source-control
metadata, tests, scripts, and documentation from the image build context while
leaving only the package manifests and runtime source needed by the API and
cockpit images.

This profile is a deployment boundary, not proof of production readiness.
Before multi-user exposure, add authenticated user ownership, quotas, abuse
controls, managed Postgres, a durable queue/event transport, encrypted secret
storage, VM-per-company isolation, and an audited ingress policy. Never place
model provider keys in the browser or in `docker compose config` output.

Stop the stack with:

```powershell
docker compose -f infra/docker-compose.yml -f infra/docker-compose.hosted.yml down
```
