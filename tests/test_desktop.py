import io
import json
import unittest
from unittest.mock import Mock, patch

from tts_mcp.desktop import dispatch_request, run_protocol


class DesktopWorkerTests(unittest.TestCase):
    def test_status_returns_supported_languages(self):
        engine = Mock()
        engine.model_status.return_value = {"ready": False, "device": "cpu"}

        response = dispatch_request({"id": "1", "type": "status"}, engine)

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["languages"], ["en", "vi"])

    def test_invalid_language_returns_structured_error(self):
        response = dispatch_request(
            {
                "id": "2",
                "type": "synthesize",
                "text": "hello",
                "language": "fr",
                "voice": "auto",
                "speed": 1.0,
                "format": "wav",
            },
            Mock(),
        )

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_input")

    def test_protocol_emits_json_lines(self):
        engine = Mock()
        engine.model_status.return_value = {"ready": True, "device": "cpu"}
        source = io.StringIO(json.dumps({"id": "1", "type": "status"}) + "\n")
        target = io.StringIO()

        run_protocol(source, target, engine)

        result = json.loads(target.getvalue())
        self.assertEqual(result["id"], "1")
        self.assertTrue(result["ok"])


if __name__ == "__main__":
    unittest.main()
