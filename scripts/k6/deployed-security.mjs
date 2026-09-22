import { mkdirSync, writeFileSync } from 'node:fs';
import nextEnv from '@next/env';
import { execFileSync } from 'node:child_process';
nextEnv.loadEnvConfig(process.cwd());
mkdirSync('test-results/deployed', { recursive: true });
// curl uses the machine's working HTTPS transport; Node fetch times out here.
async function request(url, options = {}) {
  const args = ['-sS', '--max-time', '20', '-i', '-X', options.method || 'GET', url];
  for (const [name,value] of Object.entries(options.headers || {})) args.push('-H', `${name}: ${value}`);
  if(options.body) args.push('--data-binary', options.body);
  const raw = execFileSync('curl.exe', args, {encoding:'utf8',maxBuffer:8*1024*1024});
  const boundary = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0,boundary).split('\r\n');
  const body = raw.slice(boundary+4);
  const headers = new Headers();
  for(const line of head.slice(1)) { const at=line.indexOf(':'); if(at>0) headers.append(line.slice(0,at),line.slice(at+1).trim()); }
  return {status:Number(head[0].split(' ')[1]),headers,text:async()=>body,json:async()=>JSON.parse(body)};
}
const base = 'https://mst-grs-xcua.vercel.app';
const checks = [];
const bodies = [];
async function probe(path, options = {}) {
  const response = await request(base + path, options);
  const body = await response.text();
  bodies.push(body);
  checks.push({ path, status: response.status, location: response.headers.get('location'), headers: Object.fromEntries([...response.headers].filter(([k]) => !['set-cookie'].includes(k))), bytes: Buffer.byteLength(body), loginForm: body.includes('name="identifier"'), streamedRedirectToLogin: body.includes('NEXT_REDIRECT;replace;/;') || /http-equiv="refresh"[^>]*url=\//.test(body), genericServerError: body.includes('Application error:') });
  return { response, body };
}
const home = await probe('/');
for (const path of ['/dashboard', '/dashboard/manager', '/dashboard/assignments/00000000-0000-4000-8000-000000000000', '/.env', '/.env.local', '/.git/config', '/package.json', '/?next=https%3A%2F%2Fexample.com']) await probe(path);
const chunks = [...new Set([...home.body.matchAll(/(?:src|href)="([^" ]+\.js(?:\?[^" ]*)?)"/g)].map(m => m[1]))].filter(p => p.startsWith('/_next/')).slice(0, 30);
for (const path of chunks) await probe(path);
const secrets = ['SUPABASE_SERVICE_ROLE_KEY', 'LOGIN_HMAC_SECRET', 'VAPID_PRIVATE_KEY'].map(name => ({ name, configuredLocally: !!process.env[name], foundInPublicResponses: !!process.env[name] && bodies.some(body => body.includes(process.env[name])) }));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const database = [];
if (supabaseUrl && key) {
  // Only public credentials; never use service role credentials for access-control probes.
  for (const table of ['profiles', 'grade_records', 'audit_log', 'login_attempts', 'push_subscriptions', 'assignment_files', 'site_schedule']) {
    const r = await request(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: key } });
    const data = await r.json();
    database.push({ table, status: r.status, code: data.code, rowCount: Array.isArray(data) ? data.length : null });
  }
  for (const rpc of ['manager_dashboard_stats', 'manager_student_list']) {
    const r = await request(`${supabaseUrl}/rest/v1/rpc/${rpc}`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(rpc === 'manager_student_list' ? {p_completed:false,p_query:'',p_limit:1,p_offset:0} : {}) });
    const data = await r.json();
    database.push({ rpc, status: r.status, code: data.code });
  }
}
const result = { date: new Date().toISOString(), base, scope: 'Unauthenticated read-only probes; no login guesses or record mutations. Database target is local configured project, deployed-project match not assumed.', databaseOrigin: supabaseUrl, checks, secrets, database };
mkdirSync('test-results/deployed', { recursive: true });
writeFileSync('test-results/deployed/security.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
