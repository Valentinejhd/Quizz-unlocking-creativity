const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const rooms = new Map();

const questions = [
  {
    type: "poll",
    prompt: "When you picture a lonely person, who comes to mind first?",
    options: ["A teenager", "A young adult", "A middle-aged adult", "An older adult"],
    explanation: "There is no wrong answer. This question reveals the assumptions we make about loneliness.",
    duration: 20
  },
  {
    prompt: "About how many older adults worldwide experience social isolation?",
    options: ["1 in 20", "1 in 10", "1 in 4", "1 in 2"],
    correct: 2,
    explanation: "Around 1 in 4 older adults are socially isolated, according to international research summarized by the WHO.",
    source: "World Health Organization",
    duration: 20
  },
  {
    prompt: "True or false: living alone automatically means someone is lonely.",
    options: ["True", "False"],
    correct: 1,
    explanation: "Loneliness is a feeling. Social isolation is limited contact. A person can experience one without the other.",
    duration: 18
  },
  {
    prompt: "Which health problems are linked with loneliness and social isolation?",
    options: ["Depression and anxiety", "Heart disease and stroke", "Cognitive decline", "All of these"],
    correct: 3,
    explanation: "Social disconnection is linked with serious mental, cognitive, and physical health risks.",
    source: "CDC",
    duration: 20
  },
  {
    prompt: "Which everyday barrier can deepen isolation for an older person?",
    options: ["Limited mobility", "Lack of transport", "Few local activities", "All of these"],
    correct: 3,
    explanation: "Mobility, transport, and access to community spaces all affect a person's opportunities to connect.",
    duration: 20
  },
  {
    prompt: "About how many teenagers report being socially isolated?",
    options: ["1 in 50", "1 in 25", "1 in 10", "1 in 4"],
    correct: 3,
    explanation: "About 1 in 4 teenagers report social isolation. Disconnection is not only an older-person problem.",
    source: "World Health Organization",
    duration: 20
  },
  {
    prompt: "What could teenagers gain from spending time with older adults?",
    options: ["Communication skills", "Patience and empathy", "Life perspective", "All of these"],
    correct: 3,
    explanation: "Intergenerational contact can build communication, empathy, patience, and a broader view of life.",
    duration: 20
  },
  {
    prompt: "What is missing when both generations want more connection?",
    options: ["Shared interests", "A safe, structured way to meet", "Smartphones", "Conversation topics"],
    correct: 1,
    explanation: "The main gap is a trusted structure that helps people find, meet, and keep in contact with one another.",
    duration: 20
  },
  {
    prompt: "What should the platform use to create a good match?",
    options: ["Interests", "Availability", "Location", "All of these"],
    correct: 3,
    explanation: "Shared interests, compatible schedules, and practical travel distance all support lasting relationships.",
    duration: 20
  },
  {
    prompt: "Which arrangement is safest for a first meeting?",
    options: ["An unplanned home visit", "A supervised meeting after consent and vetting", "Sharing home addresses online", "Meeting without telling families"],
    correct: 1,
    explanation: "Safeguarding, consent, vetting, and a supervised first meeting are central to building trust.",
    duration: 22
  },
  {
    prompt: "Why are regular visits better than a one-time event?",
    options: ["They build trust and a real relationship", "They remove safety checks", "They need no commitment", "They create more paperwork"],
    correct: 0,
    explanation: "Consistency turns a novelty visit into genuine companionship and allows trust to grow.",
    duration: 20
  },
  {
    type: "poll",
    prompt: "Could connecting two generations be part of the solution to loneliness?",
    options: ["Definitely", "Possibly", "Not sure yet", "Probably not"],
    explanation: "Our proposal is a platform for safe, regular, structured companionship between teenagers and older adults.",
    duration: 20
  }
];

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store"
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100000) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function makeCode() {
  let code;
  do code = String(crypto.randomInt(100000, 1000000)); while (rooms.has(code));
  return code;
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function publicState(room, clientId, isHost) {
  const question = room.questionIndex >= 0 ? questions[room.questionIndex] : null;
  const reveal = room.phase === "reveal" || room.phase === "finished";
  const answerCounts = question
    ? question.options.map((_, index) => [...room.answers.values()].filter(a => a.choice === index).length)
    : [];
  const player = clientId ? room.players.get(clientId) : null;
  const leaderboard = [...room.players.values()]
    .map(({ id, name, score }) => ({ id, name, score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    code: room.code,
    phase: room.phase,
    questionIndex: room.questionIndex,
    totalQuestions: questions.length,
    question: question ? {
      type: question.type || "quiz",
      prompt: question.prompt,
      options: question.options,
      duration: question.duration,
      explanation: reveal ? question.explanation : undefined,
      source: reveal ? question.source : undefined,
      correct: reveal && question.type !== "poll" ? question.correct : undefined
    } : null,
    questionStartedAt: room.questionStartedAt,
    playerCount: room.players.size,
    answeredCount: room.answers.size,
    answerCounts: (isHost || reveal) ? answerCounts : undefined,
    players: isHost ? leaderboard : undefined,
    leaderboard: (reveal || room.phase === "finished") ? leaderboard.slice(0, 10) : undefined,
    me: player ? {
      id: player.id,
      name: player.name,
      score: player.score,
      answer: room.answers.get(player.id) || null
    } : null
  };
}

function broadcast(room) {
  for (const client of room.streams) {
    const payload = publicState(room, client.clientId, client.isHost);
    client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function authorizeHost(room, req, url) {
  return (req.headers["x-host-key"] || url.searchParams.get("hostKey")) === room.hostKey;
}

function networkUrls() {
  const urls = [];
  for (const group of Object.values(os.networkInterfaces())) {
    for (const item of group || []) {
      if (item.family === "IPv4" && !item.internal) urls.push(`http://${item.address}:${PORT}`);
    }
  }
  return urls;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/info") {
    return json(res, 200, { port: PORT, networkUrls: networkUrls() });
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const code = makeCode();
    const room = {
      code,
      hostKey: crypto.randomBytes(18).toString("hex"),
      phase: "lobby",
      questionIndex: -1,
      questionStartedAt: null,
      players: new Map(),
      answers: new Map(),
      streams: new Set(),
      createdAt: Date.now()
    };
    rooms.set(code, room);
    return json(res, 201, { code, hostKey: room.hostKey });
  }

  const match = url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(join|answer|action|events))?$/);
  if (!match) return false;
  const room = rooms.get(match[1]);
  if (!room) return json(res, 404, { error: "Game not found. Check the code and try again." });
  const action = match[2];

  if (req.method === "GET" && !action) {
    const clientId = url.searchParams.get("clientId");
    return json(res, 200, publicState(room, clientId, authorizeHost(room, req, url)));
  }

  if (req.method === "GET" && action === "events") {
    const clientId = url.searchParams.get("clientId");
    const isHost = authorizeHost(room, req, url);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`data: ${JSON.stringify(publicState(room, clientId, isHost))}\n\n`);
    const stream = { res, clientId, isHost };
    room.streams.add(stream);
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 20000);
    req.on("close", () => {
      clearInterval(heartbeat);
      room.streams.delete(stream);
    });
    return true;
  }

  if (req.method === "POST" && action === "join") {
    const body = await readBody(req);
    const name = cleanName(body.name);
    if (!name) return json(res, 400, { error: "Enter a name to join." });
    if (room.phase !== "lobby") return json(res, 409, { error: "This game has already started." });
    if ([...room.players.values()].some(player => player.name.toLowerCase() === name.toLowerCase())) {
      return json(res, 409, { error: "That name is already in the game. Try another." });
    }
    const id = crypto.randomBytes(12).toString("hex");
    room.players.set(id, { id, name, score: 0 });
    broadcast(room);
    return json(res, 201, { clientId: id, state: publicState(room, id, false) });
  }

  if (req.method === "POST" && action === "answer") {
    const body = await readBody(req);
    const player = room.players.get(body.clientId);
    const question = questions[room.questionIndex];
    if (!player) return json(res, 401, { error: "Please rejoin the game." });
    if (room.phase !== "question" || !question) return json(res, 409, { error: "Answers are closed." });
    if (room.answers.has(player.id)) return json(res, 409, { error: "Your answer is already locked in." });
    const choice = Number(body.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length) {
      return json(res, 400, { error: "Choose one of the answers." });
    }
    const elapsed = Math.max(0, Date.now() - room.questionStartedAt);
    let points = 0;
    if (question.type !== "poll" && choice === question.correct) {
      const speed = Math.max(0, 1 - elapsed / (question.duration * 1000));
      points = Math.round(600 + speed * 400);
      player.score += points;
    }
    room.answers.set(player.id, { choice, points, answeredAt: Date.now() });
    broadcast(room);
    return json(res, 200, { ok: true, points });
  }

  if (req.method === "POST" && action === "action") {
    if (!authorizeHost(room, req, url)) return json(res, 401, { error: "Host access required." });
    const body = await readBody(req);
    if (body.action === "start" && room.phase === "lobby") {
      room.phase = "question";
      room.questionIndex = 0;
      room.answers.clear();
      room.questionStartedAt = Date.now();
    } else if (body.action === "reveal" && room.phase === "question") {
      room.phase = "reveal";
    } else if (body.action === "next" && room.phase === "reveal") {
      if (room.questionIndex >= questions.length - 1) {
        room.phase = "finished";
      } else {
        room.questionIndex += 1;
        room.answers.clear();
        room.phase = "question";
        room.questionStartedAt = Date.now();
      }
    } else if (body.action === "end") {
      room.phase = "finished";
    } else {
      return json(res, 409, { error: "That action is not available right now." });
    }
    broadcast(room);
    return json(res, 200, publicState(room, null, true));
  }

  return false;
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" };
    res.writeHead(200, { "Content-Type": `${types[ext] || "application/octet-stream"}; charset=utf-8` });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled && !res.writableEnded) json(res, 404, { error: "Not found" });
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    if (!res.writableEnded) json(res, 500, { error: error.message || "Something went wrong." });
  }
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if (room.createdAt < cutoff) rooms.delete(code);
}, 30 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nBridging Generations quiz is ready:`);
  console.log(`  This computer: http://localhost:${PORT}`);
  for (const url of networkUrls()) console.log(`  Classroom Wi-Fi: ${url}`);
  console.log("\nOpen a Classroom Wi-Fi address when classmates will join from phones.\n");
});
