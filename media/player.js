// @ts-check
(function () {
  // @ts-ignore acquireVsCodeApi is injected by VS Code
  const vscode = acquireVsCodeApi();
  const audio = /** @type {HTMLAudioElement} */ (document.getElementById("audio"));
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  /** @type {{name: string, genre: string}[]} */
  let stations = [];
  let state = { stationIndex: 0, status: "idle", volume: 0.7, muted: false };

  const send = (/** @type {any} */ m) => vscode.postMessage(m);
  const status = (/** @type {string} */ s, /** @type {string=} */ error) => send({ type: "status", status: s, error });

  // VS Code's webviews block play() without a user gesture. Chromium unlocks a media
  // element for good once play() is called during a real gesture, so on the first
  // pointerdown anywhere in the view we "prime" the element with a silent clip.
  // After that, the extension (status bar, commands, keybindings) can start playback.
  let unlocked = false;
  const silentWav = () => {
    const rate = 8000, samples = 800, buf = new ArrayBuffer(44 + samples);
    const v = new DataView(buf);
    const str = (/** @type {number} */ o, /** @type {string} */ s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + samples, true); str(8, "WAVEfmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, "data"); v.setUint32(40, samples, true);
    for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  };
  document.addEventListener(
    "pointerdown",
    () => {
      if (unlocked) return;
      unlocked = true;
      if (!audio.src) {
        audio.src = silentWav();
        audio.play().catch(() => {}); // AbortError is expected if a real station loads right after
      }
      send({ type: "unlocked" });
    },
    { capture: true },
  );

  const isStream = () => !!audio.src && !audio.src.startsWith("blob:");
  audio.addEventListener("playing", () => isStream() && status("playing"));
  audio.addEventListener("waiting", () => isStream() && status("loading"));
  audio.addEventListener("error", () => {
    if (!isStream()) return;
    const e = audio.error;
    status("error", e ? `MediaError ${e.code}: ${e.message || "unknown"}` : "unknown error");
  });

  window.addEventListener("message", (event) => {
    const m = event.data;
    switch (m.type) {
      case "init":
        stations = m.stations;
        state = m.state;
        audio.muted = !!state.muted;
        render();
        break;
      case "state":
        state = m.state;
        audio.muted = !!state.muted;
        render();
        break;
      case "mute":
        audio.muted = !!m.value;
        break;
      case "play":
        audio.volume = m.volume;
        audio.src = m.url;
        audio.play().catch((/** @type {Error} */ err) => {
          if (err.name === "AbortError") return; // superseded by a newer play/pause
          if (err.name === "NotAllowedError") status("needsClick");
          else status("error", `${err.name}: ${err.message}`);
        });
        break;
      case "pause":
        audio.pause();
        // Drop the connection so a paused radio doesn't keep downloading.
        audio.removeAttribute("src");
        audio.load();
        break;
      case "volume":
        audio.volume = m.value;
        break;
    }
  });

  $("toggle").addEventListener("click", () => send({ type: "command", command: "toggle" }));
  $("next").addEventListener("click", () => send({ type: "command", command: "next" }));
  $("prev").addEventListener("click", () => send({ type: "command", command: "previous" }));
  $("mute").addEventListener("click", () => send({ type: "command", command: "mute" }));
  $("volume").addEventListener("input", (e) =>
    send({ type: "volume", value: Number(/** @type {HTMLInputElement} */ (e.target).value) }),
  );

  function render() {
    const s = stations[state.stationIndex];
    $("station").textContent = s ? s.name : "—";
    const labels = {
      idle: "Idle",
      loading: "Tuning in…",
      playing: "Playing",
      paused: "Paused",
      error: "Error",
      needsClick: "Click ▶ to start (VS Code needs one click first)",
    };
    $("status").textContent = labels[/** @type {keyof typeof labels} */ (state.status)] ?? state.status;
    $("toggle").textContent = state.status === "playing" || state.status === "loading" ? "⏸" : "▶";
    const muteBtn = $("mute");
    muteBtn.textContent = state.muted ? "🔇" : "🔊";
    muteBtn.title = state.muted ? "Unmute" : "Mute";
    muteBtn.classList.toggle("active", !!state.muted);
    /** @type {HTMLInputElement} */ ($("volume")).value = String(state.volume);
    const list = $("stations");
    list.replaceChildren(
      ...stations.map((st, i) => {
        const li = document.createElement("li");
        li.textContent = st.name;
        li.title = st.genre;
        li.className = i === state.stationIndex ? "active" : "";
        li.addEventListener("click", () => send({ type: "command", command: "select", index: i }));
        return li;
      }),
    );
  }

  // Heartbeat: lets the extension (and the experiment) see whether audio is really advancing.
  setInterval(() => {
    if (!isStream()) return;
    send({
      type: "tick",
      currentTime: audio.currentTime,
      paused: audio.paused,
      readyState: audio.readyState,
      visibility: document.visibilityState,
    });
  }, 1000);

  send({ type: "ready" });
})();
