import json
import sqlite3
import tempfile
import unittest
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import numpy as np

from tts_mcp.engine import Engine, validate_language


class FakeModel:
    def __init__(self):
        self.kwargs = None

    def generate(self, **kwargs):
        self.kwargs = kwargs
        return [np.zeros(8, dtype=np.float32)]

    @staticmethod
    def create_voice_clone_prompt(ref_audio, ref_text=None):
        class FakePrompt:
            def save(self, path):
                Path(path).write_bytes(b"prompt")

        return FakePrompt()


class EngineTests(unittest.TestCase):
    @staticmethod
    def write_wav(path: Path) -> None:
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b"\x00\x00")

    def storage_patches(self, root: Path):
        return patch.multiple(
            "tts_mcp.engine",
            DATA_DIR=root,
            DB_PATH=root / "volo.db",
            VOICES_DIR=root / "voices",
        )

    @staticmethod
    def create_v3_database(root: Path) -> sqlite3.Connection:
        connection = sqlite3.connect(root / "volo.db")
        connection.executescript(
            """
            CREATE TABLE voice_profiles (
                name TEXT PRIMARY KEY,
                language TEXT NOT NULL CHECK (language IN ('en', 'vi')),
                kind TEXT NOT NULL DEFAULT 'clone' CHECK (kind IN ('clone', 'design')),
                ref_audio_path TEXT,
                prompt_path TEXT,
                design_instruction TEXT,
                ref_text TEXT,
                is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
                seed_key TEXT,
                seed_version INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CHECK (
                    (kind = 'clone' AND prompt_path IS NOT NULL AND design_instruction IS NULL)
                    OR (kind = 'design' AND prompt_path IS NULL AND design_instruction IS NOT NULL)
                )
            );
            CREATE UNIQUE INDEX idx_voice_profiles_default_language
                ON voice_profiles(language) WHERE is_default = 1;
            CREATE TABLE app_seeds (
                seed_key TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                installed_at TEXT NOT NULL
            );
            CREATE TABLE audio_history (
                file_name TEXT PRIMARY KEY,
                provider TEXT NOT NULL CHECK (provider IN ('omnivoice', 'vieneu')),
                voice_name TEXT NOT NULL,
                format TEXT NOT NULL CHECK (format IN ('wav', 'mp3')),
                text TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            PRAGMA user_version = 3;
            """
        )
        return connection

    @staticmethod
    def create_v4_database(root: Path) -> sqlite3.Connection:
        connection = sqlite3.connect(root / "volo.db")
        connection.executescript(
            """
            CREATE TABLE voice_profiles (
                name TEXT PRIMARY KEY,
                language TEXT CHECK (language IN ('en', 'vi') OR language IS NULL),
                kind TEXT NOT NULL DEFAULT 'clone'
                    CHECK (kind IN ('clone', 'design', 'vieneu_preset')),
                preset_id TEXT,
                ref_audio_path TEXT,
                prompt_path TEXT,
                design_instruction TEXT,
                ref_text TEXT,
                is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
                seed_key TEXT,
                seed_version INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CHECK (
                    (kind = 'clone' AND language IS NOT NULL AND preset_id IS NULL
                        AND prompt_path IS NOT NULL AND design_instruction IS NULL)
                    OR (kind = 'design' AND language IS NOT NULL AND preset_id IS NULL
                        AND prompt_path IS NULL AND design_instruction IS NOT NULL)
                    OR (kind = 'vieneu_preset' AND language IS NULL AND preset_id IS NOT NULL
                        AND ref_audio_path IS NULL AND prompt_path IS NULL
                        AND design_instruction IS NULL AND ref_text IS NULL
                        AND is_default = 0 AND seed_key IS NULL AND seed_version IS NULL)
                )
            );
            CREATE UNIQUE INDEX idx_voice_profiles_default_language
                ON voice_profiles(language) WHERE is_default = 1;
            CREATE TABLE app_seeds (
                seed_key TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                installed_at TEXT NOT NULL
            );
            CREATE TABLE audio_history (
                file_name TEXT PRIMARY KEY,
                provider TEXT NOT NULL CHECK (provider IN ('omnivoice', 'vieneu')),
                voice_name TEXT NOT NULL,
                format TEXT NOT NULL CHECK (format IN ('wav', 'mp3')),
                text TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            PRAGMA user_version = 4;
            """
        )
        return connection

    def test_generate_forwards_language(self):
        model = FakeModel()
        engine = Engine()
        engine._model = model

        audio = engine.generate("Xin chao", language="vi")

        self.assertEqual(audio.shape, (8,))
        self.assertEqual(model.kwargs["language"], "vi")

    def test_generate_forwards_duration_and_omnivoice_config(self):
        model = FakeModel()
        engine = Engine()
        engine._model = model
        generation_config = {
            "guidance_scale": 2.5,
            "t_shift": 0.2,
            "position_temperature": 4.0,
            "class_temperature": 0.3,
            "layer_penalty_factor": 4.5,
            "denoise": False,
            "preprocess_prompt": False,
            "postprocess_output": False,
            "audio_chunk_duration": 12.0,
            "audio_chunk_threshold": 24.0,
            "pad_duration": 0.05,
            "fade_duration": 0.05,
            "text": "must not replace the request",
        }

        engine.generate(
            "hello",
            language="en",
            instruct="female, warm",
            speed=1.2,
            num_step=48,
            duration=8.0,
            normalize_text=True,
            generation_config=generation_config,
        )

        self.assertEqual(model.kwargs["text"], "hello")
        self.assertEqual(model.kwargs["duration"], 8.0)
        self.assertTrue(model.kwargs["normalize_text"])
        self.assertEqual(model.kwargs["instruct"], "female, warm")
        for key, value in generation_config.items():
            if key != "text":
                self.assertEqual(model.kwargs[key], value)

    def test_language_boundary_accepts_only_supported_languages(self):
        self.assertEqual(validate_language("en"), "en")
        self.assertEqual(validate_language("vi"), "vi")
        with self.assertRaises(ValueError):
            validate_language("fr")

    def test_voice_name_rejects_path_traversal(self):
        self.assertEqual(Engine.validate_voice_name("alice_01"), "alice_01")
        with self.assertRaises(ValueError):
            Engine.validate_voice_name("../alice")

    def test_model_status_requires_ready_marker_and_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_dir = root / "omnivoice"
            tokenizer_dir = model_dir / "audio_tokenizer"
            asr_dir = root / "whisper"
            model_dir.mkdir()
            tokenizer_dir.mkdir()
            asr_dir.mkdir()
            (model_dir / "config.json").write_text("{}")
            (asr_dir / "config.json").write_text("{}")
            marker = root / "ready.json"
            marker.write_text(json.dumps({"model": "k2-fsa/OmniVoice"}))

            with (
                patch("tts_mcp.engine.MODEL_DIR", model_dir),
                patch("tts_mcp.engine.TOKENIZER_DIR", tokenizer_dir),
                patch("tts_mcp.engine.ASR_DIR", asr_dir),
                patch("tts_mcp.engine.READY_MARKER", marker),
            ):
                status = Engine().model_status()

        self.assertTrue(status["ready"])

    def test_storage_creates_production_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.storage_patches(root):
                connection = Engine._open_storage()
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                self.assertIn("voice_profiles", tables)
                self.assertIn("app_seeds", tables)
                self.assertIn("audio_history", tables)
                self.assertIn(
                    "preset_id",
                    {row[1] for row in connection.execute("PRAGMA table_info(voice_profiles)")},
                )
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 5)
                self.assertEqual(connection.execute("PRAGMA foreign_keys").fetchone()[0], 1)
                self.assertEqual(connection.execute("PRAGMA busy_timeout").fetchone()[0], 5000)
                connection.close()

    def test_schema_v1_migrates_existing_profiles_to_clone_kind(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            database = root / "volo.db"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE voice_profiles (
                    name TEXT PRIMARY KEY,
                    language TEXT NOT NULL CHECK (language IN ('en', 'vi')),
                    ref_audio_path TEXT,
                    prompt_path TEXT NOT NULL,
                    ref_text TEXT,
                    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
                    seed_key TEXT,
                    seed_version INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX idx_voice_profiles_default_language
                    ON voice_profiles(language) WHERE is_default = 1;
                CREATE TABLE app_seeds (
                    seed_key TEXT PRIMARY KEY,
                    version INTEGER NOT NULL,
                    installed_at TEXT NOT NULL
                );
                PRAGMA user_version = 1;
                """
            )
            connection.execute(
                """
                INSERT INTO voice_profiles
                    (name, language, prompt_path, created_at, updated_at)
                VALUES ('legacy', 'en', 'voices/legacy/prompt.pt', 'created', 'updated')
                """
            )
            connection.commit()
            connection.close()

            with self.storage_patches(root):
                connection = Engine._open_storage()
                row = connection.execute(
                    "SELECT kind, design_instruction FROM voice_profiles WHERE name = 'legacy'"
                ).fetchone()
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 5)
                self.assertEqual(row["kind"], "clone")
                self.assertIsNone(row["design_instruction"])
                connection.close()

    def test_schema_v2_migrates_without_changing_profiles_or_seeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.storage_patches(root):
                connection = Engine._open_storage()
                connection.execute(
                    """
                    INSERT INTO voice_profiles
                        (name, language, kind, prompt_path, created_at, updated_at)
                    VALUES ('kept', 'vi', 'clone', 'voices/kept/prompt.pt', 'created', 'updated')
                    """
                )
                connection.execute(
                    "INSERT INTO app_seeds (seed_key, version, installed_at) VALUES (?, ?, ?)",
                    ("demo", 1, "installed"),
                )
                connection.execute("DROP TABLE audio_history")
                connection.execute("PRAGMA user_version = 2")
                connection.commit()
                connection.close()

                connection = Engine._open_storage()
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 5)
                self.assertEqual(
                    tuple(
                        connection.execute("SELECT name, language FROM voice_profiles").fetchone()
                    ),
                    ("kept", "vi"),
                )
                self.assertEqual(
                    tuple(connection.execute("SELECT seed_key, version FROM app_seeds").fetchone()),
                    ("demo", 1),
                )
                connection.close()

    def test_schema_v3_migrates_profiles_seeds_audio_history_and_preserves_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            voice_dir = root / "voices" / "clone"
            voice_dir.mkdir(parents=True)
            reference = voice_dir / "reference.wav"
            prompt = voice_dir / "prompt.pt"
            reference.write_bytes(b"reference audio")
            prompt.write_bytes(b"prepared prompt")
            connection = self.create_v3_database(root)
            connection.executemany(
                """
                INSERT INTO voice_profiles
                    (name, language, kind, ref_audio_path, prompt_path,
                     design_instruction, ref_text, is_default, seed_key,
                     seed_version, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "clone", "vi", "clone", "voices/clone/reference.wav",
                        "voices/clone/prompt.pt", None, "Xin chao", 1,
                        "seed-clone", 2, "clone-created", "clone-updated",
                    ),
                    (
                        "design", "en", "design", None, None, "warm voice",
                        None, 0, None, None, "design-created", "design-updated",
                    ),
                ],
            )
            connection.execute(
                "INSERT INTO app_seeds VALUES (?, ?, ?)",
                ("seed-clone", 2, "seed-installed"),
            )
            connection.execute(
                "INSERT INTO audio_history VALUES (?, ?, ?, ?, ?, ?)",
                ("take.wav", "vieneu", "truc_ly", "wav", "Xin chào", "audio-created"),
            )
            connection.commit()
            before_profiles = connection.execute(
                """SELECT name, language, kind, ref_audio_path, prompt_path,
                          design_instruction, ref_text, is_default, seed_key,
                          seed_version, created_at, updated_at
                   FROM voice_profiles ORDER BY name"""
            ).fetchall()
            connection.close()

            with self.storage_patches(root):
                connection = Engine._open_storage()
                after_profiles = connection.execute(
                    """SELECT name, language, kind, ref_audio_path, prompt_path,
                              design_instruction, ref_text, is_default, seed_key,
                              seed_version, created_at, updated_at
                       FROM voice_profiles ORDER BY name"""
                ).fetchall()
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 5)
                self.assertEqual(
                    [tuple(row) for row in after_profiles],
                    [tuple(row) for row in before_profiles],
                )
                self.assertEqual(
                    tuple(connection.execute("SELECT * FROM app_seeds").fetchone()),
                    ("seed-clone", 2, "seed-installed"),
                )
                self.assertEqual(
                    tuple(connection.execute("SELECT * FROM audio_history").fetchone()),
                    ("take.wav", "vieneu", "truc_ly", "wav", "Xin chào", "audio-created"),
                )
                profiles = {profile["name"]: profile for profile in Engine.list_voices()}
                self.assertEqual(profiles["clone"]["language"], "vi")
                self.assertTrue(profiles["clone"]["is_default"])
                self.assertNotIn("preset_id", profiles["clone"])
                self.assertEqual(profiles["design"]["design_instruction"], "warm voice")
                self.assertNotIn("preset_id", profiles["design"])
                connection.close()

            self.assertEqual(reference.read_bytes(), b"reference audio")
            self.assertEqual(prompt.read_bytes(), b"prepared prompt")

    def test_schema_v3_migration_failure_keeps_original_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            voice_dir = root / "voices" / "broken"
            voice_dir.mkdir(parents=True)
            profile_file = voice_dir / "prompt.pt"
            profile_file.write_bytes(b"original prompt")
            connection = self.create_v3_database(root)
            connection.execute("PRAGMA ignore_check_constraints = ON")
            connection.execute(
                """
                INSERT INTO voice_profiles
                    (name, language, kind, prompt_path, created_at, updated_at)
                VALUES ('broken', 'fr', 'clone', 'voices/broken/prompt.pt', 'created', 'updated')
                """
            )
            connection.execute("PRAGMA ignore_check_constraints = OFF")
            connection.commit()
            connection.close()

            with self.storage_patches(root), self.assertRaises(sqlite3.IntegrityError):
                Engine._open_storage()

            connection = sqlite3.connect(root / "volo.db")
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 3)
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            self.assertIn("voice_profiles", tables)
            self.assertNotIn("voice_profiles_v4", tables)
            self.assertEqual(
                tuple(connection.execute("SELECT name, language FROM voice_profiles").fetchone()),
                ("broken", "fr"),
            )
            connection.close()
            self.assertEqual(profile_file.read_bytes(), b"original prompt")

    def test_schema_v4_migrates_preset_profiles_and_preserves_all_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            clone_dir = root / "voices" / "clone"
            clone_dir.mkdir(parents=True)
            reference = clone_dir / "reference.wav"
            prompt = clone_dir / "prompt.pt"
            reference.write_bytes(b"reference")
            prompt.write_bytes(b"prompt")
            connection = self.create_v4_database(root)
            connection.executemany(
                """
                INSERT INTO voice_profiles
                    (name, language, kind, preset_id, ref_audio_path, prompt_path,
                     design_instruction, ref_text, is_default, seed_key, seed_version,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "clone", "vi", "clone", None, "voices/clone/reference.wav",
                        "voices/clone/prompt.pt", None, "Xin chào", 1, "seed", 2,
                        "clone-created", "clone-updated",
                    ),
                    (
                        "design", "en", "design", None, None, None, "warm voice", None,
                        0, None, None, "design-created", "design-updated",
                    ),
                    (
                        "minh_quan_pro", None, "vieneu_preset", "minh_quan_pro", None,
                        None, None, None, 0, None, None, "preset-created", "preset-updated",
                    ),
                ],
            )
            connection.execute("INSERT INTO app_seeds VALUES (?, ?, ?)", ("seed", 2, "installed"))
            connection.execute(
                "INSERT INTO audio_history VALUES (?, ?, ?, ?, ?, ?)",
                ("take.wav", "vieneu", "minh_quan_pro", "wav", "Xin chào", "audio-created"),
            )
            connection.commit()
            before = [
                tuple(row)
                for row in connection.execute(
                    "SELECT * FROM voice_profiles ORDER BY name"
                )
            ]
            connection.close()

            with self.storage_patches(root):
                connection = Engine._open_storage()
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 5)
                self.assertEqual(
                    [tuple(row) for row in connection.execute(
                        "SELECT * FROM voice_profiles ORDER BY name"
                    )],
                    before,
                )
                self.assertEqual(
                    tuple(connection.execute("SELECT * FROM app_seeds").fetchone()),
                    ("seed", 2, "installed"),
                )
                self.assertEqual(
                    tuple(connection.execute("SELECT * FROM audio_history").fetchone()),
                    ("take.wav", "vieneu", "minh_quan_pro", "wav", "Xin chào", "audio-created"),
                )
                connection.close()

            self.assertEqual(reference.read_bytes(), b"reference")
            self.assertEqual(prompt.read_bytes(), b"prompt")

    def test_schema_v4_migration_failure_keeps_original_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile_file = root / "voices" / "broken" / "reference.wav"
            profile_file.parent.mkdir(parents=True)
            profile_file.write_bytes(b"original")
            connection = self.create_v4_database(root)
            connection.execute("PRAGMA ignore_check_constraints = ON")
            connection.execute(
                """
                INSERT INTO voice_profiles
                    (name, language, kind, preset_id, ref_audio_path, ref_text,
                     created_at, updated_at)
                VALUES ('broken', NULL, 'vieneu_preset', 'broken',
                        'voices/broken/reference.wav', NULL, 'created', 'updated')
                """
            )
            connection.commit()
            connection.close()

            with self.storage_patches(root), self.assertRaises(sqlite3.IntegrityError):
                Engine._open_storage()

            connection = sqlite3.connect(root / "volo.db")
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 4)
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            self.assertIn("voice_profiles", tables)
            self.assertNotIn("voice_profiles_v5", tables)
            self.assertEqual(
                tuple(connection.execute("SELECT name, preset_id FROM voice_profiles").fetchone()),
                ("broken", "broken"),
            )
            connection.close()
            self.assertEqual(profile_file.read_bytes(), b"original")

    def test_save_vieneu_seed_reference_keeps_id_audio_and_transcript_together(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "generated.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                name = Engine().save_vieneu_seed_reference(
                    "minh_quan_pro", "minh_quan_pro", str(source), "Xin chào"
                )
                profile = Engine.list_voices()[0]
                self.assertEqual(name, "minh_quan_pro")
                self.assertEqual(profile["preset_id"], "minh_quan_pro")
                self.assertEqual(profile["ref_text"], "Xin chào")
                self.assertEqual(Path(profile["ref_audio"]).read_bytes(), source.read_bytes())
                self.assertEqual(Path(profile["ref_audio"]).name, "reference.wav")
                loaded = Engine().load_voice_profile(name)
                self.assertEqual(loaded["preset_id"], "minh_quan_pro")
                self.assertEqual(loaded["ref_text"], "Xin chào")
                self.assertEqual(loaded["ref_audio"], profile["ref_audio"])

    def test_save_vieneu_seed_reference_is_idempotent_and_concurrent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "generated.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                engine = Engine()
                def save(_):
                    return engine.save_vieneu_seed_reference(
                        "minh_quan_pro", "minh_quan_pro", str(source), "Xin chào"
                    )

                with ThreadPoolExecutor(max_workers=6) as pool:
                    names = list(pool.map(save, range(12)))
                self.assertEqual(set(names), {"minh_quan_pro"})
                self.assertEqual(len(Engine.list_voices()), 1)
                profile_dir = root / "voices" / "minh_quan_pro"
                self.assertEqual([path.name for path in profile_dir.iterdir()], ["reference.wav"])
                self.assertEqual((profile_dir / "reference.wav").read_bytes(), source.read_bytes())

    def test_save_vieneu_seed_reference_preserves_ambiguous_and_name_conflicts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "generated.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                connection = Engine._open_storage()
                with connection:
                    for name in ("first", "second"):
                        connection.execute(
                            """
                            INSERT INTO voice_profiles
                                (name, language, kind, preset_id, created_at, updated_at)
                            VALUES (?, NULL, 'vieneu_preset', 'minh_quan_pro', 'created', 'updated')
                            """,
                            (name,),
                        )
                connection.close()
                before = Engine.list_voices()
                with self.assertRaisesRegex(ValueError, "Multiple voice profiles"):
                    Engine().save_vieneu_seed_reference(
                        "minh_quan_pro", "minh_quan_pro", str(source), "Xin chào"
                    )
                self.assertEqual(Engine.list_voices(), before)
                self.assertFalse((root / "voices" / "first").exists())

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "generated.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                connection = Engine._open_storage()
                with connection:
                    connection.execute(
                        """
                        INSERT INTO voice_profiles
                            (name, language, kind, prompt_path, created_at, updated_at)
                        VALUES ('minh_quan_pro', 'vi', 'clone', 'voices/minh_quan_pro/prompt.pt',
                                'created', 'updated')
                        """
                    )
                connection.close()
                before = Engine.list_voices()
                with self.assertRaisesRegex(ValueError, "clone voice profile"):
                    Engine().save_vieneu_seed_reference(
                        "minh_quan_pro", "minh_quan_pro", str(source), "Xin chào"
                    )
                self.assertEqual(Engine.list_voices(), before)
                self.assertFalse((root / "voices" / "minh_quan_pro").exists())

    def test_delete_seeded_vieneu_profile_removes_only_owned_wav(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "generated.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                Engine().save_vieneu_seed_reference(
                    "minh_quan_pro", "minh_quan_pro", str(source), "Xin chào"
                )
                profile_dir = root / "voices" / "minh_quan_pro"
                unrelated = profile_dir / "notes.txt"
                unrelated.write_text("keep", encoding="utf-8")
                model_asset = root / "models" / "vieneu" / "voice.bin"
                model_asset.parent.mkdir(parents=True)
                model_asset.write_bytes(b"model")

                self.assertTrue(Engine.delete_voice("minh_quan_pro"))
                self.assertEqual(Engine.list_voices(), [])
                self.assertFalse((profile_dir / "reference.wav").exists())
                self.assertEqual(unrelated.read_text(encoding="utf-8"), "keep")
                self.assertEqual(model_asset.read_bytes(), b"model")

    def test_delete_seeded_vieneu_profile_preserves_metadata_when_wav_unlink_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "generated.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                Engine().save_vieneu_seed_reference(
                    "minh_quan_pro", "minh_quan_pro", str(source), "Xin chào"
                )
                reference = (
                    root / "voices" / "minh_quan_pro" / "reference.wav"
                ).resolve()
                original_unlink = Path.unlink

                def fail_reference_unlink(path, *args, **kwargs):
                    if path == reference:
                        raise OSError("disk error")
                    return original_unlink(path, *args, **kwargs)

                with patch.object(Path, "unlink", new=fail_reference_unlink):
                    with self.assertRaisesRegex(OSError, "disk error"):
                        Engine.delete_voice("minh_quan_pro")

                self.assertEqual(
                    [voice["name"] for voice in Engine.list_voices()], ["minh_quan_pro"]
                )
                self.assertTrue(reference.is_file())

    def test_delete_seeded_vieneu_profile_restores_wav_when_database_delete_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "generated.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                Engine().save_vieneu_seed_reference(
                    "minh_quan_pro", "minh_quan_pro", str(source), "Xin chào"
                )
                reference = root / "voices" / "minh_quan_pro" / "reference.wav"
                with sqlite3.connect(root / "volo.db") as connection:
                    connection.execute(
                        """
                        CREATE TRIGGER reject_profile_delete
                        BEFORE DELETE ON voice_profiles
                        WHEN OLD.name = 'minh_quan_pro'
                        BEGIN
                            SELECT RAISE(ABORT, 'database error');
                        END
                        """
                    )

                with self.assertRaisesRegex(sqlite3.IntegrityError, "database error"):
                    Engine.delete_voice("minh_quan_pro")

                self.assertEqual(
                    [voice["name"] for voice in Engine.list_voices()], ["minh_quan_pro"]
                )
                self.assertTrue(reference.is_file())

    def test_audio_history_round_trip_and_delete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.storage_patches(root):
                entry = {
                    "file_name": "take.wav",
                    "provider": "vieneu",
                    "voice_name": "minh_quan_pro",
                    "format": "wav",
                    "text": "Xin chào",
                    "created_at": "2026-10-08T12:00:00+00:00",
                }
                Engine.record_audio_history(**entry)

                self.assertEqual(Engine.list_audio_history(), [entry])
                self.assertTrue(Engine.delete_audio_history("take.wav"))
                self.assertEqual(Engine.list_audio_history(), [])
                self.assertFalse(Engine.delete_audio_history("take.wav"))

    def test_audio_history_rejects_invalid_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.storage_patches(Path(tmp)):
                valid = {
                    "file_name": "take.wav",
                    "provider": "omnivoice",
                    "voice_name": "auto",
                    "format": "wav",
                    "text": "hello",
                    "created_at": "2026-10-08T12:00:00+00:00",
                }
                for key, value in (
                    ("file_name", "../take.wav"),
                    ("file_name", "take.flac"),
                    ("provider", "other"),
                    ("format", "mp3"),
                ):
                    with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                        Engine.record_audio_history(**{**valid, key: value})
                self.assertEqual(Engine.list_audio_history(), [])

    def test_save_voice_copies_reference_and_persists_metadata(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                saved_path = Path(engine.save_voice("demo", str(source), "xin chao", "vi"))
                voices = Engine.list_voices()
                self.assertEqual(len(voices), 1)
                self.assertEqual(voices[0]["language"], "vi")
                self.assertFalse(voices[0]["is_default"])
                self.assertEqual(Path(voices[0]["ref_audio"]).parent.name, "demo")
                self.assertTrue(saved_path.is_file())
                self.assertTrue((root / "voices" / "demo" / "reference.wav").is_file())
                self.assertNotEqual(Path(voices[0]["ref_audio"]), source)
                self.assertTrue(Engine.delete_voice("demo"))
                self.assertFalse((root / "voices" / "demo").exists())
                self.assertTrue(source.exists())

    def test_save_design_voice_persists_without_clone_files(self):
        engine = Engine()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.storage_patches(root):
                self.assertEqual(
                    engine.save_design_voice("designer", "warm, low, confident", "vi"),
                    "designer",
                )
                profile = Engine.list_voices()[0]
                self.assertEqual(profile["kind"], "design")
                self.assertEqual(profile["design_instruction"], "warm, low, confident")
                self.assertIsNone(profile["ref_audio"])
                self.assertIsNone(profile["ref_text"])
                self.assertEqual(
                    engine.load_voice_profile("designer"),
                    {"kind": "design", "instruct": "warm, low, confident"},
                )
                with self.assertRaises(ValueError):
                    engine.save_design_voice("invalid", " ")
                self.assertTrue(Engine.delete_voice("designer"))
                self.assertEqual(Engine.list_voices(), [])

    def test_save_vieneu_preset_persists_without_profile_files(self):
        engine = Engine()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.storage_patches(root):
                self.assertEqual(
                    engine.save_vieneu_preset("saved-preset", "minh_quan_pro"),
                    "saved-preset",
                )
                voice = Engine.list_voices()[0]
                self.assertEqual(
                    voice,
                    {
                        "name": "saved-preset",
                        "language": None,
                        "kind": "vieneu_preset",
                        "ref_audio": None,
                        "design_instruction": None,
                        "ref_text": None,
                        "is_default": False,
                        "preset_id": "minh_quan_pro",
                    },
                )
                self.assertEqual(
                    engine.load_voice_profile("saved-preset"),
                    {"kind": "vieneu_preset", "preset_id": "minh_quan_pro"},
                )
                with self.assertRaisesRegex(ValueError, "provider='vieneu'"):
                    engine.load_voice("saved-preset")
                self.assertFalse((root / "voices" / "saved-preset").exists())

    def test_save_vieneu_preset_rejects_invalid_id_and_duplicate_name(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                clone_path = Path(engine.save_voice("clone", str(source), language="vi"))
                engine.save_design_voice("design", "warm voice", "en")
                clone_audio = root / "voices" / "clone" / "reference.wav"
                for name, preset_id in (
                    ("invalid", "../preset"),
                    ("invalid", ""),
                    ("clone", "minh_quan_pro"),
                    ("design", "minh_quan_pro"),
                ):
                    with self.subTest(name=name, preset_id=preset_id), self.assertRaises(ValueError):
                        engine.save_vieneu_preset(name, preset_id)
                voices = {voice["name"]: voice for voice in Engine.list_voices()}
                self.assertEqual(set(voices), {"clone", "design"})
                self.assertEqual(voices["clone"]["kind"], "clone")
                self.assertEqual(voices["design"]["kind"], "design")
                self.assertTrue(clone_path.is_file())
                self.assertEqual(clone_audio.read_bytes(), source.read_bytes())

    def test_clone_and_design_saves_cannot_replace_vieneu_preset(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                engine.save_vieneu_preset("protected", "minh_quan_pro")
                with self.assertRaisesRegex(ValueError, "cannot be replaced by a Clone"):
                    engine.save_voice("protected", str(source))
                with self.assertRaisesRegex(ValueError, "cannot be replaced by a Design"):
                    engine.save_design_voice("protected", "warm voice")
                self.assertEqual(
                    Engine.list_voices(),
                    [
                        {
                            "name": "protected",
                            "language": None,
                            "kind": "vieneu_preset",
                            "ref_audio": None,
                            "design_instruction": None,
                            "ref_text": None,
                            "is_default": False,
                            "preset_id": "minh_quan_pro",
                        }
                    ],
                )
                self.assertFalse((root / "voices" / "protected").exists())

    def test_delete_vieneu_preset_keeps_model_assets_and_profile_files(self):
        engine = Engine()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.storage_patches(root):
                engine.save_vieneu_preset("preset", "minh_quan_pro")
                model_asset = root / "models" / "vieneu" / "gguf" / "model.gguf"
                model_asset.parent.mkdir(parents=True)
                model_asset.write_bytes(b"model")
                unrelated_file = root / "voices" / "preset" / "keep.txt"
                unrelated_file.parent.mkdir(parents=True)
                unrelated_file.write_text("keep")

                self.assertTrue(Engine.delete_voice("preset"))

                self.assertEqual(model_asset.read_bytes(), b"model")
                self.assertEqual(unrelated_file.read_text(), "keep")
                self.assertEqual(Engine.list_voices(), [])

    def test_default_voice_is_unique_per_language(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                engine.save_voice("vi_one", str(source), language="vi", is_default=True)
                engine.save_voice("vi_two", str(source), language="vi", is_default=True)
                engine.save_voice("en_one", str(source), language="en", is_default=True)
                defaults = {
                    voice["language"]: voice["name"]
                    for voice in Engine.list_voices()
                    if voice["is_default"]
                }
                self.assertEqual(defaults, {"vi": "vi_one", "en": "en_one"})

    def test_legacy_profiles_migrate_to_local_paths(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.wav"
            self.write_wav(source)
            voices_dir = root / "voices"
            voices_dir.mkdir()
            (voices_dir / "legacy.pt").write_bytes(b"legacy prompt")
            (voices_dir / "legacy.json").write_text(
                json.dumps(
                    {
                        "name": "legacy",
                        "ref_audio": str(source),
                        "ref_text": "legacy text",
                    }
                )
            )
            with self.storage_patches(root):
                voices = Engine.list_voices()
                self.assertEqual(voices[0]["name"], "legacy")
                self.assertTrue((voices_dir / "legacy" / "prompt.pt").exists())
                self.assertTrue((voices_dir / "legacy" / "reference.wav").exists())
                self.assertNotEqual(Path(voices[0]["ref_audio"]), source)
                self.assertTrue((voices_dir / "legacy.json").exists())

    def test_seed_import_is_idempotent_and_marks_default(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_folder = root / "seed-voices" / "omnivoice-demo"
            seed_folder.mkdir(parents=True)
            source = seed_folder / "reference.wav"
            self.write_wav(source)
            (seed_folder / "manifest.json").write_text(
                json.dumps(
                    {
                        "id": "omnivoice-demo",
                        "version": 1,
                        "name": "OmniVoice-Demo",
                        "language": "vi",
                        "default": True,
                        "ref_text": "Xin chao",
                        "audio": "reference.wav",
                    }
                )
            )
            with self.storage_patches(root):
                first = engine.import_seed_voices(str(seed_folder.parent))
                second = engine.import_seed_voices(str(seed_folder.parent))
                self.assertEqual([item["name"] for item in first["imported"]], ["OmniVoice-Demo"])
                self.assertEqual(second["skipped"][0]["reason"], "already_installed")
                profile = Engine.list_voices()[0]
                self.assertEqual(profile["language"], "vi")
                self.assertTrue(profile["is_default"])
                self.assertIn(root.resolve(), Path(profile["ref_audio"]).resolve().parents)

    def test_seed_manifest_rejects_path_traversal(self):
        engine = Engine()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_folder = root / "seed-voices" / "bad-seed"
            seed_folder.mkdir(parents=True)
            (root / "outside.wav").write_bytes(b"not audio")
            (seed_folder / "manifest.json").write_text(
                json.dumps(
                    {
                        "id": "bad-seed",
                        "version": 1,
                        "name": "BadSeed",
                        "language": "en",
                        "default": False,
                        "audio": "../outside.wav",
                    }
                )
            )
            with self.storage_patches(root):
                result = engine.import_seed_voices(str(seed_folder.parent))
                self.assertEqual(len(result["errors"]), 1)
                self.assertIn("inside its seed folder", result["errors"][0]["message"])


if __name__ == "__main__":
    unittest.main()
