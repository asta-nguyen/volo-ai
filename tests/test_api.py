import http.client
import json
import socket
import unittest
from unittest.mock import Mock, patch

from tts_mcp.api import MAX_BODY_BYTES, ApiServer, ApiStartError
from tts_mcp.engine import Engine


class ApiServerTests(unittest.TestCase):
    def setUp(self):
        self.api = ApiServer(port=0)
        self.port = self.api.start()["port"]
        self.addCleanup(self.api.stop)

    def request(self, method, path, body=None, headers=None, content_type="application/json"):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            request_headers = dict(headers or {})
            payload = body
            if isinstance(body, (dict, list)):
                payload = json.dumps(body).encode("utf-8")
            if payload is not None and content_type is not None:
                request_headers.setdefault("Content-Type", content_type)
            connection.request(method, path, body=payload, headers=request_headers)
            response = connection.getresponse()
            data = response.read()
            return response.status, dict(response.getheaders()), data
        finally:
            connection.close()

    def request_json(self, method, path, body=None, headers=None, content_type="application/json"):
        status, headers, data = self.request(
            method, path, body=body, headers=headers, content_type=content_type
        )
        return status, headers, json.loads(data)

    def test_status_returns_result_envelope(self):
        with patch("tts_mcp.server.status", return_value={"providers": {}}) as status_tool:
            code, headers, payload = self.request_json("GET", "/api/v1/status")

        self.assertEqual(code, 200)
        self.assertEqual(payload, {"result": {"providers": {}}})
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertNotIn("Access-Control-Allow-Headers", headers)
        status_tool.assert_called_once_with()

    def test_prepare_model_forwards_provider(self):
        with patch(
            "tts_mcp.server.prepare_model",
            return_value={"provider": "vieneu", "model_ready": True},
        ) as prepare:
            code, _headers, payload = self.request_json(
                "POST", "/api/v1/prepare_model", {"provider": "vieneu"}
            )

        self.assertEqual(code, 200)
        self.assertEqual(payload["result"], {"provider": "vieneu", "model_ready": True})
        prepare.assert_called_once_with(provider="vieneu")

    def test_speak_forwards_mcp_arguments(self):
        arguments = {
            "text": "hello",
            "output_path": "/tmp/out.wav",
            "speed": 1.2,
            "steps": 40,
            "normalize": True,
            "provider": "omnivoice",
            "voice": "auto",
            "language": "en",
        }
        with patch(
            "tts_mcp.server.speak", return_value="Audio saved to: /tmp/out.wav"
        ) as speak:
            code, _headers, payload = self.request_json("POST", "/api/v1/speak", arguments)

        self.assertEqual(code, 200)
        self.assertEqual(payload, {"result": "Audio saved to: /tmp/out.wav"})
        speak.assert_called_once_with(**arguments)

    def test_clone_forwards_mcp_arguments(self):
        arguments = {
            "text": "hello",
            "output_path": "/tmp/clone.wav",
            "ref_audio_path": "/tmp/ref.wav",
            "ref_text": "hi",
            "provider": "omnivoice",
        }
        with patch(
            "tts_mcp.server.clone", return_value="Cloned audio saved to: /tmp/clone.wav"
        ) as clone:
            code, _headers, payload = self.request_json("POST", "/api/v1/clone", arguments)

        self.assertEqual(code, 200)
        self.assertEqual(payload, {"result": "Cloned audio saved to: /tmp/clone.wav"})
        clone.assert_called_once_with(**arguments)

    def test_design_forwards_mcp_arguments(self):
        arguments = {"text": "hi", "output_path": "/tmp/a.wav", "instruct": "warm, low"}
        with patch(
            "tts_mcp.server.design", return_value="Designed voice audio saved to: /tmp/a.wav"
        ) as design:
            code, _headers, payload = self.request_json("POST", "/api/v1/design", arguments)

        self.assertEqual(code, 200)
        self.assertEqual(payload["result"], "Designed voice audio saved to: /tmp/a.wav")
        design.assert_called_once_with(**arguments)

    def test_list_voices_returns_structured_records(self):
        voices = [
            {
                "name": "My-Voice",
                "kind": "clone",
                "language": "vi",
                "ref_audio": "/voices/my-voice.wav",
                "design_instruction": None,
                "ref_text": None,
                "is_default": False,
            },
            {
                "name": "My-Preset",
                "kind": "vieneu_preset",
                "language": None,
                "preset_id": "truc_ly",
                "is_default": True,
            },
        ]
        with patch.object(Engine, "list_voices", return_value=voices) as list_voices:
            code, _headers, payload = self.request_json("GET", "/api/v1/voices")

        self.assertEqual(code, 200)
        self.assertEqual(payload, {"result": {"voices": voices}})
        list_voices.assert_called_once_with()

    def test_save_voice_route(self):
        with patch(
            "tts_mcp.server.save_voice", return_value="Voice profile 'demo' saved to: /v"
        ) as save_voice:
            code, _headers, payload = self.request_json(
                "POST",
                "/api/v1/voices",
                {"name": "demo", "ref_audio_path": "/tmp/ref.wav", "language": "vi"},
            )

        self.assertEqual(code, 200)
        self.assertEqual(payload, {"result": "Voice profile 'demo' saved to: /v"})
        save_voice.assert_called_once_with(
            name="demo", ref_audio_path="/tmp/ref.wav", language="vi"
        )

    def test_delete_voice_route(self):
        with patch(
            "tts_mcp.server.delete_voice", return_value="Deleted voice profile: demo"
        ) as delete_voice:
            code, _headers, payload = self.request_json("DELETE", "/api/v1/voices/demo")

        self.assertEqual(code, 200)
        self.assertEqual(payload, {"result": "Deleted voice profile: demo"})
        delete_voice.assert_called_once_with(name="demo")

        with patch(
            "tts_mcp.server.delete_voice", return_value="Deleted voice profile: voice x"
        ) as delete_voice:
            self.request("DELETE", "/api/v1/voices/voice%20x")
        delete_voice.assert_called_once_with(name="voice x")

    def test_error_mapping_is_structured_and_bounded(self):
        cases = [
            (ValueError("bad input value"), 400, "invalid_input", "bad input value"),
            (TypeError("wrong arg type"), 400, "invalid_input", "wrong arg type"),
            (FileNotFoundError("missing file"), 404, "not_found", "missing file"),
            (RuntimeError("model exploded"), 500, "operation_failed", "model exploded"),
            (Exception("hidden detail"), 500, "internal_error", "local TTS operation failed"),
        ]
        for error, expected_status, expected_code, expected_message in cases:
            with self.subTest(code=expected_code), patch(
                "tts_mcp.server.speak", side_effect=error
            ):
                status, _headers, payload = self.request_json(
                    "POST",
                    "/api/v1/speak",
                    {"text": "secret text", "output_path": "/tmp/out.wav"},
                )
            self.assertEqual(status, expected_status)
            self.assertEqual(payload["error"]["code"], expected_code)
            self.assertIn(expected_message, payload["error"]["message"])
            self.assertNotIn("secret text", payload["error"]["message"])
            self.assertNotIn("Traceback", payload["error"]["message"])

    def test_malformed_json_body_is_rejected(self):
        with patch("tts_mcp.server.speak") as speak:
            status, _headers, payload = self.request_json(
                "POST", "/api/v1/speak", body=b"{not json"
            )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_json")
        speak.assert_not_called()

    def test_invalid_utf8_body_is_rejected_as_invalid_json(self):
        with patch("tts_mcp.server.speak") as speak:
            status, headers, payload = self.request_json(
                "POST", "/api/v1/speak", body=b"\xff"
            )
        self.assertEqual(status, 400)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(payload["error"]["code"], "invalid_json")
        speak.assert_not_called()

    def test_non_object_json_body_is_rejected(self):
        with patch("tts_mcp.server.speak") as speak:
            for body in ([1, 2], b'"text"', b"12", b"null", b"true"):
                status, _headers, payload = self.request_json(
                    "POST", "/api/v1/speak", body=body
                )
                self.assertEqual(status, 400)
                self.assertEqual(payload["error"]["code"], "invalid_arguments")
        speak.assert_not_called()

    def test_missing_and_unknown_arguments_are_rejected(self):
        with patch("tts_mcp.server.speak") as speak:
            status, _headers, payload = self.request_json("POST", "/api/v1/speak", {})
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_arguments")
        self.assertIn("text", payload["error"]["message"])
        self.assertIn("output_path", payload["error"]["message"])
        speak.assert_not_called()

        with patch("tts_mcp.server.prepare_model") as prepare:
            status, _headers, payload = self.request_json(
                "POST",
                "/api/v1/prepare_model",
                {"provider": "vieneu", "token": "abc"},
            )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_arguments")
        self.assertIn("token", payload["error"]["message"])
        prepare.assert_not_called()

    def test_missing_body_and_invalid_length_are_rejected(self):
        with patch("tts_mcp.server.speak") as speak:
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            try:
                connection.putrequest("POST", "/api/v1/speak")
                connection.putheader("Content-Type", "application/json")
                connection.endheaders()
                response = connection.getresponse()
                payload = json.loads(response.read())
                self.assertEqual(response.status, 400)
                self.assertEqual(payload["error"]["code"], "invalid_request")
            finally:
                connection.close()

            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            try:
                connection.putrequest("POST", "/api/v1/speak")
                connection.putheader("Content-Type", "application/json")
                connection.putheader("Content-Length", "abc")
                connection.endheaders()
                response = connection.getresponse()
                payload = json.loads(response.read())
                self.assertEqual(response.status, 400)
                self.assertEqual(payload["error"]["code"], "invalid_request")
            finally:
                connection.close()
        speak.assert_not_called()

    def test_body_over_one_mib_is_rejected_before_dispatch(self):
        with patch("tts_mcp.server.speak") as speak:
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            try:
                connection.putrequest("POST", "/api/v1/speak")
                connection.putheader("Content-Type", "application/json")
                connection.putheader("Content-Length", str(MAX_BODY_BYTES + 1))
                connection.endheaders()
                response = connection.getresponse()
                payload = json.loads(response.read())
                self.assertEqual(response.status, 413)
                self.assertEqual(payload["error"]["code"], "payload_too_large")
            finally:
                connection.close()
        speak.assert_not_called()

    def test_wrong_methods_and_unknown_routes_are_rejected(self):
        cases = [
            ("POST", "/api/v1/status", 405),
            ("GET", "/api/v1/speak", 405),
            ("DELETE", "/api/v1/status", 405),
            ("GET", "/api/v1/voices/demo", 405),
            ("PUT", "/api/v1/voices", 405),
            ("OPTIONS", "/api/v1/status", 405),
            ("GET", "/api/v1/nope", 404),
            ("GET", "/other", 404),
            ("DELETE", "/api/v1/voices/", 404),
            ("DELETE", "/api/v1/voices/a/b", 404),
        ]
        for method, path, expected in cases:
            with self.subTest(method=method, path=path):
                status, headers, payload = self.request_json(method, path)
                self.assertEqual(status, expected)
                self.assertIn("error", payload)
                self.assertNotIn("Access-Control-Allow-Origin", headers)
                self.assertNotIn("Access-Control-Allow-Methods", headers)

    def test_unsupported_method_is_rejected_with_json_error(self):
        status, headers, payload = self.request_json("BREW", "/api/v1/status")
        self.assertEqual(status, 405)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(payload["error"]["code"], "method_not_allowed")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_non_loopback_hosts_are_rejected(self):
        port = self.port
        bad_hosts = [
            "example.com",
            "127.0.0.1.evil.com",
            "192.168.1.10",
            "0.0.0.0",
            "10.0.0.5:1234",
            f"127.0.0.1:{port + 1}",
            f"127.0.0.1:{port}extra",
            "[::1]",
        ]
        with patch("tts_mcp.server.status", return_value={"providers": {}}) as status_tool:
            for host in bad_hosts:
                with self.subTest(host=host):
                    status, _headers, payload = self.request_json(
                        "GET", "/api/v1/status", headers={"Host": host}
                    )
                    self.assertEqual(status, 403)
                    self.assertEqual(payload["error"]["code"], "forbidden_host")
            status_tool.assert_not_called()

            for host in (f"127.0.0.1:{port}", "127.0.0.1", "localhost", f"localhost:{port}"):
                with self.subTest(host=host):
                    status, _headers, _payload = self.request_json(
                        "GET", "/api/v1/status", headers={"Host": host}
                    )
                    self.assertEqual(status, 200)

    def test_malformed_loopback_host_is_rejected(self):
        with patch(
            "tts_mcp.server.status", return_value={"providers": {}}
        ) as status_tool:
            for host in ("localhost:", "127.0.0.1:", "127.0.0.1:abc"):
                with self.subTest(host=host):
                    status, _headers, payload = self.request_json(
                        "GET", "/api/v1/status", headers={"Host": host}
                    )
                    self.assertEqual(status, 403)
                    self.assertEqual(payload["error"]["code"], "forbidden_host")
            status_tool.assert_not_called()

    def test_missing_host_header_is_rejected(self):
        with patch(
            "tts_mcp.server.status", return_value={"providers": {}}
        ) as status_tool:
            with socket.create_connection(("127.0.0.1", self.port), timeout=10) as sock:
                sock.sendall(
                    b"GET /api/v1/status HTTP/1.1\r\n"
                    b"Connection: close\r\n"
                    b"\r\n"
                )
                response = http.client.HTTPResponse(sock)
                response.begin()
                payload = json.loads(response.read())
                response.close()
            self.assertEqual(response.status, 403)
            self.assertEqual(payload["error"]["code"], "forbidden_host")
        status_tool.assert_not_called()

    def test_any_origin_header_is_rejected(self):
        with patch("tts_mcp.server.status", return_value={"providers": {}}) as status_tool:
            status, _headers, payload = self.request_json(
                "GET",
                "/api/v1/status",
                headers={"Origin": "http://malicious.example"},
            )
            self.assertEqual(status, 403)
            self.assertEqual(payload["error"]["code"], "origin_not_allowed")
            status_tool.assert_not_called()

        with patch("tts_mcp.server.speak") as speak:
            status, _headers, payload = self.request_json(
                "POST",
                "/api/v1/speak",
                {"text": "hi", "output_path": "/tmp/a.wav"},
                headers={"Origin": "null"},
            )
            self.assertEqual(status, 403)
            self.assertEqual(payload["error"]["code"], "origin_not_allowed")
            speak.assert_not_called()

    def test_non_json_content_type_is_rejected(self):
        with patch("tts_mcp.server.speak") as speak:
            for content_type in ("text/plain", "application/x-www-form-urlencoded", ""):
                with self.subTest(content_type=content_type):
                    status, _headers, payload = self.request_json(
                        "POST",
                        "/api/v1/speak",
                        body=b'{"text":"hi","output_path":"/tmp/a.wav"}',
                        content_type=content_type or None,
                    )
                    self.assertEqual(status, 415)
                    self.assertEqual(payload["error"]["code"], "unsupported_media_type")
        speak.assert_not_called()

    def test_json_content_type_with_charset_is_accepted(self):
        with patch(
            "tts_mcp.server.prepare_model",
            return_value={"provider": "omnivoice", "model_ready": True},
        ) as prepare:
            status, _headers, payload = self.request_json(
                "POST",
                "/api/v1/prepare_model",
                body=b'{"provider":"omnivoice"}',
                content_type="application/json; charset=utf-8",
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["model_ready"], True)
        prepare.assert_called_once_with(provider="omnivoice")

    def test_query_string_is_ignored_for_get_routes(self):
        with patch("tts_mcp.server.status", return_value={"providers": {}}):
            status, _headers, _payload = self.request_json(
                "GET", "/api/v1/status?verbose=true"
            )
        self.assertEqual(status, 200)

    def test_lifecycle_start_state_stop_and_idempotent_stop(self):
        api = ApiServer(port=0)
        self.assertFalse(api.running)
        self.assertFalse(api.state()["running"])

        state = api.start()
        self.assertTrue(api.running)
        self.assertTrue(state["running"])
        self.assertEqual(state["host"], "127.0.0.1")
        self.assertEqual(state["url"], f"http://127.0.0.1:{state['port']}")

        again = api.start()
        self.assertEqual(again["port"], state["port"])

        stopped = api.stop()
        self.assertFalse(api.running)
        self.assertFalse(stopped["running"])
        with self.assertRaises(OSError):
            http.client.HTTPConnection("127.0.0.1", state["port"], timeout=2).request(
                "GET", "/api/v1/status"
            )

        second = api.stop()
        self.assertFalse(second["running"])

    def test_stop_retry_after_shutdown_failure_closes_listener(self):
        self._assert_stop_retried_until_listener_closed("shutdown")

    def test_stop_retry_after_server_close_failure_closes_listener(self):
        self._assert_stop_retried_until_listener_closed("server_close")

    def _assert_stop_retried_until_listener_closed(self, attribute):
        server = self.api._server
        original = getattr(server, attribute)
        attempts = []

        def fail_once():
            attempts.append(None)
            if len(attempts) == 1:
                raise OSError(f"injected {attribute} failure")
            return original()

        with patch.object(server, attribute, fail_once):
            with self.assertRaises(OSError):
                self.api.stop()
            self.assertTrue(self.api.running)

            stopped = self.api.stop()

        self.assertEqual(len(attempts), 2)
        self.assertFalse(self.api.running)
        self.assertFalse(stopped["running"])
        with self.assertRaises(OSError):
            http.client.HTTPConnection("127.0.0.1", self.port, timeout=2).request(
                "GET", "/api/v1/status"
            )

    def test_start_fails_with_port_in_use(self):
        blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        blocker.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        blocker.bind(("127.0.0.1", 8765))
        blocker.listen(1)
        self.addCleanup(blocker.close)
        api = ApiServer()
        with self.assertRaises(ApiStartError) as raised:
            api.start()
        self.assertEqual(raised.exception.code, "port_in_use")
        self.assertIn("127.0.0.1:8765", str(raised.exception))
        self.assertFalse(api.running)

    def test_server_binds_only_loopback(self):
        self.assertEqual(self.api.state()["host"], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
