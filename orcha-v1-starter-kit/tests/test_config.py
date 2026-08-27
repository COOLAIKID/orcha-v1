from __future__ import annotations

import os

import pytest

from orcha.config import load_local_environment


def test_local_environment_loads_missing_values_without_overriding_process_env(tmp_path, monkeypatch):
    path = tmp_path / "orcha.local.env"
    path.write_text("ORCHA_TEST_CONFIG_FILE='from-file'\nORCHA_TEST_CONFIG_QUOTED=\"quoted\"\n", encoding="utf-8")
    monkeypatch.setenv("ORCHA_TEST_CONFIG_FILE", "from-process")
    monkeypatch.delenv("ORCHA_TEST_CONFIG_QUOTED", raising=False)

    assert load_local_environment(path) == path
    assert os.environ["ORCHA_TEST_CONFIG_FILE"] == "from-process"
    assert os.environ["ORCHA_TEST_CONFIG_QUOTED"] == "quoted"


def test_local_environment_can_be_disabled(tmp_path, monkeypatch):
    path = tmp_path / "orcha.local.env"
    path.write_text("ORCHA_TEST_CONFIG_DISABLED=value\n", encoding="utf-8")
    monkeypatch.setenv("ORCHA_DISABLE_LOCAL_ENV", "true")
    monkeypatch.delenv("ORCHA_TEST_CONFIG_DISABLED", raising=False)

    assert load_local_environment(path) is None
    assert "ORCHA_TEST_CONFIG_DISABLED" not in os.environ


def test_local_environment_rejects_malformed_entries(tmp_path):
    path = tmp_path / "orcha.local.env"
    path.write_text("not valid=value\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Invalid environment entry"):
        load_local_environment(path)
