from pathlib import Path


COMPOSE = Path(__file__).resolve().parents[1] / "infra" / "docker-compose.yml"


def test_compose_keeps_api_private_and_provider_secrets_out_of_worker():
    document = COMPOSE.read_text(encoding="utf-8")
    api, worker = document.split("\n  worker:", 1)

    assert "env_file:" not in document
    assert '      - "127.0.0.1:8080:8080"' in api
    assert '      ORCHA_DISABLE_LOCAL_ENV: "true"' in api
    assert "healthcheck:" in api
    assert "http://127.0.0.1:8080/health/ready" in api
    assert "stop_grace_period: 30s" in api
    assert "stop_grace_period: 30s" in worker
    assert "      ORCHA_REQUIRE_WORKER_AUTH: ${ORCHA_REQUIRE_WORKER_AUTH:-false}" in api
    assert "      ORCHA_REQUIRE_WORKER_AUTH: ${ORCHA_REQUIRE_WORKER_AUTH:-false}" in worker

    for name in (
        "OPENROUTER_API_KEY",
        "OPENROUTER_API_KEYS",
        "GEMINI_API_KEY",
        "GEMINI_API_KEYS",
        "GROQ_API_KEY",
        "GROQ_API_KEYS",
        "OPENAI_API_KEY",
        "OPENAI_API_KEYS",
    ):
        assert f"      {name}:" in api
        assert f"      {name}:" not in worker
