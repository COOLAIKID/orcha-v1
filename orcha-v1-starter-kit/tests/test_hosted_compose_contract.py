from pathlib import Path


BASE = Path(__file__).resolve().parents[1] / "infra" / "docker-compose.yml"
HOSTED = Path(__file__).resolve().parents[1] / "infra" / "docker-compose.hosted.yml"
NGINX = Path(__file__).resolve().parents[1] / "infra" / "nginx-hosted.conf"
NGINX_CONF = Path(__file__).resolve().parents[1] / "infra" / "nginx.conf"
UI_DOCKERFILE = Path(__file__).resolve().parents[1] / "infra" / "ui.Dockerfile"
DOCKERIGNORE = Path(__file__).resolve().parents[1] / ".dockerignore"
HOSTED_SERVICE = Path(__file__).resolve().parents[1] / "infra" / "orcha-hosted.service"
START_HOSTED = Path(__file__).resolve().parents[1] / "scripts" / "start-orcha-hosted.ps1"
STOP_HOSTED = Path(__file__).resolve().parents[1] / "scripts" / "stop-orcha-hosted.ps1"


def test_hosted_overlay_requires_auth_and_keeps_worker_private():
    base = BASE.read_text(encoding="utf-8")
    hosted = HOSTED.read_text(encoding="utf-8")

    assert 'ORCHA_REQUIRE_WORKER_AUTH: "true"' in hosted
    assert "ORCHA_WORKER_AUTH_TOKEN: ${ORCHA_WORKER_AUTH_TOKEN:?" in hosted
    worker = hosted.split("\n  worker:", 1)[1]
    assert "\n    ports:" not in worker
    assert "  cockpit:" in hosted
    assert '"127.0.0.1:3000:8080"' in hosted
    assert '      - "127.0.0.1:8080:8080"' in base
    assert "expose:" in base
    assert "8765" in base


def test_hosted_overlay_applies_container_hardening_to_both_services():
    hosted = HOSTED.read_text(encoding="utf-8")

    assert hosted.count("restart: always") == 3
    assert hosted.count("read_only: true") == 3
    assert hosted.count("no-new-privileges:true") == 3
    assert hosted.count("cap_drop:") == 3
    assert hosted.count("- ALL") == 3
    assert hosted.count("pids_limit: 256") == 2
    assert hosted.count("mem_limit: 1g") == 2
    assert "pids_limit: 128" in hosted
    assert "mem_limit: 256m" in hosted


def test_hosted_cockpit_preserves_same_origin_streaming_api_contract():
    nginx = NGINX.read_text(encoding="utf-8")
    nginx_conf = NGINX_CONF.read_text(encoding="utf-8")
    dockerfile = UI_DOCKERFILE.read_text(encoding="utf-8")

    assert "listen 8080;" in nginx
    assert "pid /tmp/nginx.pid;" in nginx_conf
    assert "COPY infra/nginx.conf /etc/nginx/nginx.conf" in dockerfile
    assert "USER nginx" in dockerfile
    assert "EXPOSE 8080" in dockerfile
    assert "127.0.0.1:8080/health" in dockerfile
    assert nginx.count("proxy_pass http://api:8080;") == 2
    assert nginx.count("proxy_buffering off;") == 2
    assert "location /v1/" in nginx
    assert "location /api/" in nginx
    assert "try_files $uri $uri/ /index.html;" in nginx
    assert "pnpm install --frozen-lockfile" in dockerfile
    assert "COPY --from=build /app/dist /usr/share/nginx/html" in dockerfile


def test_image_context_excludes_secrets_and_machine_state():
    dockerignore = DOCKERIGNORE.read_text(encoding="utf-8")
    ignored = {line.strip() for line in dockerignore.splitlines() if line.strip() and not line.lstrip().startswith("#")}

    for entry in (".env", ".env.*", "ui/.env", "orcha.local.env", "var/", "node_modules/", ".venv/", ".git/"):
        assert entry in ignored
    for runtime_path in ("src/", "pyproject.toml", "ui/", "infra/"):
        assert runtime_path not in ignored
    assert "docs/" in ignored
    assert "tests/" in ignored


def test_hosted_boot_unit_recovers_compose_after_docker_start():
    service = HOSTED_SERVICE.read_text(encoding="utf-8")

    assert "Requires=docker.service" in service
    assert "After=docker.service network-online.target" in service
    assert "WorkingDirectory=/opt/orcha" in service
    assert "--env-file /etc/orcha/orcha.env" in service
    assert "config --quiet" in service
    assert " up -d" in service
    assert " down" in service
    assert "orcha-hosted.service" not in service
    assert "ORCHA_WORKER_AUTH_TOKEN" not in service


def test_hosted_lifecycle_scripts_validate_readiness_without_destroying_volumes():
    start = START_HOSTED.read_text(encoding="utf-8-sig")
    stop = STOP_HOSTED.read_text(encoding="utf-8-sig")

    assert "docker" in start
    assert "config', '--quiet" in start
    assert "ORCHA_WORKER_AUTH_TOKEN" not in start
    assert "127.0.0.1:3000/health" in start
    assert "127.0.0.1:8080/health/ready" in start
    assert "'--build'" in start
    assert "down" in stop
    assert "--volumes" not in stop
