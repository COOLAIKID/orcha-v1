from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def script(name: str) -> str:
    return (ROOT / "scripts" / name).read_text(encoding="utf-8-sig")


def test_local_lifecycle_passes_the_private_environment_file_to_worker_controls():
    start_local = script("start-orcha-local.ps1")
    stop_local = script("stop-orcha-local.ps1")
    supervisor = script("watch-orcha-local.ps1")

    assert "-EnvironmentFile $EnvironmentFile" in start_local
    assert "-EnvironmentFile $EnvironmentFile" in stop_local
    assert "-EnvironmentFile $EnvironmentFile" in supervisor


def test_worker_start_persists_auth_only_inside_the_dedicated_distro():
    setup = script("setup-orcha-worker.ps1")
    start = script("start-orcha-worker.ps1")

    assert "EnvironmentFile=-/etc/orcha/worker.env" in setup
    assert "ORCHA_WORKER_SETUP_TOKEN" in start
    assert "10-environment.conf" in start
    assert "ORCHA_WORKER_AUTH_TOKEN=%s\\n" in start
    assert "wsl.exe argument" in start
    assert "ForceRestart" in start
    assert "already ready" in start


def test_worker_stop_forwards_the_private_token_without_putting_it_in_arguments():
    stop = script("stop-orcha-worker.ps1")

    assert "ORCHA_WORKER_BRIDGE_TOKEN" in stop
    assert "X-Orcha-Worker-Token" in stop
    assert "WSLENV" in stop
    assert "EnvironmentFile" in stop
    assert "token=\"$workerToken\"" not in stop


def test_local_supervisor_uses_readiness_and_only_restarts_verified_api():
    supervisor = script("watch-orcha-local.ps1")

    assert "/health/ready" in supervisor
    assert "/health\"" in supervisor
    assert "apiReadinessFailures" in supervisor
    assert "three supervisor passes" in supervisor
    assert "Get-OwnedApiProcess" in supervisor
    assert "orcha.api.app" in supervisor
    assert "API readiness is unavailable, but port $ApiPort is occupied by an unverified process" in supervisor
    assert "deferring API recovery until the execution boundary is available" in supervisor


def test_pilot_launcher_reuses_only_a_ready_runtime_or_scoped_recovery():
    pilot = script("start-orcha-pilot.ps1")

    assert "/health/ready" in pilot
    assert "watch-orcha-local.ps1" in pilot
    assert "-Once" in pilot
    assert "Unknown processes are never terminated" in pilot


def test_phone_pilot_supervisor_retries_the_scoped_launcher_and_startup_can_enable_it():
    supervisor = script("watch-orcha-pilot.ps1")
    startup = script("install-orcha-startup.ps1")

    assert "start-orcha-pilot.ps1" in supervisor
    assert "ReadyTimeoutSeconds" in supervisor
    assert "never terminates an unverified process" in supervisor
    assert "IncludePhonePilot" in startup
    assert "watch-orcha-pilot.ps1" in startup
    assert "UiPort" in startup
