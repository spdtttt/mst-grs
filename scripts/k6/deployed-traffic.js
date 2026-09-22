import http from 'k6/http';
import { check } from 'k6';
import { Rate, Counter } from 'k6/metrics';
const base = 'https://mst-grs-xcua.vercel.app';
const failed = new Rate('unexpected_response');
const attempts = new Counter('page_attempts');
const phases = [
  {name:'warmup',rate:100,duration:'30s',startTime:'0s'},
  {name:'ramp',rate:350,duration:'30s',startTime:'30s'},
  {name:'target',rate:700,duration:'2m',startTime:'1m'},
  {name:'recovery',rate:100,duration:'30s',startTime:'3m'},
];
const thresholds = {
  unexpected_response: [{threshold:'rate<0.01',abortOnFail:true,delayAbortEval:'15s'}],
  http_req_duration: [{threshold:'p(95)<5000',abortOnFail:true,delayAbortEval:'20s'}],
  dropped_iterations: ['count==0'],
};
for (const p of phases) {
  thresholds[`http_req_duration{scenario:${p.name}}`] = ['p(95)<3000'];
  thresholds[`page_attempts{scenario:${p.name}}`] = ['count>0'];
}
export const options = {
  // Observed DNS A record reachable from this test machine; TLS hostname remains unchanged.
  hosts: {'mst-grs-xcua.vercel.app': '64.29.17.131'},
  scenarios: Object.fromEntries(phases.map(p=>[p.name,{executor:'constant-arrival-rate',rate:p.rate,timeUnit:'1m',duration:p.duration,startTime:p.startTime,preAllocatedVUs:15,maxVUs:40,gracefulStop:'10s'}])),
  thresholds, summaryTrendStats:['avg','med','p(95)','p(99)','max'],
  userAgent:'MST-GRS-Authorized-ReadOnly-LoadTest/1.0',
};
export function setup() {
  const r=http.get(base+'/',{redirects:0,timeout:'10s'});
  if(r.status!==200 || !r.body.includes('name="identifier"')) throw new Error('Preflight: expected login form; refusing load test');
}
export default function() {
  attempts.add(1);
  const r=http.get(base+'/',{redirects:0,timeout:'10s',tags:{name:'GET login HTML'}});
  failed.add(!check(r,{'login HTTP 200':v=>v.status===200 && v.body.includes('name="identifier"')}));
}
export function handleSummary(data) {
  return {'test-results/deployed/traffic.json':JSON.stringify({date:new Date().toISOString(),base,scope:'Unauthenticated GET / HTML only on deployed Vercel; no assets, JS execution, login, writes or authenticated database load',phases,...data},null,2),stdout:JSON.stringify(data.metrics,null,2)};
}
