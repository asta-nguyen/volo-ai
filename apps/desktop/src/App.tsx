import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import {
  SidecarClient,
  type AudioFormat,
  type Language,
  type ProgressEvent,
  type SynthesisResult,
  type VoiceMode,
  type VoiceProfile,
} from "./lib/sidecar";

const client = new SidecarClient();
const LANGUAGE_LABELS: Record<Language, string> = { en: "English", vi: "Vietnamese" };

function readLanguage(): Language {
  return localStorage.getItem("volo-ai.language") === "vi" ? "vi" : "en";
}

function Icon({ name }: { name: "wave" | "folder" | "library" | "download" | "play" | "plus" }) {
  const paths = {
    wave: "M3 12h3l2-7 4 14 2-7h7",
    folder: "M3 6.5h6l2 2h10v9H3z",
    library: "M4 5h16M4 10h16M4 15h10M4 20h16",
    download: "M12 3v11m0 0 4-4m-4 4-4-4M4 20h16",
    play: "m9 6 9 6-9 6z",
    plus: "M12 5v14M5 12h14",
  } as const;
  return (
    <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

function App() {
  const [modelReady, setModelReady] = useState(false);
  const [modelProgress, setModelProgress] = useState<ProgressEvent | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [mode, setMode] = useState<VoiceMode>("auto");
  const [text, setText] = useState("The quietest tools often do the most important work.");
  const [speed, setSpeed] = useState(1);
  const [format, setFormat] = useState<AudioFormat>("wav");
  const [refAudio, setRefAudio] = useState<string | null>(null);
  const [refText, setRefText] = useState("");
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("auto");
  const [profileName, setProfileName] = useState("");
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineOnline, setEngineOnline] = useState(false);

  const audioUrl = useMemo(() => (result ? convertFileSrc(result.audio_path) : null), [result]);

  useEffect(() => {
    const unsubscribe = client.onProgress(setModelProgress);
    let active = true;
    void (async () => {
      try {
        const status = await client.request<{
          model_ready: boolean;
          device: string;
          languages: Language[];
        }>({ type: "status" });
        if (!active) return;
        setEngineOnline(true);
        if (status.model_ready) {
          setModelReady(true);
          await refreshVoices();
        } else {
          await prepareModel();
        }
      } catch (reason) {
        if (active) setSetupError(reason instanceof Error ? reason.message : "Local engine unavailable");
      }
    })();
    return () => {
      active = false;
      unsubscribe();
      void client.stop();
    };
  }, []);

  async function prepareModel() {
    setSetupError(null);
    try {
      await client.request<{ model_ready: boolean }>({ type: "prepare_model" });
      setModelReady(true);
      await refreshVoices();
    } catch (reason) {
      setSetupError(reason instanceof Error ? reason.message : "Model setup failed");
    }
  }

  async function refreshVoices() {
    const response = await client.request<{ voices: VoiceProfile[] }>({ type: "list_voices" });
    setVoices(response.voices);
  }

  function changeLanguage(next: Language) {
    setLanguage(next);
    localStorage.setItem("volo-ai.language", next);
  }

  async function chooseReference() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "ogg"] }],
    });
    if (typeof selected === "string") setRefAudio(selected);
  }

  async function synthesize() {
    setError(null);
    if (!text.trim()) return setError("Enter some text before generating audio.");
    if (mode === "file" && !refAudio) return setError("Choose a reference audio file first.");
    if (mode === "profile" && selectedVoice === "auto") return setError("Select a saved voice profile first.");
    setIsGenerating(true);
    setResult(null);
    try {
      const response = await client.request<SynthesisResult>({
        type: "synthesize",
        text,
        language,
        voice: mode,
        voice_name: mode === "profile" ? selectedVoice : undefined,
        ref_audio: mode === "file" ? refAudio : undefined,
        ref_text: mode === "file" ? refText || undefined : undefined,
        speed,
        format,
        steps: 32,
      });
      setResult(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Synthesis failed");
    } finally {
      setIsGenerating(false);
    }
  }

  async function saveProfile() {
    if (!refAudio || !profileName.trim()) return setError("Choose a file and enter a voice name.");
    try {
      await client.request({ type: "save_voice", name: profileName.trim(), ref_audio: refAudio, ref_text: refText || undefined });
      setProfileName("");
      await refreshVoices();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save voice");
    }
  }

  async function exportAudio() {
    if (!result) return;
    const destination = await save({
      defaultPath: `volo-ai-output.${result.format}`,
      filters: [{ name: result.format.toUpperCase(), extensions: [result.format] }],
    });
    if (typeof destination === "string") {
      try {
        await copyFile(result.audio_path, destination);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Export failed");
      }
    }
  }

  if (!modelReady) {
    const progress = modelProgress?.progress ?? 0;
    return (
      <main className="setup-screen">
        <div className="setup-mark"><Icon name="wave" /></div>
        <p className="eyebrow">VOLO AI / FIRST RUN</p>
        <h1>Prepare your local voice engine</h1>
        <p className="setup-copy">The model stays on this machine. Download it once, then synthesize offline with your own voices and scripts.</p>
        <section className="setup-card" aria-live="polite">
          <div className="setup-card-head">
            <div>
              <span className="label">MODEL PACKAGE</span>
              <h2>{modelProgress?.phase === "verify" ? "Verifying local assets" : "OmniVoice multilingual core"}</h2>
            </div>
            <span className="mono">{Math.round(progress * 100)}%</span>
          </div>
          <div className="progress-track"><span style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>
          <div className="setup-meta">
            <span>{modelProgress?.message ?? "Waiting for the local engine"}</span>
            <span className="mono">EN / VI · OFFLINE READY</span>
          </div>
          {setupError && <p className="inline-error">{setupError}</p>}
          <button className="button primary setup-button" onClick={() => void prepareModel()} disabled={!engineOnline && !setupError}>
            {setupError ? "Retry download" : "Download model"}
          </button>
          <p className="fine-print">You can cancel this window and resume the download later.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Icon name="wave" /></div><div><strong>Volo AI</strong><span>LOCAL VOICE STUDIO</span></div></div>
        <div className="side-section">
          <span className="side-label">WORKSPACE</span>
          <button className="side-link active"><Icon name="wave" />Synthesize</button>
          <button className="side-link" onClick={() => setMode("profile")}><Icon name="library" />Voice profiles</button>
        </div>
        <div className="side-section side-bottom">
          <span className="side-label">ENGINE</span>
          <div className="engine-status"><span className="status-dot" />Offline ready</div>
          <span className="mono side-meta">{language.toUpperCase()} · LOCAL</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><span className="eyebrow">VOICE WORKSPACE / 01</span><h1>Make a voice worth hearing.</h1></div><div className="topbar-meta"><span className="status-dot" />MODEL READY <span className="mono">24 KHZ</span></div></header>
        <div className="workspace-grid">
          <section className="editor-pane">
            <div className="pane-heading"><div><span className="label">SCRIPT CANVAS</span><h2>Untitled speech</h2></div><span className="mono character-count">{text.length.toString().padStart(3, "0")} CH</span></div>
            <textarea aria-label="Speech script" value={text} onChange={(event) => setText(event.target.value)} className="script-input" spellCheck={false} />
            <div className="editor-footer"><span>Line 01</span><span className="mono">{language === "vi" ? "Vietnamese diacritics enabled" : "English pronunciation"}</span></div>
            {error && <p className="inline-error">{error}</p>}
            <div className="result-well">
              <div className="pane-heading"><div><span className="label">OUTPUT PREVIEW</span><h2>{result ? "Rendered take" : "Nothing rendered yet"}</h2></div>{result && <span className="ready-badge">READY</span>}</div>
              {audioUrl ? <><audio className="audio-player" controls src={audioUrl} /><div className="waveform" aria-hidden="true">{Array.from({ length: 48 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 17) % 35)}%` }} />)}</div></> : <div className="empty-preview"><Icon name="play" /><span>Generate a take to audition it here.</span></div>}
            </div>
          </section>

          <aside className="parameter-deck">
            <div className="deck-block"><span className="label">LANGUAGE</span><div className="segmented language-switch">{(["en", "vi"] as Language[]).map((item) => <button key={item} className={language === item ? "selected" : ""} onClick={() => changeLanguage(item)}>{LANGUAGE_LABELS[item]}</button>)}</div></div>
            <div className="deck-block"><span className="label">VOICE SOURCE</span><div className="mode-list"><button className={mode === "auto" ? "mode-option selected" : "mode-option"} onClick={() => setMode("auto")}><span>Auto voice</span><small>Let the model choose</small></button><button className={mode === "file" ? "mode-option selected" : "mode-option"} onClick={() => setMode("file")}><span>Clone from file</span><small>Use a local reference</small></button><button className={mode === "profile" ? "mode-option selected" : "mode-option"} onClick={() => setMode("profile")}><span>Saved profile</span><small>Reuse a local voice</small></button></div></div>
            {mode === "file" && <div className="deck-block"><span className="label">REFERENCE FILE</span><button className="file-picker" onClick={() => void chooseReference()}><Icon name="folder" /><span>{refAudio ? refAudio.split(/[\\/]/).pop() : "Choose audio file"}</span></button><textarea aria-label="Reference transcript" placeholder="Optional transcript" value={refText} onChange={(event) => setRefText(event.target.value)} className="small-input" /><div className="profile-save"><input aria-label="Voice profile name" placeholder="Save as profile" value={profileName} onChange={(event) => setProfileName(event.target.value)} /><button className="icon-button" aria-label="Save voice profile" onClick={() => void saveProfile()}><Icon name="plus" /></button></div></div>}
            {mode === "profile" && <div className="deck-block"><span className="label">VOICE LIBRARY</span><select value={selectedVoice} onChange={(event) => setSelectedVoice(event.target.value)} className="select-input"><option value="auto">Select saved voice</option>{voices.map((voice) => <option key={voice.name} value={voice.name}>{voice.name}</option>)}</select>{voices.length === 0 && <p className="helper">Save a reference file to create your first profile.</p>}</div>}
            <div className="deck-block"><div className="control-row"><span className="label">SPEED</span><span className="mono value-readout">{speed.toFixed(2)}×</span></div><input aria-label="Speech speed" type="range" min="0.25" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></div>
            <div className="deck-block"><span className="label">OUTPUT FORMAT</span><div className="segmented"><button className={format === "wav" ? "selected" : ""} onClick={() => setFormat("wav")}>WAV</button><button className={format === "mp3" ? "selected" : ""} onClick={() => setFormat("mp3")}>MP3</button></div></div>
            <div className="deck-actions"><button className="button primary render-button" onClick={() => void synthesize()} disabled={isGenerating}>{isGenerating ? "Rendering..." : <><Icon name="play" />Render speech</>}</button>{result && <button className="button secondary" onClick={() => void exportAudio()}><Icon name="download" />Export {result.format.toUpperCase()}</button>}</div>
          </aside>
        </div>
      </section>
      <footer className="status-ribbon"><span><span className="status-dot" />Engine ready</span><span className="mono">DEVICE / {engineOnline ? "AUTO" : "OFFLINE"}</span><span className="mono">SAMPLE RATE / 24000 HZ</span><span className="status-right">ALL AUDIO STAYS LOCAL</span></footer>
    </main>
  );
}

export default App;
