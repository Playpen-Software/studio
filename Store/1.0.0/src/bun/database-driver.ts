import type { Database, SQLQueryBindings } from 'bun:sqlite';
import * as fsSync from 'node:fs';
import * as readline from 'node:readline';
import type { QueryRule, QueryUnifiedOptions } from '../types/store-types';
import type { InventoryDelta, InventoryDeltaResult } from '../types/inventory-delta';

export type SupportedVersion = '0.1.0' | '0.2.0' | '1.0.0';
export type ChunkCap = 'auto' | 'max' | number;

export interface QueryOptions {
  rules?: QueryRule[];
  logicalOp?: 'AND' | 'OR';
}

export interface Space {
  id: number | bigint;
  name: string;
  imageBase64?: string | null;
  created_at?: string;
}

export interface Category {
  id: number | bigint;
  space_id: number | bigint;
  parent_category_id?: number | bigint | null;
  name: string;
  created_at?: string;
}

export interface CategoryAttributeInput {
  name: string;
  dataType: 'string' | 'number' | 'boolean' | 'date';
  isRequired?: boolean;
}

export interface ItemInput {
  name: string;
  categoryId: number | bigint;
  quantity?: number;
  reorderPoint?: number;
  iconBase64?: string | null;
  galleryBase64?: string[];
  attributes?: Record<string, string | number | boolean>;
}

