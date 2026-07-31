import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import AsyncMock, patch

from panel.cli import __main__ as cli


class ThreeCliOutputTests(unittest.TestCase):
    def test_json_stdout(self):
        stdout = io.StringIO()
        with patch("sys.argv", ["3cli", "--actor", "codex", "domains", "list"]), patch.object(cli, "make_service", return_value=object()), patch.object(cli, "dispatch", new=AsyncMock(return_value={"domains": []})), redirect_stdout(stdout):
            self.assertEqual(cli.main(), 0)
        self.assertEqual(json.loads(stdout.getvalue()), {"domains": []})

    def test_safe_json_stderr(self):
        stderr = io.StringIO()
        with patch("sys.argv", ["3cli", "--actor", "codex", "domains", "list"]), patch.object(cli, "make_service", side_effect=ValueError("Authorization: secret-value")), redirect_stderr(stderr):
            self.assertEqual(cli.main(), 1)
        error = json.loads(stderr.getvalue())
        self.assertEqual(error["error"], "provider operation failed")
        self.assertNotIn("secret-value", stderr.getvalue())
