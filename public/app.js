const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const letters = ["A", "B", "C", "D"];

if (location.protocol === "file:") {
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Common Ground</span></div>
      </header>
      <section class="waiting">
        <div class="panel setup-panel">
          <p class="kicker">One quick setup</p>
          <h1>Start the live quiz first.</h1>
          <p class="intro">Close this tab, then double-click <strong>start-quiz.command</strong> in the quizz folder. The correct page will open automatically.</p>
        </div>
      </section>
    </div>`;
  throw new Error("The quiz must be opened through its local server.");
}

const session = {
  role: sessionStorage.getItem("quiz-role") || null,
  code: sessionStorage.getItem("quiz-code") || null,
  hostKey: sessionStorage.getItem("quiz-host-key") || null,
  clientId: sessionStorage.getItem("quiz-client-id") || null,
  state: null,
  stream: null,
  timer: null,
  networkUrl: location.origin
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2400);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function persist() {
  const values = {
    "quiz-role": session.role,
    "quiz-code": session.code,
    "quiz-host-key": session.hostKey,
    "quiz-client-id": session.clientId
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  }
}

function resetSession() {
  session.stream?.close();
  clearInterval(session.timer);
  session.role = session.code = session.hostKey = session.clientId = session.state = null;
  persist();
  history.replaceState({}, "", location.pathname);
  renderHome();
}

function topbar(extra = "") {
  return `
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Common Ground</span></div>
      ${extra}
    </header>`;
}

function renderHome(error = "") {
  const params = new URLSearchParams(location.search);
  const presetCode = (params.get("join") || "").replace(/\D/g, "").slice(0, 6);
  app.innerHTML = `
    <div class="shell">
      ${topbar('<span class="counter-chip">12 questions</span>')}
      <section class="home">
        <div>
          <p class="kicker">A live class quiz</p>
          <h1>Two generations. One missing connection.</h1>
          <p class="intro">Test what you know about loneliness, teenagers, older adults, and the idea that could bring them together.</p>
        </div>
        <div class="panel">
          <h2>Join the room</h2>
          <p class="subtle">No account needed. Enter the code on the projector.</p>
          <form id="join-form">
            <div class="field">
              <label for="code">Game code</label>
              <input class="code-input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" value="${escapeHtml(presetCode)}" required />
            </div>
            <div class="field">
              <label for="name">Your name</label>
              <input id="name" name="name" autocomplete="nickname" maxlength="24" placeholder="How should we show you?" required />
            </div>
            <button class="btn wide" type="submit">Join game</button>
            <p id="form-error" class="error" ${error ? "" : "hidden"}>${escapeHtml(error)}</p>
          </form>
          <div class="or">or</div>
          <button id="host-button" class="btn secondary wide" type="button">Host this quiz</button>
        </div>
      </section>
    </div>`;

  const codeInput = document.querySelector("#code");
  codeInput.addEventListener("input", () => { codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6); });
  document.querySelector("#join-form").addEventListener("submit", joinGame);
  document.querySelector("#host-button").addEventListener("click", createGame);
}

async function createGame() {
  const button = document.querySelector("#host-button");
  button.disabled = true;
  button.textContent = "Creating room...";
  try {
    const data = await api("/api/rooms", { method: "POST" });
    session.role = "host";
    session.code = data.code;
    session.hostKey = data.hostKey;
    session.clientId = null;
    persist();
    connect();
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    button.textContent = "Host this quiz";
  }
}

async function joinGame(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorNode = document.querySelector("#form-error");
  const submit = form.querySelector("button");
  const code = form.code.value.trim();
  const name = form.name.value.trim();
  errorNode.hidden = true;
  submit.disabled = true;
  submit.textContent = "Joining...";
  try {
    const data = await api(`/api/rooms/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ name })
    });
    session.role = "player";
    session.code = code;
    session.clientId = data.clientId;
    session.hostKey = null;
    session.state = data.state;
    persist();
    connect();
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submit.disabled = false;
    submit.textContent = "Join game";
  }
}

async function loadNetworkUrl() {
  try {
    const info = await api("/api/info");
    const isLocalAddress = location.hostname === "localhost"
      || location.hostname === "127.0.0.1"
      || location.hostname.startsWith("10.")
      || location.hostname.startsWith("192.168.")
      || /^172\.(1[6-9]|2\d|3[01])\./.test(location.hostname);
    session.networkUrl = isLocalAddress
      ? (info.networkUrls?.[0] || location.origin)
      : location.origin;
  } catch { session.networkUrl = location.origin; }
}

function connect() {
  session.stream?.close();
  const query = new URLSearchParams();
  if (session.clientId) query.set("clientId", session.clientId);
  if (session.hostKey) query.set("hostKey", session.hostKey);
  session.stream = new EventSource(`/api/rooms/${session.code}/events?${query}`);
  session.stream.onmessage = event => {
    session.state = JSON.parse(event.data);
    renderState();
  };
  session.stream.onerror = () => showToast("Reconnecting to the game...");
  loadNetworkUrl().then(renderState);
}

