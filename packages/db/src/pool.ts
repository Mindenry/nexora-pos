import pg from 'pg';

const { Pool, types } = pg;

// BIGINT (int8) -> number: safe for this domain (money < 2^53 satang, counts).
// DATE (1082) stays a calendar string (YYYY-MM-DD); never a timestamp with a
// server-timezone shift. Numeric is intentionally left as string; quantities are
// integers.
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1082, (value) => value);

export type DbClient = pg.PoolClient;

export interface DbOptions {
  max?: number;
  applicationName?: string;
  ssl?: boolean;
}

export interface Db {
  pool: pg.Pool;
  withTenant: <T>(tenantId: string, fn: (client: DbClient) => Promise<T>) => Promise<T>;
  withPlatformAdmin: <T>(fn: (client: DbClient) => Promise<T>) => Promise<T>;
  transaction: <T>(fn: (client: DbClient) => Promise<T>) => Promise<T>;
  queryGlobal: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
  close: () => Promise<void>;
}

export function createDb(connectionString: string, options: DbOptions = {}): Db {
  const pool = new Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    application_name: options.applicationName ?? 'nexora-api',
    ...(options.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  pool.on('error', (error) => {
    // Pool-level errors are infrastructure events; the request that lost its
    // client already failed with its own error envelope.
    console.error(JSON.stringify({ level: 'error', msg: 'pg_pool_error', error: error.message }));
  });

  async function runScoped<T>(
    settings: Array<[string, string]>,
    fn: (client: DbClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of settings) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection is already broken; release will discard it.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    pool,
    withTenant: (tenantId, fn) =>
      runScoped(
        [
          ['app.tenant_id', tenantId],
          ['app.platform_admin', 'off'],
        ],
        fn,
      ),
    withPlatformAdmin: (fn) => runScoped([['app.platform_admin', 'on']], fn),
    transaction: (fn) => runScoped([], fn),
    queryGlobal: (sql, params) => pool.query(sql, params),
    close: () => pool.end(),
  };
}

/** Typed single-row helper. Throws a plain Error when the row is missing. */
export async function one<T extends pg.QueryResultRow>(
  client: Pick<DbClient, 'query'>,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await client.query<T>(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error(`Expected one row for query: ${sql.slice(0, 120)}`);
  return row;
}

/** Typed optional row helper. */
export async function maybeOne<T extends pg.QueryResultRow>(
  client: Pick<DbClient, 'query'>,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await client.query<T>(sql, params);
  return result.rows[0] ?? null;
}

export function paginationMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