export interface Item {
  id: number | bigint;
  category_id: number | bigint;
  name: string;
  quantity: number;
  reorder_point: number;
  iconBase64: string | null;
  galleryBase64: string[];
  created_at?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface ConvertOptions {
  sourceVersion?: SupportedVersion | 'auto';
  targetSpaceId: number | bigint;
  chunkCap?: ChunkCap;
}

export interface InspectionResult {
  detectedVersion: SupportedVersion | 'unknown';
  isValidSchema: boolean;
}

function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS spaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image_base64 TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id INTEGER NOT NULL,
        parent_category_id INTEGER NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        reorder_point REAL NOT NULL DEFAULT 0,
        icon_base64 TEXT,
        gallery_json TEXT NOT NULL DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS category_attributes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        data_type TEXT NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'date')),
        is_required BOOLEAN DEFAULT 0,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        UNIQUE(category_id, name)
    );

    CREATE TABLE IF NOT EXISTS item_attribute_values (
        item_id INTEGER NOT NULL,
        attribute_id INTEGER NOT NULL,
        value_string TEXT,
        value_number REAL,
        value_date DATETIME,
        value_boolean BOOLEAN,
        PRIMARY KEY (item_id, attribute_id),
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
        FOREIGN KEY (attribute_id) REFERENCES category_attributes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_entity_versions (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        modified_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (entity_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_delta_queue (
        delta_id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        payload_json TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'stale')),
        result_json TEXT
    );
  `);
}

function getTableColumns(db: Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map(column => column.name)
  );
}

function mapItemRow(row: Record<string, unknown>): Item {
  const rawGallery = row['gallery_json'];
  let galleryBase64: string[] = [];
  if (typeof rawGallery === 'string') {
    const parsed: unknown = JSON.parse(rawGallery);
    if (!Array.isArray(parsed) || parsed.some(image => typeof image !== 'string')) {
      throw new Error(`Item ${String(row['id'])} has invalid gallery data.`);
    }
    galleryBase64 = parsed;
  }
  return {
    id: row['id'] as number | bigint,
    category_id: row['category_id'] as number | bigint,
    name: row['name'] as string,
    quantity: row['quantity'] as number,
    reorder_point: row['reorder_point'] as number,
    iconBase64: row['icon_base64'] as string | null,
    galleryBase64,
    created_at: row['created_at'] as string | undefined
  };
}

function migrateLegacySchema(db: Database): void {
  const spaces = db.prepare('SELECT * FROM spaces').all() as Record<string, any>[];
  const categories = db.prepare('SELECT * FROM categories').all() as Record<string, any>[];
  const items = db.prepare('SELECT * FROM items').all() as Record<string, any>[];
  const spaceColumns = getTableColumns(db, 'spaces');
  const categoryColumns = getTableColumns(db, 'categories');
  const itemColumns = getTableColumns(db, 'items');
  const categoryAttributes = new Map<number | bigint, Set<string>>();
  const itemAttributes = new Map<number | bigint, Record<string, unknown>>();

  for (const category of categories) {
    const names = new Set<string>();
    if (categoryColumns.has('fields_template')) {
      const template = category['fields_template'];
      if (typeof template === 'string') {
        const parsed: unknown = JSON.parse(template || '[]');
        if (!Array.isArray(parsed) || parsed.some(name => typeof name !== 'string')) {
          throw new Error(`Category ${category['id']} has an invalid fields template.`);
        }
        parsed.forEach(name => names.add(name));
      }
    }
    categoryAttributes.set(category['id'], names);
  }

  for (const item of items) {
    const attributesValue = itemColumns.has('attributes') ? item['attributes'] : null;
    const attributes: Record<string, unknown> = typeof attributesValue === 'string'
      ? JSON.parse(attributesValue || '{}')
      : {};
    if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) {
      throw new Error(`Item ${item['id']} has invalid stored attributes.`);
    }
    itemAttributes.set(item['id'], attributes);
    const names = categoryAttributes.get(item['category_id']);
    if (names) {
      Object.keys(attributes).forEach(name => names.add(name));
    }
  }

  const attributeTypes = new Map<number | bigint, Map<string, CategoryAttributeInput['dataType']>>();
  for (const [categoryId, names] of categoryAttributes) {
    const types = new Map<string, CategoryAttributeInput['dataType']>();
    for (const name of names) {
      const values = items
        .filter(item => item['category_id'] === categoryId)
        .map(item => itemAttributes.get(item['id'])?.[name])
        .filter(value => value !== null && value !== undefined);
      const type = values.length > 0 && values.every(value => typeof value === 'number')
        ? 'number'
        : values.length > 0 && values.every(value => typeof value === 'boolean')
          ? 'boolean'
          : 'string';
      types.set(name, type);
    }
    attributeTypes.set(categoryId, types);
  }

  db.run('PRAGMA foreign_keys = OFF');
  db.run('BEGIN IMMEDIATE');
  try {
    db.run(`
      DROP TABLE IF EXISTS item_attributes_index;
      DROP TABLE IF EXISTS item_attribute_values;
      DROP TABLE IF EXISTS category_attributes;
      DROP TABLE items;
      DROP TABLE categories;
      DROP TABLE spaces;
    `);
    createSchema(db);

    const insertSpace = db.prepare(`
      INSERT INTO spaces (id, name, image_base64) VALUES (?, ?, ?)
    `);
    for (const space of spaces) {
      insertSpace.run(
        space['id'],
        space['name'],
        spaceColumns.has('image_base64') ? space['image_base64'] ?? null : null
      );
    }

    const insertCategory = db.prepare(`
      INSERT INTO categories (id, space_id, parent_category_id, name)
      VALUES (?, ?, NULL, ?)
    `);
    const setParentCategory = db.prepare(
      'UPDATE categories SET parent_category_id = ? WHERE id = ?'
    );
    for (const category of categories) {
      insertCategory.run(category['id'], category['parent_space'], category['name']);
      if (categoryColumns.has('parent_category') && category['parent_category'] !== null) {
        setParentCategory.run(category['parent_category'], category['id']);
      }
    }

    const insertAttribute = db.prepare(`
      INSERT INTO category_attributes (category_id, name, data_type, is_required)
      VALUES (?, ?, ?, 0)
    `);
    const insertItemAttribute = db.prepare(`
      INSERT INTO item_attribute_values
        (item_id, attribute_id, value_string, value_number, value_date, value_boolean)
      VALUES (?, ?, ?, ?, NULL, ?)
    `);
    const attributeIds = new Map<number | bigint, Map<string, number | bigint>>();
    for (const [categoryId, types] of attributeTypes) {
      const ids = new Map<string, number | bigint>();
      for (const [name, dataType] of types) {
        ids.set(name, insertAttribute.run(categoryId, name, dataType).lastInsertRowid);
      }
      attributeIds.set(categoryId, ids);
    }

    const insertItem = db.prepare(`
      INSERT INTO items (id, category_id, name, quantity, reorder_point)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      const restockPoint = itemColumns.has('restock_point')
        ? item['restock_point'] ?? 0
        : item['reorder_point'] ?? 0;
      insertItem.run(
        item['id'],
        item['category_id'],
        item['name'],
        item['quantity'] ?? 0,
        restockPoint
      );
      const ids = attributeIds.get(item['category_id']);
      for (const [name, value] of Object.entries(itemAttributes.get(item['id']) ?? {})) {
        const attributeId = ids?.get(name);
        if (attributeId === undefined || value === null || value === undefined) continue;
        const dataType = attributeTypes.get(item['category_id'])?.get(name);
        insertItemAttribute.run(
          item['id'],
          attributeId,
          dataType === 'string' ? String(value) : null,
          dataType === 'number' ? Number(value) : null,
          dataType === 'boolean' ? (value ? 1 : 0) : null
        );
      }
    }

    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  } finally {
    db.run('PRAGMA foreign_keys = ON');
  }
}

