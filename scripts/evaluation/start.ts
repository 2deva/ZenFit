import { spawn, type ChildProcess } from 'node:child_process';
const children: ChildProcess[] = [];
let stopping = false;
function stop(code: number) {
  if (stopping) return; stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}
function launch(args: string[]) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
  children.push(child); child.on('exit', code => stop(code ?? 1)); return child;
}
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
launch(['--import', 'tsx', 'scripts/evaluation/server.ts']);
const port = process.env.EVALUATION_API_PORT || '3002';
let ready = false;
for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
  try { if ((await fetch(`http://127.0.0.1:${port}/api/evaluation/health`)).ok) { ready = true; break; } } catch { /* API is still starting. */ }
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!ready) { console.error('Evaluation database did not become ready'); stop(1); }
else launch(['node_modules/vite/bin/vite.js', '--config', 'vite.evaluation.config.ts', '--host', process.env.EVALUATION_HOST || '127.0.0.1']);
