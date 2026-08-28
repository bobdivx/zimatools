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
  await a.release({ client: "popcorn" });
  console.log("ok wait timeout");
}

await testWaitNotify();
await testSharedVram();
await testTimeout();
console.log("ALL GPU TESTS PASSED");
