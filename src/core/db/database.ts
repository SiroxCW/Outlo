import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './schema';

export type Database = DatabaseSync;

export function transaction<Result>(db: Database, run: () => Result): Result {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Brings the database to the newest schema version. The version is kept in PRAGMA user_version.
export function migrate(db: Database, migrations: string[] = MIGRATIONS): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = row.user_version;
  if (current > migrations.length) {
    throw new Error(
      `The database has version ${current}, but this version of Outlo only knows version ${migrations.length}.`,
    );
  }

  for (let version = current; version < migrations.length; version++) {
    transaction(db, () => {
      db.exec(migrations[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db);
  return db;
}
