// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createEvaluationDatabase, evaluationUsers, setEvaluationIdentity } from '../evaluationDatabase';
import { applyMigrations } from '../migrations';
let db: PGlite;
beforeAll(async () => { db = await createEvaluationDatabase(); }, 30000);
afterAll(async () => { await db?.close(); });
afterEach(async () => { await db.exec('RESET ROLE'); });

describe('isolated PostgreSQL migrations and row isolation', () => {
  it('applies once and checks the same migration ledger on repeat', async () => {
    expect(await applyMigrations(db)).toEqual([]);
    const { rows } = await db.query('SELECT id FROM private.schema_migrations ORDER BY id');
    expect(rows).toHaveLength(3);
  });
  it('detects migration changes instead of silently reapplying them', async () => {
    const original = (await db.query<{ checksum: string }>("SELECT checksum FROM private.schema_migrations WHERE id='0002_application_metadata'")).rows[0].checksum;
    await db.query("UPDATE private.schema_migrations SET checksum='changed' WHERE id='0002_application_metadata'");
    try { await expect(applyMigrations(db)).rejects.toThrow(/checksum mismatch/); }
    finally { await db.query("UPDATE private.schema_migrations SET checksum=$1 WHERE id='0002_application_metadata'", [original]); }
    expect(await applyMigrations(db)).toEqual([]);
  });
  it('keeps vector search within row policies even when another user ID is supplied', async () => {
    const vector = '[' + [1, ...Array(767).fill(0)].join(',') + ']';
    for (const [user, content] of [[evaluationUsers.alice, 'Alice memory'], [evaluationUsers.bob, 'Bob memory']]) {
      await db.query('INSERT INTO user_memories(user_id,content,embedding,memory_type) VALUES ($1,$2,$3::vector,$4)', [user, content, vector, 'context']);
    }
    await setEvaluationIdentity(db, 'alice');
    expect((await db.query('SELECT content FROM match_memories($1::vector,0.1,10,$2)', [vector, evaluationUsers.alice])).rows).toEqual([{ content: 'Alice memory' }]);
    expect((await db.query('SELECT content FROM match_memories($1::vector,0.1,10,$2)', [vector, evaluationUsers.bob])).rows).toEqual([]);
  });
  it('exposes only the signed-in user and their goals', async () => {
    await setEvaluationIdentity(db, 'alice');
    expect((await db.query('SELECT id FROM users')).rows).toEqual([{ id: evaluationUsers.alice }]);
    expect((await db.query('SELECT user_id FROM user_goals')).rows).toEqual([{ user_id: evaluationUsers.alice }]);
  });
  it('rejects cross-user inserts', async () => {
    await setEvaluationIdentity(db, 'alice');
    await expect(db.query('INSERT INTO workout_progress (user_id,workout_id,completed_indices,active_idx) VALUES ($1,$2,$3,$4)', [evaluationUsers.bob, 'attack', [0], 1])).rejects.toThrow(/row-level security/);
  });
  it('cannot impersonate another Firebase profile', async () => {
    await setEvaluationIdentity(db, 'alice');
    await expect(db.query('INSERT INTO users (firebase_uid,name) VALUES ($1,$2)', ['eve', 'Fake'])).rejects.toThrow(/row-level security/);
  });
  it('rejects tokens from an unrelated Firebase project', async () => {
    await setEvaluationIdentity(db, 'alice', 'untrusted-project');
    expect((await db.query('SELECT * FROM users')).rows).toEqual([]);
    expect((await db.query('SELECT * FROM user_goals')).rows).toEqual([]);
  });
  it('denies anonymous access and keeps OAuth tokens server-only', async () => {
    await db.exec('SET ROLE anon');
    await expect(db.query('SELECT * FROM users')).rejects.toThrow(/permission denied/);
    await setEvaluationIdentity(db, 'alice');
    await expect(db.query('SELECT * FROM google_integrations')).rejects.toThrow(/permission denied/);
    await expect(db.query('SELECT * FROM private.app_settings')).rejects.toThrow(/permission denied/);
  });
  it('roundtrips progress and supports repeated writes with the same identity', async () => {
    await setEvaluationIdentity(db, 'alice');
    const sql = 'INSERT INTO workout_progress (user_id,workout_id,completed_indices,active_idx) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,workout_id) DO UPDATE SET completed_indices=excluded.completed_indices,active_idx=excluded.active_idx';
    await db.query(sql, [evaluationUsers.alice, 'reset', [0], 1]);
    await db.query(sql, [evaluationUsers.alice, 'reset', [0, 1], 2]);
    expect((await db.query('SELECT completed_indices,active_idx FROM workout_progress')).rows).toEqual([{ completed_indices: [0, 1], active_idx: 2 }]);
    await setEvaluationIdentity(db, 'bob');
    expect((await db.query('SELECT * FROM workout_progress')).rows).toEqual([]);
  });
  it('enforces data-quality constraints', async () => {
    await setEvaluationIdentity(db, 'alice');
    await expect(db.query('INSERT INTO workout_sessions(user_id,duration_seconds) VALUES ($1,-1)', [evaluationUsers.alice])).rejects.toThrow(/check constraint/);
    await expect(db.query('INSERT INTO workout_progress(user_id,workout_id,active_idx) VALUES ($1,$2,-1)', [evaluationUsers.alice, 'invalid'])).rejects.toThrow(/check constraint/);
  });
});
