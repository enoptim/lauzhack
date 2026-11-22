"""The judges' one-command check must run and every identity in it must hold. Run: python test_judge_check.py"""
import io
from contextlib import redirect_stdout

import judge_check


def test_judge_check_passes():
    out = io.StringIO()
    with redirect_stdout(out):
        code = judge_check.main()
    text = out.getvalue()
    assert code == 0, text
    assert "[FAIL]" not in text
    assert "all identities hold" in text
    assert "10th to 90th percentile" in text


if __name__ == "__main__":
    test_judge_check_passes()
    print("ok")
