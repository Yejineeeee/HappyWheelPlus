import json
import os

from happywheel.__main__ import main


def test_check_size_passes(tmp_path):
    d = tmp_path / "a"
    d.mkdir()
    (d / "x.json").write_text("{}" * 1000)
    assert main(["check-size", "--out", str(tmp_path)]) == 0


def test_check_size_fails_over_limit(tmp_path):
    d = tmp_path / "a"
    d.mkdir()
    (d / "x.bin").write_bytes(os.urandom(3 * 1024 * 1024))
    assert main(["check-size", "--out", str(tmp_path)]) == 1


def test_run_unknown_city_errors(capsys):
    assert main(["run", "--city", "seoul"]) == 2
    assert "seoul" in capsys.readouterr().err


def test_merge_index_keeps_old_entries(tmp_path):
    from happywheel.__main__ import merge_index
    old = {"cities": [{"id": "b", "v": 1}, {"id": "a", "v": 1}]}
    new = {"generated_at": "t", "cities": [{"id": "a", "v": 2}]}
    merged = merge_index(old, new, ["a", "b", "c"])
    assert [(c["id"], c["v"]) for c in merged["cities"]] == [("a", 2), ("b", 1)]
    assert merged["generated_at"] == "t"