export function initDatabase(db: Database): void {
  db.run('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const categoryColumns = getTableColumns(db, 'categories');
  if (categoryColumns.has('parent_space')) {
    migrateLegacySchema(db);
  }

  createSchema(db);
  const itemColumns = getTableColumns(db, 'items');
  if (!itemColumns.has('reorder_point')) {
    db.run('ALTER TABLE items ADD COLUMN reorder_point REAL NOT NULL DEFAULT 0');
    if (itemColumns.has('restock_point')) {
      db.run('UPDATE items SET reorder_point = restock_point');
    }
  }
  if (!itemColumns.has('icon_base64')) {
    db.run('ALTER TABLE items ADD COLUMN icon_base64 TEXT');
  }
  if (!itemColumns.has('gallery_json')) {
    db.run("ALTER TABLE items ADD COLUMN gallery_json TEXT NOT NULL DEFAULT '[]'");
  }
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
    CREATE INDEX IF NOT EXISTS idx_items_low_stock ON items(quantity, reorder_point) WHERE reorder_point > 0;
    CREATE INDEX IF NOT EXISTS idx_attr_val_num ON item_attribute_values(attribute_id, value_number);
    CREATE INDEX IF NOT EXISTS idx_attr_val_str ON item_attribute_values(attribute_id, value_string);
  `);
}

export function createSqliteDatabaseApi(db: Database) {
  let transactionDepth = 0;
  const getPagination = (cap?: number, index = 0): { sql: string; values: number[] } => {
    if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 0)) {
      throw new Error('The result cap must be a non-negative safe integer.');
    }
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error('The result index must be a non-negative safe integer.');
    }

    return {
      sql: cap === undefined ? 'LIMIT -1 OFFSET ?' : 'LIMIT ? OFFSET ?',
      values: cap === undefined ? [index] : [cap, index],
    };
  };

  const buildRuleWhere = (
    rules: QueryRule[] = [],
    logicalOp: 'AND' | 'OR' = 'AND',
    fields: Record<string, string> = {}
  ): { sql: string; values: SQLQueryBindings[] } => {
    if (!Array.isArray(rules)) throw new Error('Query rules must be an array.');
    if (logicalOp !== 'AND' && logicalOp !== 'OR') {
      throw new Error('The query logical operator must be AND or OR.');
    }

    const allowedOperators = new Set(['=', '>=', '<=', '>', '<', 'LIKE', '!=']);
    const conditions: string[] = [];
    const values: SQLQueryBindings[] = [];

    for (const rule of rules) {
      if (!rule || !allowedOperators.has(rule.operator)) {
        throw new Error('A query rule has an unsupported operator.');
      }
      if (rule.type !== 'native' || !Object.hasOwn(fields, rule.field)) {
        throw new Error(`Unsupported query field: ${rule.field}`);
      }

      conditions.push(`${fields[rule.field]} ${rule.operator} ?`);
      values.push(rule.value);
    }

    return {
      sql: conditions.length ? `(${conditions.join(` ${logicalOp} `)})` : '',
      values,
    };
  };

  const runTransaction = <T>(callback: () => T): T => {
    const depth = transactionDepth;
    const savepoint = `inventory_savepoint_${depth}`;
    if (depth === 0) db.run('BEGIN IMMEDIATE');
    else db.run(`SAVEPOINT ${savepoint}`);
    transactionDepth = depth + 1;
    try {
      const result = callback();
      transactionDepth = depth;
      if (depth === 0) db.run('COMMIT');
      else db.run(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (err) {
      transactionDepth = depth;
      if (depth === 0) db.run('ROLLBACK');
      else {
        db.run(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.run(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw err;
    }
  };

  // --- Spaces ---
  const createSpace = (name: string, imageBase64: string | null = null): number | bigint => {
    const stmt = db.prepare('INSERT INTO spaces (name, image_base64) VALUES (?, ?)');
    const info = stmt.run(name, imageBase64);
    return info.lastInsertRowid;
  };

  const updateSpace = (id: number | bigint, updates: { name?: string; imageBase64?: string | null }): boolean => {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.imageBase64 !== undefined) {
      fields.push('image_base64 = ?');
      values.push(updates.imageBase64);
    }

    if (fields.length === 0) return false;
    values.push(id);

    const stmt = db.prepare(`UPDATE spaces SET ${fields.join(', ')} WHERE id = ?`);
    const info = stmt.run(...values);
    return info.changes > 0;
  };

  const listSpaces = (cap?: number, index = 0): Space[] => {
    const pagination = getPagination(cap, index);
    return db
      .prepare(`SELECT id, name, image_base64 AS imageBase64, created_at
        FROM spaces ORDER BY id ${pagination.sql}`)
      .all(...pagination.values) as Space[];
  };

  const querySpaces = (options: QueryOptions = {}, cap?: number, index = 0): Space[] => {
    const rules = buildRuleWhere(options.rules, options.logicalOp, {
      id: 'id',
      name: 'name',
      imageBase64: 'image_base64',
      created_at: 'created_at',
    });
    const pagination = getPagination(cap, index);
    const where = rules.sql ? `WHERE ${rules.sql}` : '';
    return db
      .prepare(`SELECT id, name, image_base64 AS imageBase64, created_at
        FROM spaces ${where} ORDER BY id ${pagination.sql}`)
      .all(...rules.values, ...pagination.values) as Space[];
  };

  const loadItemAttributes = (itemId: number | bigint): Record<string, string | number | boolean> => {
    const rows = db.prepare(`SELECT ca.name, ca.data_type, iav.value_string, iav.value_number,
      iav.value_boolean, iav.value_date
      FROM item_attribute_values AS iav
      JOIN category_attributes AS ca ON ca.id = iav.attribute_id
      WHERE iav.item_id = ?`).all(itemId) as {
        name: string;
        data_type: string;
        value_string: string | null;
        value_number: number | null;
        value_boolean: number | null;
        value_date: string | null;
      }[];
    const attributes: Record<string, string | number | boolean> = {};
    for (const row of rows) {
      const value = row.data_type === 'number'
        ? row.value_number
        : row.data_type === 'boolean'
          ? row.value_boolean === null ? null : Boolean(row.value_boolean)
          : row.data_type === 'date'
            ? row.value_date
            : row.value_string;
      if (value !== null) attributes[row.name] = value;
    }
    return attributes;
  };

  const attachItemAttributes = (items: Item[]): Item[] =>
    items.map(item => ({ ...item, attributes: loadItemAttributes(item.id) }));

  const listItems = (cap?: number, index = 0): Item[] => {
    const pagination = getPagination(cap, index);
    const rows = db
      .prepare(`SELECT id, category_id, name, quantity, reorder_point, icon_base64, gallery_json, created_at
        FROM items ORDER BY id ${pagination.sql}`)
      .all(...pagination.values) as Record<string, unknown>[];
    return attachItemAttributes(rows.map(mapItemRow));
  };

  const queryItems = (
    options: QueryUnifiedOptions = {},
    cap?: number,
    index = 0
  ): Item[] => {
    const rules: string[] = [];
    const values: SQLQueryBindings[] = [];
    if (options.categoryId !== undefined && options.categoryId !== null) {
      rules.push('i.category_id = ?');
      values.push(options.categoryId);
    }

    if (!Array.isArray(options.rules ?? [])) {
      throw new Error('Query rules must be an array.');
    }
    if (options.logicalOp !== undefined && options.logicalOp !== 'AND' && options.logicalOp !== 'OR') {
      throw new Error('The query logical operator must be AND or OR.');
    }
    const logicalOp = options.logicalOp ?? 'AND';
    const nativeFields: Record<string, string> = {
      id: 'i.id',
      category_id: 'i.category_id',
      name: 'i.name',
      quantity: 'i.quantity',
      reorder_point: 'i.reorder_point',
      created_at: 'i.created_at',
    };
    const allowedOperators = new Set(['=', '>=', '<=', '>', '<', 'LIKE', '!=']);
    const ruleConditions: string[] = [];

    for (const rule of options.rules ?? []) {
      if (!rule || !allowedOperators.has(rule.operator)) {
        throw new Error('A query rule has an unsupported operator.');
      }
      if (rule.type === 'native') {
        if (!Object.hasOwn(nativeFields, rule.field)) {
          throw new Error(`Unsupported item query field: ${rule.field}`);
        }
        ruleConditions.push(`${nativeFields[rule.field]} ${rule.operator} ?`);
        values.push(rule.value);
      } else if (rule.type === 'attribute') {
        ruleConditions.push(`EXISTS (
          SELECT 1
          FROM item_attribute_values AS iav
          JOIN category_attributes AS ca ON ca.id = iav.attribute_id
          WHERE iav.item_id = i.id AND ca.name = ?
            AND CASE ca.data_type
              WHEN 'number' THEN iav.value_number
              WHEN 'boolean' THEN iav.value_boolean
              WHEN 'date' THEN iav.value_date
              ELSE iav.value_string
            END ${rule.operator} ?
        )`);
        values.push(rule.field, typeof rule.value === 'boolean' ? Number(rule.value) : rule.value);
      } else {
        throw new Error('A query rule has an unsupported type.');
      }
    }

    if (ruleConditions.length) rules.push(`(${ruleConditions.join(` ${logicalOp} `)})`);
    const pagination = getPagination(cap, index);
    const where = rules.length ? `WHERE ${rules.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT i.id, i.category_id, i.name, i.quantity, i.reorder_point,
          i.icon_base64, i.gallery_json, i.created_at
        FROM items AS i ${where} ORDER BY i.id ${pagination.sql}`)
      .all(...values, ...pagination.values) as Record<string, unknown>[];
    return attachItemAttributes(rows.map(mapItemRow));
  };

  const deleteSpace = (id: number | bigint): boolean => {
    const info = db.prepare('DELETE FROM spaces WHERE id = ?').run(id);
    return info.changes > 0;
  };

  const resetDatabase = (): void => {
    runTransaction(() => {
      db.prepare('DELETE FROM spaces').run();
      db.prepare('DELETE FROM inventory_entity_versions').run();
      db.prepare('DELETE FROM inventory_delta_queue').run();
    });
  };

  // --- Categories ---
  const createCategory = (
    spaceId: number | bigint,
    name: string,
    parentCategoryId: number | bigint | null = null,
    attributes: CategoryAttributeInput[] = []
  ): number | bigint => {
    return runTransaction(() => {
      const catStmt = db.prepare(
        'INSERT INTO categories (space_id, name, parent_category_id) VALUES (?, ?, ?)'
      );
      const info = catStmt.run(spaceId, name, parentCategoryId);
      const categoryId = info.lastInsertRowid;

      const attrStmt = db.prepare(
        'INSERT INTO category_attributes (category_id, name, data_type, is_required) VALUES (?, ?, ?, ?)'
      );

      for (const attr of attributes) {
        attrStmt.run(categoryId, attr.name, attr.dataType, attr.isRequired ? 1 : 0);
      }

      return categoryId;
    });
  };

  const updateCategory = (
    id: number | bigint,
    updates: { name?: string; spaceId?: number | bigint; parentCategoryId?: number | bigint | null }
  ): boolean => {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.spaceId !== undefined) {
      fields.push('space_id = ?');
      values.push(updates.spaceId);
    }
    if (updates.parentCategoryId !== undefined) {
      fields.push('parent_category_id = ?');
      values.push(updates.parentCategoryId);
    }

    if (fields.length === 0) return false;
    values.push(id);

    const stmt = db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`);
    const info = stmt.run(...values);
    return info.changes > 0;
  };

  const listCategories = (spaceId: number | bigint, cap?: number, index = 0): Category[] => {
    const pagination = getPagination(cap, index);
    return db
      .prepare(`SELECT id, space_id, parent_category_id, name, created_at
        FROM categories WHERE space_id = ? ORDER BY id ${pagination.sql}`)
      .all(spaceId, ...pagination.values) as Category[];
  };

  const queryCategories = (
    spaceId: number | bigint,
    options: QueryOptions = {},
    cap?: number,
    index = 0
  ): Category[] => {
    const rules = buildRuleWhere(options.rules, options.logicalOp, {
      id: 'id',
      space_id: 'space_id',
      parent_category_id: 'parent_category_id',
      name: 'name',
      created_at: 'created_at',
    });
    const pagination = getPagination(cap, index);
    const where = rules.sql ? `AND ${rules.sql}` : '';
    return db
      .prepare(`SELECT id, space_id, parent_category_id, name, created_at
        FROM categories WHERE space_id = ? ${where} ORDER BY id ${pagination.sql}`)
      .all(spaceId, ...rules.values, ...pagination.values) as Category[];
  };

  const deleteCategory = (id: number | bigint): boolean => {
    const info = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return info.changes > 0;
  };

  // --- Items ---
  const createItem = (input: ItemInput): number | bigint => {
    return runTransaction(() => {
      const stmt = db.prepare(
        `INSERT INTO items
          (name, category_id, quantity, reorder_point, icon_base64, gallery_json)
          VALUES (?, ?, ?, ?, ?, ?)`
      );
      const info = stmt.run(
        input.name,
        input.categoryId,
        input.quantity ?? 0,
        input.reorderPoint ?? 0,
        input.iconBase64 ?? null,
        JSON.stringify(input.galleryBase64 ?? [])
      );
      const itemId = info.lastInsertRowid;

      if (input.attributes) {
        saveItemAttributes(itemId, input.categoryId, input.attributes);
      }

      return itemId;
    });
  };

  const createItemBulk = (items: ItemInput[]): void => {
    runTransaction(() => {
      const itemStmt = db.prepare(
        `INSERT INTO items
          (name, category_id, quantity, reorder_point, icon_base64, gallery_json)
          VALUES (?, ?, ?, ?, ?, ?)`
      );

      for (const item of items) {
        const info = itemStmt.run(
          item.name,
          item.categoryId,
          item.quantity ?? 0,
          item.reorderPoint ?? 0,
          item.iconBase64 ?? null,
          JSON.stringify(item.galleryBase64 ?? [])
        );
        if (item.attributes) {
          saveItemAttributes(info.lastInsertRowid, item.categoryId, item.attributes);
        }
      }
    });
  };

  const getItemById = (id: number | bigint): Item | null => {
    const row = db.prepare(`SELECT id, category_id, name, quantity, reorder_point,
      icon_base64, gallery_json, created_at FROM items WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? { ...mapItemRow(row), attributes: loadItemAttributes(id) } : null;
  };

  const updateItem = (
    id: number | bigint,
    updates: {
      name?: string;
      categoryId?: number | bigint;
      reorderPoint?: number;
      iconBase64?: string | null;
      galleryBase64?: string[];
      attributes?: Record<string, string | number | boolean>;
    }
  ): boolean => {
    const fields: string[] = [];
    const values: (string | number | bigint | null)[] = [];
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.categoryId !== undefined) {
      fields.push('category_id = ?');
      values.push(updates.categoryId);
    }
    if (updates.reorderPoint !== undefined) {
      fields.push('reorder_point = ?');
      values.push(updates.reorderPoint);
    }
    if (updates.iconBase64 !== undefined) {
      fields.push('icon_base64 = ?');
      values.push(updates.iconBase64);
    }
    if (updates.galleryBase64 !== undefined) {
      fields.push('gallery_json = ?');
      values.push(JSON.stringify(updates.galleryBase64));
    }
    if (fields.length === 0 && updates.attributes === undefined) return false;
    return runTransaction(() => {
      let changed = false;
      if (fields.length > 0) {
        values.push(id);
        changed = db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`)
          .run(...values).changes > 0;
      } else {
        changed = db.prepare('SELECT 1 FROM items WHERE id = ?').get(id) !== null;
      }
      if (changed && updates.attributes !== undefined) {
        const item = db.prepare('SELECT category_id FROM items WHERE id = ?').get(id) as
          | { category_id: number | bigint }
          | undefined;
        if (item) saveItemAttributes(id, item.category_id, updates.attributes);
      }
      return changed;
    });
  };

  const adjustItemQuantity = (id: number | bigint, amount: number): boolean => {
    if (!Number.isFinite(amount)) throw new Error('The quantity adjustment must be a finite number.');
    const info = db.prepare('UPDATE items SET quantity = quantity + ? WHERE id = ?').run(amount, id);
    return info.changes > 0;
  };

  const deleteItem = (id: number | bigint): boolean => {
    const info = db.prepare('DELETE FROM items WHERE id = ?').run(id);
    return info.changes > 0;
  };

  function saveItemAttributes(
    itemId: number | bigint,
    categoryId: number | bigint,
    attributes: Record<string, any>
  ): void {
    const catAttrs = db
      .prepare('SELECT id, name, data_type FROM category_attributes WHERE category_id = ?')
      .all(categoryId) as { id: number; name: string; data_type: string }[];

    const attrMap = new Map(catAttrs.map((a) => [a.name, a]));

    const valStmt = db.prepare(`
      INSERT INTO item_attribute_values (item_id, attribute_id, value_string, value_number, value_boolean, value_date)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id, attribute_id) DO UPDATE SET
        value_string=excluded.value_string,
        value_number=excluded.value_number,
        value_boolean=excluded.value_boolean,
        value_date=excluded.value_date
    `);

    for (const [key, val] of Object.entries(attributes)) {
      if (val === null || val === undefined) continue;
      const attrDef = attrMap.get(key);
      if (!attrDef) continue;

      let vStr = null,
        vNum = null,
        vBool = null,
        vDate = null;
      if (attrDef.data_type === 'number') vNum = Number(val);
      else if (attrDef.data_type === 'boolean') vBool = val ? 1 : 0;
      else if (attrDef.data_type === 'date') vDate = String(val);
      else vStr = String(val);

      valStmt.run(itemId, attrDef.id, vStr, vNum, vBool, vDate);
    }
  }

  // --- Conversion ---
  const detectFileVersion = async (source: string | Buffer): Promise<InspectionResult> => {
    try {
      let contentString = '';
      if (typeof source === 'string' && fsSync.existsSync(source)) {
        contentString = fsSync.readFileSync(source, 'utf-8').slice(0, 2048);
      } else if (Buffer.isBuffer(source)) {
        contentString = source.toString('utf-8', 0, 2048);
      }

      if (contentString.includes('"version": "1.0.0"') || contentString.includes('"version":"1.0.0"')) {
        return { detectedVersion: '1.0.0', isValidSchema: true };
      }
      if (contentString.includes('"version": "0.2.0"') || contentString.includes('"version":"0.2.0"')) {
        return { detectedVersion: '0.2.0', isValidSchema: true };
      }
      if (contentString.includes('keywords') || contentString.includes('location')) {
        return { detectedVersion: '0.1.0', isValidSchema: true };
      }

      return { detectedVersion: 'unknown', isValidSchema: false };
    } catch {
      return { detectedVersion: 'unknown', isValidSchema: false };
    }
  };

  const convert = async (
    source: string | Buffer,
    options: ConvertOptions
  ): Promise<{ importedItems: number; importedCategories: number }> => {
    let sourceVersion = options.sourceVersion;

    if (!sourceVersion || sourceVersion === 'auto') {
      const inspect = await detectFileVersion(source);
      if (inspect.detectedVersion === 'unknown') {
        throw new Error('Unable to auto-detect file version schema.');
      }
      sourceVersion = inspect.detectedVersion;
    }

    const spaces = listSpaces();
    if (!spaces.some((s) => s.id === options.targetSpaceId)) {
      throw new Error(`Target space ID ${options.targetSpaceId} does not exist.`);
    }

    if (sourceVersion === '0.1.0') {
      return await convertLegacy_0_1_0(source, options.targetSpaceId, options.chunkCap || 5000);
    }

    return { importedItems: 0, importedCategories: 0 };
  };

  const applyInventoryDelta = (delta: InventoryDelta): InventoryDeltaResult => {
    if (
      !delta ||
      typeof delta.id !== 'string' ||
      delta.id.length === 0 ||
      !Number.isSafeInteger(delta.timestamp) ||
      delta.timestamp < 0
    ) {
      throw new Error('The inventory delta is invalid.');
    }

    return runTransaction(() => {
      const previous = db.prepare(
        'SELECT status, result_json FROM inventory_delta_queue WHERE delta_id = ?'
      ).get(delta.id) as { status: string; result_json: string | null } | undefined;
      if (previous) {
        const recorded = previous.result_json
          ? JSON.parse(previous.result_json, (_key, value: unknown) =>
              typeof value === 'object' &&
              value !== null &&
              '__inventoryBigInt' in value &&
              typeof value.__inventoryBigInt === 'string'
                ? BigInt(value.__inventoryBigInt)
                : value
            ) as InventoryDeltaResult
          : { status: 'stale' as const };
        return { ...recorded, status: 'duplicate' };
      }

      const serializedDelta = JSON.stringify(delta, (_key, value: unknown) =>
        typeof value === 'bigint' ? { __inventoryBigInt: value.toString() } : value
      );
      db.prepare(`INSERT INTO inventory_delta_queue
        (delta_id, timestamp, payload_json, status) VALUES (?, ?, ?, 'pending')`)
        .run(delta.id, delta.timestamp, serializedDelta);

      const entityId = delta.action === 'create' ? null : String(delta.entityId);
      if (entityId !== null) {
        const version = db.prepare(`SELECT modified_at, deleted
          FROM inventory_entity_versions WHERE entity_type = ? AND entity_id = ?`)
          .get(delta.entity, entityId) as { modified_at: number; deleted: number } | undefined;
        if (version && (version.deleted || version.modified_at > delta.timestamp)) {
          const result: InventoryDeltaResult = { status: 'stale' };
          db.prepare(`UPDATE inventory_delta_queue
            SET status = 'stale', payload_json = NULL, result_json = ?
            WHERE delta_id = ?`).run(JSON.stringify(result), delta.id);
          return result;
        }
      }

      let value: number | bigint | boolean;
      switch (delta.entity) {
        case 'space':
          switch (delta.action) {
            case 'create':
              value = createSpace(delta.data.name, delta.data.imageBase64 ?? null);
              break;
            case 'update':
              value = updateSpace(delta.entityId, delta.data);
              break;
            case 'delete':
              value = deleteSpace(delta.entityId);
              break;
            default:
              throw new Error('The space delta action is not supported.');
          }
          break;
        case 'category':
          switch (delta.action) {
            case 'create':
              value = createCategory(
                delta.data.spaceId,
                delta.data.name,
                delta.data.parentCategoryId ?? null,
                delta.data.attributes ?? []
              );
              break;
            case 'update':
              value = updateCategory(delta.entityId, delta.data);
              break;
            case 'delete':
              value = deleteCategory(delta.entityId);
              break;
            default:
              throw new Error('The category delta action is not supported.');
          }
          break;
        case 'item':
          switch (delta.action) {
            case 'create':
              value = createItem(delta.data);
              break;
            case 'update':
              value = updateItem(delta.entityId, delta.data);
              break;
            case 'adjustQuantity':
              value = adjustItemQuantity(delta.entityId, delta.data.amount);
              break;
            case 'delete':
              value = deleteItem(delta.entityId);
              break;
            default:
              throw new Error('The item delta action is not supported.');
          }
          break;
        default:
          throw new Error('The inventory delta entity is not supported.');
      }

      if (typeof value === 'boolean' && !value) {
        const result: InventoryDeltaResult = { status: 'stale', value: false };
        db.prepare(`UPDATE inventory_delta_queue
          SET status = 'stale', payload_json = NULL, result_json = ?
          WHERE delta_id = ?`).run(JSON.stringify(result), delta.id);
        return result;
      }

      const result: InventoryDeltaResult = { status: 'applied', value };
      if (entityId !== null) {
        db.prepare(`INSERT INTO inventory_entity_versions
          (entity_type, entity_id, modified_at, deleted) VALUES (?, ?, ?, ?)
          ON CONFLICT(entity_type, entity_id) DO UPDATE SET
            modified_at = excluded.modified_at,
            deleted = excluded.deleted`)
          .run(delta.entity, entityId, delta.timestamp, delta.action === 'delete' ? 1 : 0);
      } else {
        db.prepare(`INSERT INTO inventory_entity_versions
          (entity_type, entity_id, modified_at, deleted) VALUES (?, ?, ?, 0)`)
          .run(delta.entity, String(value), delta.timestamp);
      }
      const resultJson = JSON.stringify(result, (_key, entry: unknown) =>
        typeof entry === 'bigint' ? { __inventoryBigInt: entry.toString() } : entry
      );
      db.prepare(`UPDATE inventory_delta_queue
        SET status = 'applied', payload_json = NULL, result_json = ?
        WHERE delta_id = ?`).run(resultJson, delta.id);
      return result;
    });
  };

  const getInventoryQueueStatus = (): { pending: number; applied: number; stale: number } => {
    const rows = db.prepare(`SELECT status, COUNT(*) AS count
      FROM inventory_delta_queue GROUP BY status`).all() as { status: string; count: number }[];
    const counts = { pending: 0, applied: 0, stale: 0 };
    for (const row of rows) {
      if (row.status === 'pending' || row.status === 'applied' || row.status === 'stale') {
        counts[row.status] = row.count;
      }
    }
    return counts;
  };

  async function convertLegacy_0_1_0(
    source: string | Buffer,
    spaceId: number | bigint,
    chunkCap: ChunkCap
  ): Promise<{ importedItems: number; importedCategories: number }> {
    const categoryId = createCategory(spaceId, 'Imported 0.1.0 Inventory', null, [
      { name: 'location', dataType: 'string' },
      { name: 'keywords', dataType: 'string' },
    ]);

    let threshold = typeof chunkCap === 'number' ? chunkCap : 5000;
    if (chunkCap === 'auto') threshold = 20000;
    if (chunkCap === 'max') threshold = 100000;

    let itemsChunk: ItemInput[] = [];
    let totalImported = 0;

    if (typeof source === 'string' && fsSync.existsSync(source)) {
      const fileStream = fsSync.createReadStream(source);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line);
          itemsChunk.push({
            name: raw.name,
            categoryId,
            quantity: raw.quantity || 0,
            attributes: {
              location: raw.location,
              keywords: raw.keywords,
            },
          });

          if (itemsChunk.length >= threshold) {
            createItemBulk(itemsChunk);
            totalImported += itemsChunk.length;
            itemsChunk = [];
          }
        } catch (e) {
          throw new Error(`Failed to parse legacy JSON line: ${e}`);
        }
      }

      if (itemsChunk.length > 0) {
        createItemBulk(itemsChunk);
        totalImported += itemsChunk.length;
      }
    }

    return { importedItems: totalImported, importedCategories: 1 };
  }

  return {
    createSpace,
    updateSpace,
    listSpaces,
    querySpaces,
    deleteSpace,
    resetDatabase,
    createCategory,
    updateCategory,
    listCategories,
    queryCategories,
    deleteCategory,
    createItem,
    createItemBulk,
    updateItem,
    adjustItemQuantity,
    listItems,
    queryItems,
    getItemById,
    deleteItem,
    applyInventoryDelta,
    getInventoryQueueStatus,
    detectFileVersion,
    convert,
  };
}