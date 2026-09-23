const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${body.error || "Request failed"}`);
  return body;
}

async function run() {
  const room = await request("/api/rooms", { method: "POST" });
  const alice = await request(`/api/rooms/${room.code}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Alice" })
  });
  const sam = await request(`/api/rooms/${room.code}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Sam" })
  });
  const host = (action) => request(`/api/rooms/${room.code}/action`, {
    method: "POST",
    headers: { "X-Host-Key": room.hostKey },
    body: JSON.stringify({ action })
  });
  const answer = (clientId, choice) => request(`/api/rooms/${room.code}/answer`, {
    method: "POST",
    body: JSON.stringify({ clientId, choice })
  });

  await host("start");
  await answer(alice.clientId, 0);
  await answer(sam.clientId, 3);
  let state = await host("reveal");
  if (state.answeredCount !== 2) throw new Error("Poll answers were not counted");

  await host("next");
  const correct = await answer(alice.clientId, 2);
  const incorrect = await answer(sam.clientId, 0);
  state = await host("reveal");

  if (correct.points < 600 || correct.points > 1000) throw new Error("Correct-answer score is outside its expected range");
  if (incorrect.points !== 0) throw new Error("Incorrect answers should receive zero points");
  if (state.leaderboard[0].name !== "Alice") throw new Error("Leaderboard order is incorrect");
  if (state.question.correct !== 2) throw new Error("Reveal did not include the correct answer");

  console.log(`Smoke test passed for room ${room.code}: join, poll, scoring, reveal, and leaderboard.`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
