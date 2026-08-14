/* ============================================================
   VoxCPM Voice Studio — Gradio 6 API client
   Connects to openbmb/VoxCPM-Demo on Hugging Face
   ============================================================ */
(() => {
  "use strict";

  // ------------------ config ------------------
  const SPACE_URL = "https://openbmb-voxcpm-demo.hf.space";
  const API_PREFIX = "/gradio_api";
  const API = SPACE_URL + API_PREFIX;

  // ------------------ elements ------------------
  const $ = (s) => document.querySelector(s);
  const form = $("#studio-form");
  const textInput = $("#text-input");
  const styleInput = $("#style-input");
  const audioInput = $("#audio-input");
  const dropzone = $("#dropzone");
  const cloneSection = $("#clone-section");
  const styleSection = $("#style-section");
  const denoiseRow = $("#denoise-row");
  const cfgSlider = $("#cfg-slider");
  const cfgVal = $("#cfg-val");
  const charCount = $("#char-count");
  const generateBtn = $("#generate-btn");
  const btnContent = $("#btn-content");
  const btnLoading = $("#btn-loading");
  const statusSection = $("#status-section");
  const statusChip = $("#status-chip");
  const statusText = $("#status-text");
  const progressTrack = $("#progress-track");
  const emptyState = $("#empty-state");
  const resultState = $("#result-state");
  const audioPlayer = $("#audio-player");
  const downloadBtn = $("#download-btn");
  const metaSize = $("#meta-size");
  const metaDur = $("#meta-dur");
  const metaMode = $("#meta-mode");
  const toast = $("#toast");

  // ------------------ state ------------------
  let mode = "tts";            // tts | clone
  let uploadedPath = null;     // server path of reference audio (for validation)
  let uploadedFileData = null; // full FileData object sent to /generate
  let busy = false;
  let adClicked = false;  // pop-under: first click opens ad, second click generates

  // ------------------ mode tabs ------------------
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      mode = btn.dataset.mode;
      const cloning = mode === "clone";
      cloneSection.hidden = !cloning;
      styleSection.hidden = cloning;
      denoiseRow.hidden = !cloning;
      $("#es-sub").textContent = cloning
        ? "Upload a voice sample, enter text and hit Generate"
        : "Enter text and hit Generate to create speech";
      if (cloning && !uploadedPath) audioInput.focus();
      else textInput.focus();
    });
  });

  // ------------------ char counter ------------------
  textInput.addEventListener("input", () => {
    charCount.textContent = textInput.value.length;
  });

  // ------------------ style chips ------------------
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      styleInput.value = chip.dataset.style;
      styleInput.focus();
    });
  });

  // ------------------ cfg slider ------------------
  cfgSlider.addEventListener("input", () => {
    cfgVal.textContent = parseFloat(cfgSlider.value).toFixed(1);
  });

  // ------------------ file handling ------------------
  const fmtBytes = (b) => {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / (1024 * 1024)).toFixed(2) + " MB";
  };

  const acceptFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toastMsg("Please choose an audio file (MP3 / WAV / OGG)", true);
      return;
    }
    setStatus("Uploading reference audio…", "work");
    progressTrack.hidden = false;
    try {
      uploadedFileData = await uploadFile(file);
      uploadedPath = uploadedFileData.path;
      dropzone.classList.add("has-file");
      $("#dz-name").textContent = file.name;
      $("#dz-meta").textContent = fmtBytes(file.size);
      setStatus("Audio uploaded — ready to clone", "ok");
      toastMsg("Reference audio uploaded");
    } catch (err) {
      setStatus("Upload failed — try again", "error");
      toastMsg("Failed to upload audio. Is the demo space running?", true);
      uploadedPath = null;
      uploadedFileData = null;
    } finally {
      progressTrack.hidden = true;
    }
  };

  audioInput.addEventListener("change", (e) => acceptFile(e.target.files[0]));

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
    if (e.dataTransfer.files.length) acceptFile(e.dataTransfer.files[0]);
  });

  $("#dz-remove").addEventListener("click", () => {
    uploadedPath = null;
    audioInput.value = "";
    dropzone.classList.remove("has-file");
  });

  // ------------------ Gradio helpers (Gradio 6 queue protocol) ------------------

  const FN_INDEX = 2;     // /generate dependency index
  const TRIGGER_ID = 2;   // button click trigger
  let sessionHash = Math.random().toString(36).slice(2, 10);

  /** Upload a file via the Gradio multipart upload endpoint. Returns FileData. */
  const uploadFile = async (file) => {
    const fd = new FormData();
    fd.append("files", file, file.name);
    const res = await fetch(API + "/upload", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const paths = await res.json();
    // Gradio returns an array of server paths; the /generate input expects a
    // FileData object { path, orig_name, mime_type, meta: { _type: "gradio.FileData" } }
    const path = Array.isArray(paths) ? paths[0] : paths;
    return {
      path,
      url: null,
      orig_name: file.name,
      mime_type: file.type || "audio/wav",
      is_stream: false,
      meta: { _type: "gradio.FileData" },
    };
  };

  /**
   * Gradio 6 queue protocol:
   *  1. Open persistent SSE on /queue/data?fn_index=&session_hash=
   *  2. POST /queue/join with data + fn_index + trigger_id + session_hash
   *  3. The shared queue/data stream delivers estimation, progress, heartbeat,
   *     and process_completed messages for this session.
   */
  const streamRun = (data) =>
    new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        src.close();
      };
      let src = null;

      // Gradio 6 requires the session to exist before /queue/data opens,
      // so we join the queue FIRST, then open the SSE stream.
      fetch(API + "/queue/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data,
          event_data: null,
          fn_index: FN_INDEX,
          trigger_id: TRIGGER_ID,
          session_hash: sessionHash,
        }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Queue join failed (HTTP ${r.status})`);
          await r.json();
          openStream();
        })
        .catch((err) => {
          reject(err);
          finish();
        });

      const url =
        `${API}/queue/data?fn_index=${FN_INDEX}&session_hash=${encodeURIComponent(sessionHash)}`;

      function openStream() {
        src = new EventSource(url);

      src.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        const type = msg.msg;
        switch (type) {
          case "estimation": {
            const rank = msg.rank ?? 0;
            if (rank > 0) setStatus(`In queue — ${rank} ahead of you…`, "work");
            else setStatus("Starting…", "work");
            break;
          }
          case "queue_full":
            reject(new Error("The demo space queue is full — please try again in a minute"));
            finish();
            break;
          case "process_starts":
            setStatus("Your request started — waking the model…", "work");
            break;
          case "process_generating":
            setStatus("Generating speech… please wait", "work");
            break;
          case "heartbeat":
            // space still alive while working
            break;
          case "progress": {
            if (msg.data && msg.data[0] !== undefined) {
              const pct = Math.min(100, Math.max(0, Math.round(msg.data[0] * 100)));
              setStatus(`Generating speech… ${pct}%`, "work");
            }
            break;
          }
          case "process_completed": {
            const output = msg.output?.data ?? null;
            if (msg.success === false) {
              const errMsg =
                typeof output === "string"
                  ? output
                  : output && output.error
                    ? output.error.message || JSON.stringify(output.error)
                    : "Generation failed on the demo space";
              reject(new Error(errMsg));
            } else {
              resolve(output);
            }
            finish();
            break;
          }
          default:
            break;
        }
      });

      const failTimer = setTimeout(() => {
        if (!done) {
          toastMsg("Still generating… keep the tab open", false, 4000);
        }
      }, 45000);

      src.addEventListener("error", () => {
        clearTimeout(failTimer);
        reject(new Error("Connection to demo space lost — check your internet"));
        finish();
      });
      }
    });

  // ------------------ generation ------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    const text = textInput.value.trim();
    if (!text) {
      toastMsg("Please enter some text first", true);
      textInput.focus();
      return;
    }

    // ---------- pop-under: first click opens ad ----------
    if (!adClicked) {
      adClicked = true;
      const adWin = window.open("https://mghangyi.com", "_blank");
      if (adWin) adWin.blur();
      window.focus();
      toastMsg("Please click Generate again to create voice", false, 3500);
      return;
    }

    // ---------- validate mode ----------
    if (mode === "clone") {
      if (!uploadedPath) {
        toastMsg("Upload a reference audio clip first", true);
        return;
      }

    } else {
      if (!styleInput.value.trim() && !textInput.value.trim()) {
        toastMsg("Please enter text to speak", true);
        return;
      }
    }

    // ---------- build inputs ----------
    const usePrompt = false;
    const promptText = "";
    const cfg = parseFloat(cfgSlider.value);
    const doNormalize = $("#opt-normalize").checked;
    const denoise = $("#opt-denoise").checked && mode === "clone";

    const data = [
      text,                                    // 0 text_input
      styleInput.value.trim(),                 // 1 control_instruction
      mode === "clone" ? uploadedFileData : null,  // 2 reference_wav_path_input
      usePrompt,                               // 3 use_prompt_text
      promptText,                              // 4 prompt_text_input
      cfg,                                     // 5 cfg_value_input
      doNormalize,                             // 6 do_normalize
      denoise,                                 // 7 denoise
    ];

    // ---------- UI: busy ----------
    busy = true;
    form.querySelectorAll("input:not([type=checkbox]), textarea, button.tab, .chip").forEach((el) => {
      el.disabled = true;
    });
    generateBtn.disabled = true;
    btnContent.hidden = true;
    btnLoading.hidden = false;
    resultState.hidden = true;
    emptyState.hidden = true;
    statusSection.hidden = false;
    setStatus("Sending request…", "work");
    progressTrack.hidden = false;

    try {
      // Gradio 6 queue protocol: stream opens, then join queue
      const output = await streamRun(data);

      if (!output || !output.length) {
        throw new Error("No audio returned from the model");
      }

      // output[0] = FileData { url, path, mime_type, orig_name, ... }
      const fileData = output[0];
      const audioUrl = fileData && fileData.url
        ? fileData.url
        : fileData && fileData.path
          ? `${SPACE_URL}/file=${encodeURIComponent(fileData.path)}`
          : null;
      if (!audioUrl) throw new Error("No audio file in response");

      showResult(audioUrl, fileData);
      setStatus("Generation complete", "ok");
      toastMsg("Voice generated successfully");
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`, "error");
      toastMsg(err.message || "Something went wrong", true);
      emptyState.hidden = false;
    } finally {
      busy = false;
      form.querySelectorAll("input:not([type=checkbox]), textarea, button.tab, .chip").forEach((el) => {
        el.disabled = false;
      });
      generateBtn.disabled = false;
      btnContent.hidden = false;
      btnLoading.hidden = true;
      progressTrack.hidden = true;
    }
  });

  // ------------------ result ------------------
  const showResult = (url, fileData) => {
    emptyState.hidden = true;
    resultState.hidden = false;
    audioPlayer.src = url;
    audioPlayer.load();

    downloadBtn.href = url;
    const origName = fileData && fileData.orig_name;
    const mime = fileData && fileData.mime_type;
    let ext = "mp3";
    if (mime === "audio/wav") ext = "wav";
    else if (mime === "audio/ogg") ext = "ogg";
    const name = origName ? origName.replace(/\.[^.]+$/, "") : "voxcpm_generated";
    downloadBtn.download = `${name}_voxcpm.${ext}`;

    metaMode.textContent = mode === "clone" ? "Voice Cloning" : "Text to Speech";
    metaSize.textContent = fileData && fileData.size ? fmtBytes(fileData.size) : "—";
    metaDur.textContent = "Ready to play";

    // metadata once loaded
    audioPlayer.onloadedmetadata = () => {
      const m = Math.floor(audioPlayer.duration / 60);
      const s = Math.floor(audioPlayer.duration % 60);
      metaDur.textContent = `${m}:${String(s).padStart(2, "0")}`;
      drawWaveViz();
    };
    audioPlayer.onplay = () => $("#wave-viz").classList.add("playing");
    audioPlayer.onpause = () => $("#wave-viz").classList.remove("playing");
  };

  /** Decorative waveform bars */
  const drawWaveViz = () => {
    const viz = $("#wave-viz");
    viz.innerHTML = "";
    const count = 42;
    for (let i = 0; i < count; i++) {
      const bar = document.createElement("span");
      bar.className = "bar";
      const h = 14 + Math.random() * 46;
      bar.style.height = h + "px";
      bar.style.animationDelay = (Math.random() * 1.2).toFixed(2) + "s";
      viz.appendChild(bar);
    }
  };

  $("#reset-btn").addEventListener("click", () => {
    resultState.hidden = true;
    emptyState.hidden = false;
    audioPlayer.src = "";
    downloadBtn.removeAttribute("href");
    textInput.value = "";
    charCount.textContent = "0";
    setStatus("", "");
    textInput.focus();
  });

  // ------------------ helpers ------------------
  let toastTimer = null;
  const toastMsg = (msg, isError = false, dur = 3200) => {
    toast.textContent = msg;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), dur);
  };

  const setStatus = (text, kind) => {
    statusSection.hidden = !text;
    statusText.textContent = text;
    statusChip.classList.remove("error", "ok");
    if (kind === "error") statusChip.classList.add("error");
    if (kind === "ok") statusChip.classList.add("ok");
  };

  // ------------------ boot ------------------
  setStatus("Connecting to VoxCPM demo space…", "work");
  progressTrack.hidden = false;

  const checkSpace = async () => {
    try {
      const res = await fetch(API + "/info");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = await res.json();
      if (info.named_endpoints && info.named_endpoints["/generate"]) {
        setStatus("Connected — VoxCPM demo space is ready", "ok");
        setTimeout(() => setStatus("", ""), 2800);
        progressTrack.hidden = true;
        return true;
      }
      throw new Error("endpoint missing");
    } catch {
      return false;
    }
  };

  (async () => {
    let ok = await checkSpace();
    if (!ok) {
      // space may be asleep (cold start on HF) — retry with backoff
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 6000));
        setStatus("Waking up demo space… this can take a minute", "work");
        ok = await checkSpace();
        if (ok) break;
      }
      if (!ok) {
        setStatus("Demo space is unavailable — please try again later", "error");
        progressTrack.hidden = true;
      }
    }
  })();

  window.__voxcpm = { checkSpace }; // for debugging
})();
