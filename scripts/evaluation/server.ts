import { createServer } from 'node:http';
import { createEvaluationDatabase, evaluationUsers, evaluationProject } from '../db/evaluationDatabase';
import { isRecord } from '../../utils/validation';

const db = await createEvaluationDatabase();
const port = Number(process.env.EVALUATION_API_PORT || 3002);
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  res.setHeader('Content-Type', 'application/json');
  const respond = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
  if (url.pathname === '/api/evaluation/health') { respond(200, { status: 'ok', database: 'isolated PostgreSQL', identities: 'synthetic fixtures' }); return; }
  if (url.pathname !== '/api/evaluation/progress') { respond(404, { error: 'Not found' }); return; }
  if (req.method !== 'GET' && req.method !== 'POST') { respond(405, { error: 'Method not allowed' }); return; }
  try {
    let input: Record<string, unknown> = Object.fromEntries(url.searchParams);
    if (req.method === 'POST') {
      let text = '';
      for await (const chunk of req) { text += chunk; if (text.length > 16384) throw new Error('Payload too large'); }
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) throw new Error('Invalid progress'); input = parsed;
    }
    const user = input.user;
    const workoutId = input.workoutId;
    if ((user !== 'alice' && user !== 'bob') || typeof workoutId !== 'string' || !/^[\w-]{1,80}$/.test(workoutId)) throw new Error('Use a fixture identity and valid workout ID');
    const completed = input.completedIndices;
    const activeIdx = input.activeIdx;
    if (req.method === 'POST' && (!Array.isArray(completed) || completed.length > 100 || !completed.every(i => Number.isInteger(i) && i >= 0 && i < 100) || !Number.isInteger(activeIdx) || Number(activeIdx) < 0 || Number(activeIdx) > 100)) throw new Error('Invalid progress indices');
    const rows = await db.transaction(async tx => {
      await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, aud: evaluationProject, iss: `https://securetoken.google.com/${evaluationProject}`, role: 'authenticated' })]);
      await tx.exec('SET LOCAL ROLE authenticated');
      if (req.method === 'POST') {
        await tx.query('INSERT INTO workout_progress (user_id,workout_id,completed_indices,active_idx) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,workout_id) DO UPDATE SET completed_indices=excluded.completed_indices,active_idx=excluded.active_idx', [evaluationUsers[user], workoutId, completed, activeIdx]);
      }
      return (await tx.query('SELECT workout_id,completed_indices,active_idx FROM workout_progress WHERE workout_id=$1', [workoutId])).rows;
    });
    respond(200, { progress: rows[0] || null });
  } catch (error) {
    respond(400, { error: error instanceof Error ? error.message : 'Invalid request' });
  }
});
server.listen(port, process.env.EVALUATION_API_HOST || '127.0.0.1', () => console.log(`Isolated evaluation API ready on ${port}; synthetic identities only.`));
const shutdown = () => { server.close(() => { void db.close().then(() => process.exit(0)); }); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