function renderState() {
  if (!session.state) return;
  if (session.state.phase === "lobby") {
    session.role === "host" ? renderHostLobby() : renderPlayerLobby();
  } else if (session.state.phase === "finished") {
    renderFinal();
  } else if (session.role === "player" && session.state.me?.answer && session.state.phase === "question") {
    renderLocked();
  } else {
    renderQuestion();
  }
}

function renderHostLobby() {
  const state = session.state;
  const joinUrl = `${session.networkUrl}/?join=${state.code}`;
  const playerTags = state.players?.length
    ? state.players.map(player => `<span class="player-tag">${escapeHtml(player.name)}</span>`).join("")
    : `<p class="empty">Waiting for the first player to join.</p>`;
  app.innerHTML = `
    <div class="shell">
      ${topbar('<span class="room-chip">Host view</span>')}
      <section class="lobby">
        <div class="join-card">
          <p>Join on your phone</p>
          <strong class="join-url">${escapeHtml(session.networkUrl.replace(/^https?:\/\//, ""))}</strong>
          <span class="room-code">${state.code}</span>
          <div class="button-row">
            <button id="copy-link" class="btn secondary" type="button">Copy join link</button>
            <button id="share-link" class="btn secondary" type="button">Share link</button>
          </div>
        </div>
        <aside class="panel players-panel">
          <h2>Players <span>${state.playerCount}</span></h2>
          <div class="player-list">${playerTags}</div>
          <button id="start-game" class="btn wide" type="button" ${state.playerCount ? "" : "disabled"}>Start quiz</button>
        </aside>
      </section>
    </div>`;
  document.querySelector("#copy-link").addEventListener("click", async () => {
    await navigator.clipboard.writeText(joinUrl);
    showToast("Join link copied");
  });
  const share = document.querySelector("#share-link");
  if (!navigator.share) share.hidden = true;
  share.addEventListener("click", () => navigator.share({ title: "Join our live quiz", text: `Use code ${state.code}`, url: joinUrl }));
  document.querySelector("#start-game").addEventListener("click", () => hostAction("start"));
}

function renderPlayerLobby() {
  const state = session.state;
  app.innerHTML = `
    <div class="shell">
      ${topbar(`<span class="room-chip">Room ${state.code}</span>`)}
      <section class="waiting">
        <div>
          <div class="waiting-shape" aria-hidden="true"></div>
          <p class="kicker">You're in, ${escapeHtml(state.me?.name)}</p>
          <h1>Look up at the screen.</h1>
          <p>The host will start when everyone is ready.</p>
        </div>
      </section>
    </div>`;
}

function answerMarkup(state, interactive) {
  const q = state.question;
  const reveal = state.phase === "reveal";
  const chosen = state.me?.answer?.choice;
  return q.options.map((option, index) => {
    const classes = ["answer"];
    if (chosen === index) classes.push("selected");
    if (reveal && q.type !== "poll" && q.correct === index) classes.push("correct");
    if (reveal && q.type !== "poll" && q.correct !== index) classes.push("dim");
    const count = state.answerCounts ? `<span class="answer-count">${state.answerCounts[index]}</span>` : "";
    return `<button class="${classes.join(" ")}" data-choice="${index}" ${interactive ? "" : "disabled"}>
      <span class="answer-label">${letters[index]}</span>
      <span>${escapeHtml(option)}</span>${count}
    </button>`;
  }).join("");
}

function resultBanner(state) {
  if (session.role !== "player" || state.phase !== "reveal" || !state.me?.answer) return "";
  if (state.question.type === "poll") return `<div class="result-banner">Your voice is part of the room.</div>`;
  const correct = state.me.answer.choice === state.question.correct;
  return `<div class="result-banner ${correct ? "good" : "bad"}">${correct ? `Correct. +${state.me.answer.points} points` : "Not this time. See why below."}</div>`;
}

