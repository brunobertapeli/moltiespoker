import { MongoClient } from 'mongodb';

let db = null;
let client = null;

export async function connect() {
  const uri = process.env.MONGODB_URI;

  // Skip connection if no URI provided
  if (!uri) {
    return null;
  }

  try {
    const dbName = process.env.MONGODB_DB || 'pokerclaw';

    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 2000,
    });

    await client.connect();
    db = client.db(dbName);

    return db;
  } catch (error) {
    return null;
  }
}

export function getDb() {
  return db;
}

export async function close() {
  if (client) {
    await client.close();
  }
}

// #PLACEHOLDER - Remove this function when user starts to work on his project
export async function testConnection() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    return {
      connected: false,
      message: 'MongoDB URI not configured'
    };
  }

  try {
    if (db) {
      // Test the existing connection with a ping
      await db.command({ ping: 1 });
      return {
        connected: true,
        message: 'MongoDB connection is active'
      };
    } else {
      // Try to connect if not already connected
      const testClient = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
      });
      await testClient.connect();
      await testClient.db().command({ ping: 1 });
      await testClient.close();
      return {
        connected: true,
        message: 'MongoDB connection successful'
      };
    }
  } catch (error) {
    return {
      connected: false,
      message: `MongoDB connection failed: ${error.message}`
    };
  }
}
