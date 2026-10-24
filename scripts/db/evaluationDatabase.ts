import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { applyMigrations } from './migrations';

export const evaluationUsers = {
  alice: '00000000-0000-4000-8000-000000000001',
  bob: '00000000-0000-4000-8000-000000000002',
} as const;
export const evaluationProject = 'zenfit-local-evaluation';

/** JWT claims are injected only in this isolated harness; this does not verify JWT signatures. */
export async function createEvaluationDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;`);
  await applyMigrations(db);
  await db.query("INSERT INTO private.app_settings (key,value) VALUES ('firebase_project_id',$1)", [evaluationProject]);
  for (const [uid, id] of Object.entries(evaluationUsers)) {
    await db.query('INSERT INTO users (id,firebase_uid,name) VALUES ($1,$2,$3)', [id, uid, `Evaluation ${uid}`]);
    await db.query('INSERT INTO user_goals (user_id,goal_type,goal_label,target_value) VALUES ($1,$2,$3,$4)', [id, 'cardio', 'Daily movement', 8000]);
  }
  return db;
}

export async function setEvaluationIdentity(db: PGlite, uid: string, project = evaluationProject): Promise<void> {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: uid, aud: project, iss: `https://securetoken.google.com/${project}`, role: 'authenticated' })]);
  await db.exec('SET ROLE authenticated');
}