function renderQuestion() {
  const state = session.state;
  const q = state.question;
  const isHost = session.role === "host";
  const reveal = state.phase === "reveal";
  const explanation = reveal ? `
    <div class="explanation">
      <p>${escapeHtml(q.explanation)}</p>
      ${q.source ? `<span class="source">Source: ${escapeHtml(q.source)}</span>` : ""}
    </div>` : "";
  const control = isHost ? `
    <div class="host-actions">
      <span class="subtle"><strong>${state.answeredCount}</strong> of ${state.playerCount} answered</span>
      <button id="host-action" class="btn" type="button">${reveal ? (state.questionIndex === state.totalQuestions - 1 ? "Show final results" : "Next question") : "Reveal answer"}</button>
    </div>` : "";

  app.innerHTML = `
    <div class="shell">
      ${topbar(`<span class="room-chip">${isHost ? `Room ${state.code}` : `${escapeHtml(state.me?.name)} | ${state.me?.score || 0} pts`}</span>`)}
      <section class="quiz-layout">
        <div class="quiz-meta">
          <span class="quiz-progress">Question ${state.questionIndex + 1} of ${state.totalQuestions}${q.type === "poll" ? " | opinion poll" : ""}</span>
          ${reveal ? `<span class="counter-chip">Answer revealed</span>` : `<span id="timer" class="timer">${q.duration}</span>`}
        </div>
        ${resultBanner(state)}
        <h1 class="question">${escapeHtml(q.prompt)}</h1>
        <div class="answers">${answerMarkup(state, !isHost && !reveal && !state.me?.answer)}</div>
        ${explanation}
        ${control}
      </section>
    </div>`;

  if (!isHost && !reveal && !state.me?.answer) {
    document.querySelectorAll(".answer").forEach(button => button.addEventListener("click", submitAnswer));
  }
  if (isHost) {
    document.querySelector("#host-action").addEventListener("click", () => hostAction(reveal ? "next" : "reveal"));
  }
  if (!reveal) startTimer(); else clearInterval(session.timer);
}

function renderLocked() {
  const state = session.state;
  app.innerHTML = `
    <div class="shell">
      ${topbar(`<span class="room-chip">${escapeHtml(state.me?.name)} | ${state.me?.score || 0} pts</span>`)}
      <section class="locked">
        <div class="locked-card">
          <div class="locked-symbol" aria-hidden="true">✓</div>
          <p class="kicker">Answer locked</p>
          <h1>Good choice. Now look up.</h1>
          <p>Waiting for the host to reveal the answer.</p>
        </div>
      </section>
    </div>`;
  startTimer();
}

function startTimer() {
  clearInterval(session.timer);
  const update = () => {
    const node = document.querySelector("#timer");
    if (!node || !session.state?.questionStartedAt) return;
    const elapsed = Math.floor((Date.now() - session.state.questionStartedAt) / 1000);
    const remaining = Math.max(0, session.state.question.duration - elapsed);
    node.textContent = remaining;
    node.classList.toggle("urgent", remaining <= 5);
  };
  update();
  session.timer = setInterval(update, 250);
}

async function submitAnswer(event) {
  const choice = Number(event.currentTarget.dataset.choice);
  document.querySelectorAll(".answer").forEach(button => { button.disabled = true; });
  event.currentTarget.classList.add("selected");
  try {
    await api(`/api/rooms/${session.code}/answer`, {
      method: "POST",
      body: JSON.stringify({ clientId: session.clientId, choice })
    });
  } catch (error) {
    showToast(error.message);
    document.querySelectorAll(".answer").forEach(button => { button.disabled = false; });
  }
}

async function hostAction(action) {
  const button = document.querySelector("#host-action") || document.querySelector("#start-game");
  if (button) button.disabled = true;
  try {
    await api(`/api/rooms/${session.code}/action`, {
      method: "POST",
      headers: { "X-Host-Key": session.hostKey },
      body: JSON.stringify({ action })
    });
  } catch (error) {
    showToast(error.message);
    if (button) button.disabled = false;
  }
}

function renderFinal() {
  clearInterval(session.timer);
  const state = session.state;
  const leaders = state.leaderboard || state.players || [];
  const rows = leaders.length
    ? leaders.map((player, index) => `<li><span class="rank">${index + 1}</span><strong>${escapeHtml(player.name)}</strong><span class="score">${player.score} pts</span></li>`).join("")
    : `<li><span></span><span>No scored answers yet</span><span></span></li>`;
  app.innerHTML = `
    <div class="shell">
      ${topbar('<span class="room-chip">Quiz complete</span>')}
      <section class="final">
        <div>
          <p class="kicker">The bigger idea</p>
          <h1>Connection can work both ways.</h1>
          <p class="intro">Our proposal matches teenagers and older adults for safe, regular activities that build companionship, skills, and trust.</p>
          <button id="leave-game" class="btn" type="button">Back to start</button>
        </div>
        <aside class="panel">
          <h2>Leaderboard</h2>
          <ol class="leaderboard">${rows}</ol>
        </aside>
      </section>
    </div>`;
  document.querySelector("#leave-game").addEventListener("click", resetSession);
}

async function resume() {
  if (!session.role || !session.code || (session.role === "host" && !session.hostKey) || (session.role === "player" && !session.clientId)) {
    return renderHome();
  }
  try {
    const query = new URLSearchParams();
    if (session.clientId) query.set("clientId", session.clientId);
    if (session.hostKey) query.set("hostKey", session.hostKey);
    session.state = await api(`/api/rooms/${session.code}?${query}`);
    connect();
  } catch {
    resetSession();
  }
}

resume();
