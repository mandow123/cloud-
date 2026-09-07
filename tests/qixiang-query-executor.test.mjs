import assert from "node:assert/strict";
import test from "node:test";
import { createQixiangQueryExecutor } from "../lib/server/qixiang-query-executor.ts";
import { isInternalReconciliationRequest } from "../lib/server/internal-reconciliation-auth.ts";
import { POST } from "../app/api/internal/card-hour-reconciliation/route.ts";

test("boot and restart impose a full minute; every rolling minute counts network retries", async () => {
  let now=0;
  const executor=createQixiangQueryExecutor({now:()=>now});
  let calls=0;
  const operation=async()=>{ calls++; return true; };
  await assert.rejects(executor.run("merchant",operation),/冷却/);
  now=60000;
  for(let i=0;i<6;i++) await executor.run("merchant",operation);
  now=119999;
  for(let i=0;i<6;i++) await assert.rejects(executor.run("merchant",async()=>{calls++;throw new Error("network");}),/network/);
  await assert.rejects(executor.run("merchant",operation),/频繁/);
  assert.equal(calls,12);
  now=120000;
  assert.equal(await executor.run("merchant",operation),true);
  const restarted=createQixiangQueryExecutor({now:()=>now});
  await assert.rejects(restarted.run("merchant",operation),/冷却/);
  now+=60000;
  assert.equal(await restarted.run("merchant",operation),true);
});

test("FIFO query queue shares one concurrency and releases after timeout without swallowing errors", async () => {
  const executor=createQixiangQueryExecutor({bootAt:Date.now()-60000,timeoutMs:25});
  let release;
  let running=0,max=0;
  const order=[];
  const first=executor.run("merchant",async()=>{ running++;max=Math.max(max,running);order.push("callback");await new Promise((resolve)=>{release=resolve;});running--;return 1; });
  const second=executor.run("merchant",async()=>{running++;max=Math.max(max,running);order.push("member");running--;return 2;});
  const third=executor.run("merchant",async()=>{running++;max=Math.max(max,running);order.push("worker");running--;return 3;});
  await Promise.resolve();release();
  assert.deepEqual(await Promise.all([first,second,third]),[1,2,3]);
  assert.equal(max,1);assert.deepEqual(order,["callback","member","worker"]);
  let aborted=false;
  await assert.rejects(executor.run("merchant",async(signal)=>new Promise((_,reject)=>signal.addEventListener("abort",()=>{aborted=true;reject(new Error("aborted"));}))),/超时|aborted/);
  assert.equal(aborted,true);
  assert.equal(await executor.run("merchant",async()=>4),4);
});

test("internal worker authentication rejects public, forwarded and unauthenticated calls", async () => {
  const token="a".repeat(48);
  const request=(url,headers={})=>new Request(url,{method:"POST",headers:{authorization:`Bearer ${token}`,...headers}});
  assert.equal(isInternalReconciliationRequest(request("http://127.0.0.1:3051/api/internal/card-hour-reconciliation"),token),true);
  for(const [url,headers] of [
    ["https://cloud.kai.com/api/internal/card-hour-reconciliation",{}],
    ["http://127.0.0.1:3051/api/internal/card-hour-reconciliation",{"x-forwarded-for":"127.0.0.1"}],
    ["http://127.0.0.1:3051/api/internal/card-hour-reconciliation",{origin:"https://cloud.kai.com"}],
    ["http://127.0.0.1:3051/api/internal/card-hour-reconciliation",{authorization:"Bearer wrong"}],
  ]) assert.equal(isInternalReconciliationRequest(request(url,headers),token),false);
  assert.equal((await POST(request("https://cloud.kai.com/api/internal/card-hour-reconciliation"))).status,404);
});
