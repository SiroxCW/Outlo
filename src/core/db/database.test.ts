import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, transaction } from './database';
import { MIGRATIONS } from './schema';

const version = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

const tables = (db: DatabaseSync) =>
  db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

describe('migrate', () => {
  it('applies every migration to a new database and records the version', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, ['CREATE TABLE a (x)', 'CREATE TABLE b (y)']);
    expect(version(db)).toBe(2);
    expect(tables(db)).toEqual(['a', 'b']);
  });

  it('applies only the migrations that are missing', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, ['CREATE TABLE a (x)']);
    db.exec('INSERT INTO a VALUES (1)');
    migrate(db, ['CREATE TABLE a (x)', 'ALTER TABLE a ADD COLUMN y']);
    expect(version(db)).toBe(2);
    expect(db.prepare('SELECT * FROM a').all()).toEqual([{ x: 1, y: null }]);
  });

  it('does nothing when the database is up to date', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, ['CREATE TABLE a (x)']);
    expect(() => migrate(db, ['CREATE TABLE a (x)'])).not.toThrow();
    expect(version(db)).toBe(1);
  });

  it('rolls a failing migration back completely and keeps the earlier ones', () => {
    const db = new DatabaseSync(':memory:');
    expect(() =>
      migrate(db, ['CREATE TABLE a (x)', 'CREATE TABLE b (y); CREATE TABLE b (again)']),
    ).toThrow();
    expect(version(db)).toBe(1);
    expect(tables(db)).toEqual(['a']);
  });

  it('refuses a database that a newer version of the app has written', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA user_version = 5');
    expect(() => migrate(db, ['CREATE TABLE a (x)'])).toThrow(/only knows version 1/);
  });
});

describe('transaction', () => {
  it('keeps the changes when the function returns', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE a (x)');
    expect(transaction(db, () => db.prepare('INSERT INTO a VALUES (1)').run().changes)).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM a').get()).toEqual({ n: 1 });
  });

  it('drops the changes when the function throws', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE a (x)');
    expect(() =>
      transaction(db, () => {
        db.exec('INSERT INTO a VALUES (1)');
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(db.prepare('SELECT count(*) AS n FROM a').get()).toEqual({ n: 0 });
  });
});

describe('openDatabase', () => {
  let directory: string | undefined;
  afterEach(() => directory && rmSync(directory, { recursive: true, force: true }));

  it('creates the schema, uses WAL mode and enforces foreign keys', () => {
    directory = mkdtempSync(join(tmpdir(), 'outlo-test-'));
    const db = openDatabase(join(directory, 'test.db'));
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(tables(db)).toEqual(
      expect.arrayContaining(['accounts', 'folders', 'messages', 'message_bodies', 'settings']),
    );
    expect(() =>
      db.exec("INSERT INTO folders (account_id, name) VALUES (999, 'orphan')"),
    ).toThrow();
    db.close();
  });

  it('opens an existing database again without losing data', () => {
    directory = mkdtempSync(join(tmpdir(), 'outlo-test-'));
    const path = join(directory, 'test.db');
    const first = openDatabase(path);
    first.exec("INSERT INTO settings VALUES ('theme', 'dark')");
    first.close();
    const second = openDatabase(path);
    expect(second.prepare('SELECT value FROM settings').get()).toEqual({ value: 'dark' });
    second.close();
  });
});
