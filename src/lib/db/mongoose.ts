import mongoose from "mongoose";

/**
 * Cached Mongoose connection.
 *
 * Next.js route handlers on Vercel run in a serverless environment where the
 * module scope survives between invocations of a warm instance but the process
 * can be recycled at any time. Opening a new connection per request would
 * exhaust the Atlas connection pool almost immediately, so the promise is
 * cached on globalThis and reused.
 */

const MONGODB_URI = process.env.MONGODB_URI?.trim() ?? "";
const MONGODB_DB = process.env.MONGODB_DB?.trim() || "smart_traffic";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  failed: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __stmsMongoose: MongooseCache | undefined;
}

const cache: MongooseCache =
  global.__stmsMongoose ?? (global.__stmsMongoose = { conn: null, promise: null, failed: false });

/** True when a MongoDB connection string has been configured. */
export function isDatabaseConfigured(): boolean {
  return MONGODB_URI.length > 0;
}

/**
 * Connects to MongoDB, returning null when no URI is configured or when the
 * connection cannot be established. Callers fall back to the in-memory store,
 * which keeps the whole application usable during a demo with no database.
 */
export async function connectToDatabase(): Promise<typeof mongoose | null> {
  if (!isDatabaseConfigured()) return null;
  if (cache.conn) return cache.conn;
  if (cache.failed) return null;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        dbName: MONGODB_DB,
        bufferCommands: false,
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: 10,
      })
      .catch((error) => {
        cache.failed = true;
        cache.promise = null;
        console.error("[STMS] MongoDB connection failed, using in-memory store:", error.message);
        throw error;
      });
  }

  try {
    cache.conn = await cache.promise;
    return cache.conn;
  } catch {
    return null;
  }
}
