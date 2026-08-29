import { GpuArbiter } from "../src/lib/gpuArbiter.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function testWaitNotify() {
  const a = new GpuArbiter();
  const pop = await a.acquire("popcorn", 120);
  assert(pop.granted === true, "popcorn should get exclusive grant");
  const waitP = a.waitForGrant("agents", 4000);
  await new Promise((r) => setTimeout(r, 40));
  const queued = await a.acquire("agents");
  assert(queued.granted === false && queued.reason === "queued", "agents should stay queued");
  assert(typeof queued.position === "number" && queued.position >= 1, "queued result needs position");
  const rel = await a.release({ client: "popcorn" });
  assert(rel.released === true, "popcorn release failed");
  const agents = await waitP;
  assert(agents.granted === true, `agents should be granted after release, got ${JSON.stringify(agents)}`);
  assert(agents.wasQueued === true, "queued waiter should set wasQueued true");
  assert(typeof agents.waitMs === "number" && agents.waitMs > 0, `queued waiter waitMs should be > 0, got ${agents.waitMs}`);
  await a.release({ client: "agents" });
  console.log("ok wait/notify: popcorn hold -> agents wait -> release -> granted");
}

async function testSharedVram() {
  const a = new GpuArbiter();
  const ollama = await a.acquire("ollama", undefined, { vramMiB: 4096, exclusive: false });
  const agents = await a.acquire("agents", undefined, { vramMiB: 2048, exclusive: false });
  assert(ollama.granted === true, "ollama shared grant");
  assert(agents.granted === true, "agents shared grant beside ollama");
  assert((a.queueList().leases || []).length === 2, "two shared leases");
  const pop = await a.acquire("popcorn");
  assert(pop.granted === true && pop.reason === "preempted", "popcorn exclusive should preempt shared");
  assert((a.queueList().leases || []).length === 1, "only exclusive remains");
  await a.release({ client: "popcorn" });
  const after = a.queueList();
  assert((after.leases || []).length >= 1, "shared waiters should be promoted after exclusive release");
  await a.release({});
  console.log("ok shared VRAM + exclusive preemption");
}

async function testTimeout() {
  const a = new GpuArbiter();
  await a.acquire("popcorn");
  const r = await a.waitForGrant("agents", 200);
  assert(r.granted === false && r.reason === "timeout", "wait should timeout");
  assert(r.wasQueued === true, "timeout after queue should set wasQueued true");
  assert(typeof r.waitMs === "number" && r.waitMs >= 180, `timeout waitMs should be ~elapsed, got ${r.waitMs}`);
  await a.release({ client: "popcorn" });
  console.log("ok wait timeout");
}

async function testImmediateWait() {
  const a = new GpuArbiter();
  const r = await a.waitForGrant("wasq-instant", 4000, { exclusive: false });
  assert(r.granted === true, "immediate wait should grant");
  assert(r.wasQueued === false, "immediate grant should set wasQueued false");
  assert(typeof r.waitMs === "number" && r.waitMs >= 0 && r.waitMs < 500, `immediate waitMs should be small, got ${r.waitMs}`);
  const nb = await a.acquire("wasq-nb", undefined, { exclusive: false });
  assert(nb.granted === true && nb.wasQueued === false && nb.waitMs === 0, "non-blocking grant should include wasQueued false waitMs 0");
  await a.release({});
  console.log("ok immediate wait + non-blocking fields");
}

await testWaitNotify();
await testSharedVram();
await testTimeout();
await testImmediateWait();
console.log("ALL GPU TESTS PASSED");
