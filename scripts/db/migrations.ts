import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';

const groups = [
  { id: '0001_baseline', files: ['migration.sql', 'onboarding_state.sql', 'workout_progress.sql', 'message_sync_migration.sql'] },
  { id: '0002_application_metadata', files: ['migrations/0002_application_metadata.sql'] },
  { id: '0003_firebase_authorization', files: ['migrations/0003_firebase_authorization.sql'] },
];

/** Atomic, checksummed migration runner for isolated evaluation databases. */
export async function applyMigrations(db: PGlite): Promise<string[]> {
  const migrations = await Promise.all(groups.map(async group => {
    const sql = (await Promise.all(group.files.map(file => readFile(new URL(`../../supabase/${file}`, import.meta.url), 'utf8')))).join('\n');
    return { ...group, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  return db.transaction(async tx => {
    await tx.exec('CREATE SCHEMA IF NOT EXISTS private; REVOKE ALL ON SCHEMA private FROM PUBLIC; CREATE TABLE IF NOT EXISTS private.schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const applied: string[] = [];
    for (const migration of migrations) {
      const existing = await tx.query<{ checksum: string }>('SELECT checksum FROM private.schema_migrations WHERE id = $1', [migration.id]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.id}`);
        continue;
      }
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO private.schema_migrations (id, checksum) VALUES ($1, $2)', [migration.id, migration.checksum]);
      applied.push(migration.id);
    }
    return applied;
  });
}
