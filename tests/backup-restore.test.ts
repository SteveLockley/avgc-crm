/**
 * Backup/Restore Integration Test
 *
 * Tests that database backup and restore produces identical data.
 * Uses better-sqlite3 to simulate D1 locally.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Simulated D1Database interface matching Cloudflare D1
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): T | null;
  all<T = unknown>(): D1Result<T>;
  run(): D1Result;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

// Wrap better-sqlite3 to match D1 interface
function wrapDatabase(db: Database.Database): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      const stmt = db.prepare(query);
      let boundValues: unknown[] = [];

      return {
        bind(...values: unknown[]): D1PreparedStatement {
          boundValues = values;
          return this;
        },
        first<T = unknown>(): T | null {
          try {
            const result = stmt.get(...boundValues) as T | undefined;
            return result ?? null;
          } catch {
            return null;
          }
        },
        all<T = unknown>(): D1Result<T> {
          try {
            const results = stmt.all(...boundValues) as T[];
            return { results, success: true, meta: { changes: 0 } };
          } catch {
            return { results: [], success: false, meta: { changes: 0 } };
          }
        },
        run(): D1Result {
          try {
            const result = stmt.run(...boundValues);
            return { results: [], success: true, meta: { changes: result.changes } };
          } catch {
            return { results: [], success: false, meta: { changes: 0 } };
          }
        }
      };
    }
  };
}

// Export database function (mirrors backup.ts logic)
async function exportDatabase(db: D1Database): Promise<string> {
  const tablesResult = await db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE '_cf_%'
    AND name NOT LIKE '%_content'
    AND name NOT LIKE '%_segments'
    AND name NOT LIKE '%_segdir'
    AND name NOT LIKE '%_docsize'
    AND name NOT LIKE '%_stat'
    AND name NOT LIKE '%_config'
    AND name NOT LIKE '%_data'
    AND name NOT LIKE '%_idx'
    ORDER BY name
  `).all();

  const tables = tablesResult.results?.map((r: any) => r.name) || [];
  const backup: Record<string, any> = {
    metadata: {
      exportedAt: new Date().toISOString(),
      tables: tables,
      version: '1.0'
    },
    data: {}
  };

  for (const table of tables) {
    const data = await db.prepare(`SELECT * FROM "${table}"`).all();
    backup.data[table] = data.results || [];
  }

  return JSON.stringify(backup, null, 2);
}

// Restore database function (mirrors restore.ts logic)
async function restoreDatabase(db: D1Database, backupContent: string): Promise<{ totalRestored: number; results: Record<string, { deleted: number; inserted: number }> }> {
  const backup = JSON.parse(backupContent);

  // Tables to restore in order (respecting foreign keys)
  const tableOrder = [
    'invoice_settings',
    'payment_items',
    'members',
    'invoices',
    'invoice_items',
    'payments',
    'payment_line_items',
    'subscription_history',
    'audit_log'
  ];

  let restored = 0;
  const results: Record<string, { deleted: number; inserted: number }> = {};

  // Process tables in order
  for (const table of tableOrder) {
    if (!backup.data[table] || !Array.isArray(backup.data[table])) continue;

    const rows = backup.data[table];
    if (rows.length === 0) continue;

    const deleteResult = await db.prepare(`DELETE FROM "${table}"`).run();
    const deleted = deleteResult.meta.changes || 0;

    let inserted = 0;
    for (const row of rows) {
      const columns = Object.keys(row).filter(k => row[k] !== null);
      const values = columns.map(k => row[k]);
      const placeholders = columns.map(() => '?').join(', ');

      try {
        await db.prepare(
          `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
        ).bind(...values).run();
        inserted++;
      } catch (e) {
        // Skip failed inserts
      }
    }

    results[table] = { deleted, inserted };
    restored += inserted;
  }

  // Also restore any tables not in the predefined order
  for (const [table, rows] of Object.entries(backup.data)) {
    if (tableOrder.includes(table)) continue;
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const deleteResult = await db.prepare(`DELETE FROM "${table}"`).run();
    const deleted = deleteResult.meta.changes || 0;

    let inserted = 0;
    for (const row of rows as any[]) {
      const columns = Object.keys(row).filter(k => row[k] !== null);
      const values = columns.map(k => row[k]);
      const placeholders = columns.map(() => '?').join(', ');

      try {
        await db.prepare(
          `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
        ).bind(...values).run();
        inserted++;
      } catch (e) {
        // Skip failed inserts
      }
    }

    results[table] = { deleted, inserted };
    restored += inserted;
  }

  return { totalRestored: restored, results };
}

// Create test schema (simplified version of the real schema)
function createTestSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'other',
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membership_no TEXT UNIQUE,
      title TEXT,
      forename TEXT NOT NULL,
      surname TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      town TEXT,
      county TEXT,
      postcode TEXT,
      subscription_type TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id),
      invoice_number TEXT NOT NULL UNIQUE,
      invoice_date TEXT NOT NULL,
      due_date TEXT,
      status TEXT DEFAULT 'draft',
      total_amount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id),
      payment_date TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT,
      reference TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Seed test data
function seedTestData(db: Database.Database) {
  // Payment items
  db.exec(`
    INSERT INTO payment_items (code, description, amount, category) VALUES
    ('FULL', 'Full Membership', 850.00, 'subscription'),
    ('5DAY', '5-Day Membership', 650.00, 'subscription'),
    ('LOCKER', 'Locker Rental', 50.00, 'facility');
  `);

  // Members
  db.exec(`
    INSERT INTO members (membership_no, forename, surname, email, subscription_type, status) VALUES
    ('M001', 'John', 'Smith', 'john.smith@example.com', 'Full', 'active'),
    ('M002', 'Jane', 'Doe', 'jane.doe@example.com', '5-Day', 'active'),
    ('M003', 'Bob', 'Wilson', 'bob.wilson@example.com', 'Full', 'lapsed');
  `);

  // Invoices
  db.exec(`
    INSERT INTO invoices (member_id, invoice_number, invoice_date, status, total_amount) VALUES
    (1, 'INV-2025-001', '2025-01-15', 'paid', 850.00),
    (2, 'INV-2025-002', '2025-01-16', 'sent', 650.00);
  `);

  // Payments
  db.exec(`
    INSERT INTO payments (member_id, payment_date, amount, method, reference) VALUES
    (1, '2025-01-20', 850.00, 'BACS', 'REF001'),
    (1, '2024-12-15', 50.00, 'Card', 'REF002');
  `);

  // Audit log
  db.exec(`
    INSERT INTO audit_log (user_email, action, entity_type, entity_id, details) VALUES
    ('admin@test.com', 'create', 'member', '1', '{"name":"John Smith"}'),
    ('admin@test.com', 'update', 'member', '2', '{"field":"email"}');
  `);
}

// Compare two databases
function compareDatabases(source: Database.Database, target: Database.Database): { identical: boolean; differences: string[] } {
  const differences: string[] = [];

  // Get tables from source
  const sourceTables = source.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as { name: string }[];

  const targetTables = target.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as { name: string }[];

  const sourceTableNames = sourceTables.map(t => t.name);
  const targetTableNames = targetTables.map(t => t.name);

  // Check for missing tables
  for (const table of sourceTableNames) {
    if (!targetTableNames.includes(table)) {
      differences.push(`Table "${table}" missing in target`);
    }
  }

  for (const table of targetTableNames) {
    if (!sourceTableNames.includes(table)) {
      differences.push(`Table "${table}" extra in target`);
    }
  }

  // Compare data in each table
  for (const table of sourceTableNames) {
    if (!targetTableNames.includes(table)) continue;

    const sourceRows = source.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();
    const targetRows = target.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();

    if (sourceRows.length !== targetRows.length) {
      differences.push(`Table "${table}": row count differs (source: ${sourceRows.length}, target: ${targetRows.length})`);
      continue;
    }

    for (let i = 0; i < sourceRows.length; i++) {
      const sourceRow = sourceRows[i] as Record<string, unknown>;
      const targetRow = targetRows[i] as Record<string, unknown>;

      for (const key of Object.keys(sourceRow)) {
        // Skip auto-generated timestamps that might differ slightly
        if (key === 'created_at' || key === 'updated_at') continue;

        if (JSON.stringify(sourceRow[key]) !== JSON.stringify(targetRow[key])) {
          differences.push(`Table "${table}" row ${i + 1}: field "${key}" differs (source: ${sourceRow[key]}, target: ${targetRow[key]})`);
        }
      }
    }
  }

  return {
    identical: differences.length === 0,
    differences
  };
}

describe('Database Backup and Restore', () => {
  let sourceDb: Database.Database;
  let targetDb: Database.Database;
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    tempDir = path.join(__dirname, '.temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Create source database with test data
    sourceDb = new Database(':memory:');
    createTestSchema(sourceDb);
    seedTestData(sourceDb);

    // Create empty target database with same schema
    targetDb = new Database(':memory:');
    createTestSchema(targetDb);
  });

  afterEach(() => {
    // Close databases
    sourceDb.close();
    targetDb.close();

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should export database to valid JSON format', async () => {
    const wrappedSource = wrapDatabase(sourceDb);
    const backupJson = await exportDatabase(wrappedSource);
    const backup = JSON.parse(backupJson);

    expect(backup.metadata).toBeDefined();
    expect(backup.metadata.version).toBe('1.0');
    expect(backup.metadata.exportedAt).toBeDefined();
    expect(backup.metadata.tables).toBeInstanceOf(Array);
    expect(backup.data).toBeDefined();

    // Check that all tables are exported
    expect(backup.data.payment_items).toBeDefined();
    expect(backup.data.members).toBeDefined();
    expect(backup.data.invoices).toBeDefined();
    expect(backup.data.payments).toBeDefined();
    expect(backup.data.audit_log).toBeDefined();
  });

  it('should export correct number of rows per table', async () => {
    const wrappedSource = wrapDatabase(sourceDb);
    const backupJson = await exportDatabase(wrappedSource);
    const backup = JSON.parse(backupJson);

    expect(backup.data.payment_items.length).toBe(3);
    expect(backup.data.members.length).toBe(3);
    expect(backup.data.invoices.length).toBe(2);
    expect(backup.data.payments.length).toBe(2);
    expect(backup.data.audit_log.length).toBe(2);
  });

  it('should restore database from backup', async () => {
    const wrappedSource = wrapDatabase(sourceDb);
    const wrappedTarget = wrapDatabase(targetDb);

    // Export source
    const backupJson = await exportDatabase(wrappedSource);

    // Restore to target
    const result = await restoreDatabase(wrappedTarget, backupJson);

    expect(result.totalRestored).toBeGreaterThan(0);
    expect(result.results.members?.inserted).toBe(3);
    expect(result.results.payment_items?.inserted).toBe(3);
  });

  it('should produce identical data after backup and restore', async () => {
    const wrappedSource = wrapDatabase(sourceDb);
    const wrappedTarget = wrapDatabase(targetDb);

    // Export source
    const backupJson = await exportDatabase(wrappedSource);

    // Restore to target
    await restoreDatabase(wrappedTarget, backupJson);

    // Compare databases
    const comparison = compareDatabases(sourceDb, targetDb);

    if (!comparison.identical) {
      console.log('Differences found:', comparison.differences);
    }

    expect(comparison.identical).toBe(true);
    expect(comparison.differences).toHaveLength(0);
  });

  it('should handle empty tables correctly', async () => {
    // Create a new database with empty tables
    const emptyDb = new Database(':memory:');
    createTestSchema(emptyDb);

    const wrappedEmpty = wrapDatabase(emptyDb);
    const wrappedTarget = wrapDatabase(targetDb);

    // Export empty database
    const backupJson = await exportDatabase(wrappedEmpty);
    const backup = JSON.parse(backupJson);

    // All tables should exist but be empty
    expect(backup.data.members).toHaveLength(0);
    expect(backup.data.payments).toHaveLength(0);

    // Restore should work without errors
    const result = await restoreDatabase(wrappedTarget, backupJson);
    expect(result.totalRestored).toBe(0);

    emptyDb.close();
  });

  it('should overwrite existing data on restore', async () => {
    const wrappedSource = wrapDatabase(sourceDb);
    const wrappedTarget = wrapDatabase(targetDb);

    // First, add some different data to target
    targetDb.exec(`
      INSERT INTO members (membership_no, forename, surname, email, subscription_type) VALUES
      ('DIFFERENT', 'Different', 'Person', 'different@test.com', 'Full');
    `);

    // Verify target has different data
    const beforeRestore = targetDb.prepare('SELECT COUNT(*) as count FROM members').get() as { count: number };
    expect(beforeRestore.count).toBe(1);

    // Export source and restore to target
    const backupJson = await exportDatabase(wrappedSource);
    await restoreDatabase(wrappedTarget, backupJson);

    // Target should now match source
    const afterRestore = targetDb.prepare('SELECT COUNT(*) as count FROM members').get() as { count: number };
    expect(afterRestore.count).toBe(3);

    // Compare databases
    const comparison = compareDatabases(sourceDb, targetDb);
    expect(comparison.identical).toBe(true);
  });

  it('should preserve data integrity with special characters', async () => {
    // Insert data with special characters
    sourceDb.prepare(`
      INSERT INTO members (membership_no, forename, surname, email, subscription_type)
      VALUES (?, ?, ?, ?, ?)
    `).run('M004', "O'Brien", 'Smith-Jones', 'test+special@example.com', 'Full');

    sourceDb.prepare(`
      INSERT INTO audit_log (user_email, action, entity_type, details)
      VALUES (?, ?, ?, ?)
    `).run('admin@test.com', 'note', 'member', '{"note":"Line 1\\nLine 2\\tTabbed"}');

    const wrappedSource = wrapDatabase(sourceDb);
    const wrappedTarget = wrapDatabase(targetDb);

    // Export and restore
    const backupJson = await exportDatabase(wrappedSource);
    await restoreDatabase(wrappedTarget, backupJson);

    // Verify special characters preserved
    const member = targetDb.prepare("SELECT * FROM members WHERE membership_no = 'M004'").get() as any;
    expect(member.forename).toBe("O'Brien");
    expect(member.surname).toBe('Smith-Jones');

    const comparison = compareDatabases(sourceDb, targetDb);
    expect(comparison.identical).toBe(true);
  });

  it('should write backup to file and restore from file', async () => {
    const wrappedSource = wrapDatabase(sourceDb);
    const wrappedTarget = wrapDatabase(targetDb);

    // Export to file
    const backupJson = await exportDatabase(wrappedSource);
    const backupPath = path.join(tempDir, 'test-backup.json');
    fs.writeFileSync(backupPath, backupJson);

    // Read from file and restore
    const readBackup = fs.readFileSync(backupPath, 'utf-8');
    await restoreDatabase(wrappedTarget, readBackup);

    // Compare
    const comparison = compareDatabases(sourceDb, targetDb);
    expect(comparison.identical).toBe(true);
  });

  it('should handle NULL values correctly', async () => {
    // Insert member with NULL fields
    sourceDb.prepare(`
      INSERT INTO members (membership_no, forename, surname, email, phone, address_line1)
      VALUES (?, ?, ?, NULL, NULL, NULL)
    `).run('M005', 'Null', 'Test');

    const wrappedSource = wrapDatabase(sourceDb);
    const wrappedTarget = wrapDatabase(targetDb);

    // Export and restore
    const backupJson = await exportDatabase(wrappedSource);
    await restoreDatabase(wrappedTarget, backupJson);

    // Verify NULL values preserved
    const member = targetDb.prepare("SELECT * FROM members WHERE membership_no = 'M005'").get() as any;
    expect(member.email).toBeNull();
    expect(member.phone).toBeNull();
    expect(member.address_line1).toBeNull();

    const comparison = compareDatabases(sourceDb, targetDb);
    expect(comparison.identical).toBe(true);
  });

  it('should handle numeric values with precision', async () => {
    // Insert payment with decimal amount
    sourceDb.prepare(`
      INSERT INTO payments (member_id, payment_date, amount, method, reference)
      VALUES (?, ?, ?, ?, ?)
    `).run(1, '2025-01-25', 123.456789, 'Card', 'PRECISION-TEST');

    const wrappedSource = wrapDatabase(sourceDb);
    const wrappedTarget = wrapDatabase(targetDb);

    // Export and restore
    const backupJson = await exportDatabase(wrappedSource);
    await restoreDatabase(wrappedTarget, backupJson);

    // Verify numeric precision - use reference to find specific payment
    const payment = targetDb.prepare("SELECT amount FROM payments WHERE reference = 'PRECISION-TEST'").get() as any;
    expect(payment.amount).toBeCloseTo(123.456789, 6);
  });
});
