import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

class LocalD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new LocalD1Statement(this.database, this.sql, bindings);
  }

  _statement() {
    return this.database.prepare(this.sql);
  }

  async first(column) {
    const row = this._statement().get(...this.bindings) || null;
    return column && row ? row[column] : row;
  }

  async all() {
    return {success: true, results: this._statement().all(...this.bindings), meta: {}};
  }

  async run() {
    return this._run();
  }

  _run() {
    const result = this._statement().run(...this.bindings);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

export class LocalD1 {
  constructor(migrationPath) {
    this.database = new DatabaseSync(':memory:');
    this.database.exec(readFileSync(migrationPath, 'utf8'));
  }

  prepare(sql) {
    return new LocalD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement._run());
      this.database.exec('COMMIT');
      return results;
    } catch (caught) {
      this.database.exec('ROLLBACK');
      throw caught;
    }
  }

  rows(sql, ...bindings) {
    return this.database.prepare(sql).all(...bindings);
  }

  close() {
    this.database.close();
  }
}

export class FakeKV {
  data = new Map();

  async get(key) {
    return this.data.get(key) ?? null;
  }

  async put(key, value) {
    this.data.set(key, value);
  }
}
