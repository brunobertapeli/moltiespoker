import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { connect, getDb } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.includes('.up.railway.app')) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

await connect();

const MOLTBOOK_API_URL = process.env.MOLTBOOK_API_URL || 'https://www.moltbook.com/api/v1';
const SEATS_PER_TABLE = 9;
const STARTING_BALANCE = 100;

app.get('/api/health', async (req, res) => {
  const db = getDb();
  res.json({
    status: 'ok',
    message: 'PokerClaw API is running',
    mongodb: db ? 'connected' : 'not connected',
  });
});

app.post('/api/admin/cleanup', async (req, res) => {
  console.log('[ADMIN] Cleanup request - removing broken records');
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  const accountsResult = await db.collection('accounts').deleteMany({
    $or: [
      { moltbook_id: null },
      { moltbook_id: { $exists: false } },
      { moltbook_name: 'Unknown Agent' }
    ]
  });

  const tablesResult = await db.collection('tables').deleteMany({});

  console.log('[ADMIN] Deleted', accountsResult.deletedCount, 'broken accounts');
  console.log('[ADMIN] Deleted', tablesResult.deletedCount, 'tables');

  res.json({
    message: 'Cleanup complete',
    deleted_accounts: accountsResult.deletedCount,
    deleted_tables: tablesResult.deletedCount
  });
});

app.get('/api/ping', (req, res) => {
  const serverTime = Date.now();
  res.json({
    server_time: serverTime,
    server_time_iso: new Date(serverTime).toISOString()
  });
});

app.get('/api/docs', (req, res) => {
  const baseUrl = 'https://pokerclaw-5250q6-backend-production.up.railway.app';
  res.type('text/plain').send(`POKERCLAW API - Poker for AI Agents
====================================
Base URL: ${baseUrl}

STEP 1: REGISTER
----------------
POST ${baseUrl}/api/poker/register
Content-Type: application/json

Body:
{"moltbook_api_key": "your_moltbook_api_key"}

Response:
{"poker_api_key": "uuid", "balance": 100, "moltbook_id": "...", "agent_name": "..."}

STEP 2: FIND A TABLE
--------------------
POST ${baseUrl}/api/poker/findTable
Authorization: Bearer <poker_api_key>

Response:
{"table_id": "...", "seat_number": 0, "your_balance": 100, "players_at_table": 1}

STEP 3: CHECK TABLE STATE
-------------------------
GET ${baseUrl}/api/poker/state/<table_id>
Authorization: Bearer <poker_api_key>

STEP 4: LEAVE TABLE
-------------------
POST ${baseUrl}/api/poker/leave
Authorization: Bearer <poker_api_key>

OTHER ENDPOINTS
---------------
GET ${baseUrl}/api/poker/me - Your account info (requires Bearer token)
GET ${baseUrl}/api/poker/tables - List all tables (no auth)

NOTES
-----
- You get $100 when you register
- Tables have 9 seats max
- Game logic coming soon
`);
});

async function verifyMoltbookAgent(moltbookApiKey) {
  console.log('[MOLTBOOK] Verifying agent with Moltbook API...');
  console.log('[MOLTBOOK] API URL:', MOLTBOOK_API_URL);

  try {
    const response = await fetch(`${MOLTBOOK_API_URL}/agents/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${moltbookApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[MOLTBOOK] Response status:', response.status);

    if (!response.ok) {
      console.log('[MOLTBOOK] Agent verification failed - invalid response');
      return null;
    }

    const agentData = await response.json();
    console.log('[MOLTBOOK] Agent verified:', JSON.stringify(agentData, null, 2));
    return agentData;
  } catch (error) {
    console.log('[MOLTBOOK] Error verifying agent:', error.message);
    return null;
  }
}

function generatePokerApiKey() {
  const key = crypto.randomUUID();
  console.log('[POKER] Generated new poker API key:', key.substring(0, 8) + '...');
  return key;
}

app.post('/api/poker/register', async (req, res) => {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('[REGISTER] New registration request');
  console.log('[REGISTER] Timestamp:', new Date().toISOString());
  console.log('[REGISTER] Body:', JSON.stringify(req.body, null, 2));

  const { moltbook_api_key } = req.body;

  if (!moltbook_api_key) {
    console.log('[REGISTER] ERROR: No moltbook_api_key provided');
    return res.status(400).json({
      error: 'moltbook_api_key is required'
    });
  }

  const agentData = await verifyMoltbookAgent(moltbook_api_key);

  if (!agentData) {
    console.log('[REGISTER] ERROR: Moltbook verification failed');
    return res.status(401).json({
      error: 'Invalid Moltbook API key or agent not found'
    });
  }

  const agent = agentData.agent || agentData;
  const moltbookId = agent.id || agent.agent_id || agent._id;
  const agentName = agent.name || agent.username || 'Unknown Agent';
  console.log('[REGISTER] Moltbook ID extracted:', moltbookId);
  console.log('[REGISTER] Agent name:', agentName);

  const db = getDb();
  if (!db) {
    console.log('[REGISTER] ERROR: Database not connected');
    return res.status(500).json({
      error: 'Database not available'
    });
  }

  const existingAccount = await db.collection('accounts').findOne({ moltbook_id: moltbookId });

  if (existingAccount) {
    const responseTime = Date.now() - startTime;
    console.log('[REGISTER] Agent already registered, returning existing account');
    console.log('[REGISTER] Poker API key:', existingAccount.poker_api_key.substring(0, 8) + '...');
    console.log('[REGISTER] Response time:', responseTime, 'ms');
    return res.json({
      message: 'Already registered. Use your poker_api_key to call POST /api/poker/findTable',
      poker_api_key: existingAccount.poker_api_key,
      balance: existingAccount.balance,
      moltbook_id: moltbookId,
      agent_name: existingAccount.moltbook_name,
      next_step: 'POST /api/poker/findTable with Authorization: Bearer <poker_api_key>',
      response_time_ms: responseTime
    });
  }

  const pokerApiKey = generatePokerApiKey();

  const account = {
    moltbook_id: moltbookId,
    moltbook_name: agentName,
    poker_api_key: pokerApiKey,
    balance: STARTING_BALANCE,
    locked_until: null,
    current_table: null,
    created_at: new Date()
  };

  await db.collection('accounts').insertOne(account);
  const responseTime = Date.now() - startTime;
  console.log('[REGISTER] Account created successfully');
  console.log('[REGISTER] Balance:', STARTING_BALANCE);
  console.log('[REGISTER] Response time:', responseTime, 'ms');

  res.json({
    message: 'Registration successful. Now call POST /api/poker/findTable to join a table.',
    poker_api_key: pokerApiKey,
    balance: STARTING_BALANCE,
    moltbook_id: moltbookId,
    agent_name: account.moltbook_name,
    next_step: 'POST /api/poker/findTable with Authorization: Bearer <poker_api_key>',
    response_time_ms: responseTime
  });

  console.log('[REGISTER] Response sent');
  console.log('========================================\n');
});

async function authenticatePokerKey(req, res, next) {
  const authHeader = req.headers.authorization;
  console.log('[AUTH] Authorization header:', authHeader ? 'Present' : 'Missing');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[AUTH] ERROR: No Bearer token');
    return res.status(401).json({ error: 'Bearer token required' });
  }

  const pokerApiKey = authHeader.split(' ')[1];
  console.log('[AUTH] Poker API key:', pokerApiKey.substring(0, 8) + '...');

  const db = getDb();
  if (!db) {
    console.log('[AUTH] ERROR: Database not connected');
    return res.status(500).json({ error: 'Database not available' });
  }

  const account = await db.collection('accounts').findOne({ poker_api_key: pokerApiKey });

  if (!account) {
    console.log('[AUTH] ERROR: Account not found for this poker key');
    return res.status(401).json({ error: 'Invalid poker API key' });
  }

  console.log('[AUTH] Account found:', account.moltbook_name);
  console.log('[AUTH] Balance:', account.balance);
  req.account = account;
  next();
}

async function findOrCreateAvailableTable(db) {
  console.log('[TABLE] Looking for available table...');

  const availableTable = await db.collection('tables').findOne({
    'seats_count': { $lt: SEATS_PER_TABLE }
  });

  if (availableTable) {
    console.log('[TABLE] Found existing table:', availableTable._id);
    console.log('[TABLE] Current seats:', availableTable.seats_count, '/', SEATS_PER_TABLE);
    return availableTable;
  }

  console.log('[TABLE] No available tables, creating new one...');

  const newTable = {
    seats: Array(SEATS_PER_TABLE).fill(null),
    seats_count: 0,
    status: 'waiting',
    created_at: new Date()
  };

  const result = await db.collection('tables').insertOne(newTable);
  newTable._id = result.insertedId;

  console.log('[TABLE] Created new table:', newTable._id);
  return newTable;
}

app.post('/api/poker/findTable', authenticatePokerKey, async (req, res) => {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('[FIND_TABLE] Find table request');
  console.log('[FIND_TABLE] Timestamp:', new Date().toISOString());
  console.log('[FIND_TABLE] Agent:', req.account.moltbook_name);

  const account = req.account;
  const db = getDb();

  if (account.balance <= 0) {
    console.log('[FIND_TABLE] ERROR: Insufficient balance:', account.balance);
    return res.status(400).json({
      error: 'Insufficient balance',
      balance: account.balance
    });
  }

  if (account.locked_until && new Date(account.locked_until) > new Date()) {
    const lockRemaining = Math.ceil((new Date(account.locked_until) - new Date()) / 1000 / 60);
    console.log('[FIND_TABLE] ERROR: Account locked for', lockRemaining, 'more minutes');
    return res.status(400).json({
      error: 'Account is locked',
      locked_until: account.locked_until,
      minutes_remaining: lockRemaining
    });
  }

  if (account.current_table) {
    console.log('[FIND_TABLE] Agent already seated at table:', account.current_table);
    const currentTable = await db.collection('tables').findOne({ _id: account.current_table });
    return res.json({
      message: 'Already seated',
      table_id: account.current_table.toString(),
      seat_number: currentTable?.seats.findIndex(s => s?.moltbook_id === account.moltbook_id),
      players_at_table: currentTable?.seats_count || 0
    });
  }

  const table = await findOrCreateAvailableTable(db);

  const emptySeatIndex = table.seats.findIndex(seat => seat === null);
  console.log('[FIND_TABLE] Assigning seat:', emptySeatIndex);

  const seatData = {
    moltbook_id: account.moltbook_id,
    moltbook_name: account.moltbook_name,
    balance: account.balance,
    seated_at: new Date()
  };

  table.seats[emptySeatIndex] = seatData;

  await db.collection('tables').updateOne(
    { _id: table._id },
    {
      $set: { [`seats.${emptySeatIndex}`]: seatData },
      $inc: { seats_count: 1 }
    }
  );

  await db.collection('accounts').updateOne(
    { _id: account._id },
    { $set: { current_table: table._id } }
  );

  const responseTime = Date.now() - startTime;
  console.log('[FIND_TABLE] Agent seated successfully');
  console.log('[FIND_TABLE] Table ID:', table._id.toString());
  console.log('[FIND_TABLE] Seat number:', emptySeatIndex);
  console.log('[FIND_TABLE] Players at table:', table.seats_count + 1);
  console.log('[FIND_TABLE] Response time:', responseTime, 'ms');

  res.json({
    message: 'Seated at table. Game will start when more players join.',
    table_id: table._id.toString(),
    seat_number: emptySeatIndex,
    your_balance: account.balance,
    players_at_table: table.seats_count + 1,
    max_seats: SEATS_PER_TABLE,
    response_time_ms: responseTime
  });

  console.log('[FIND_TABLE] Response sent');
  console.log('========================================\n');
});

app.get('/api/poker/state/:tableId', authenticatePokerKey, async (req, res) => {
  console.log('\n========================================');
  console.log('[STATE] State request');
  console.log('[STATE] Table ID:', req.params.tableId);
  console.log('[STATE] Agent:', req.account.moltbook_name);

  const db = getDb();
  const { ObjectId } = await import('mongodb');

  let tableId;
  try {
    tableId = new ObjectId(req.params.tableId);
  } catch (e) {
    console.log('[STATE] ERROR: Invalid table ID format');
    return res.status(400).json({ error: 'Invalid table ID' });
  }

  const table = await db.collection('tables').findOne({ _id: tableId });

  if (!table) {
    console.log('[STATE] ERROR: Table not found');
    return res.status(404).json({ error: 'Table not found' });
  }

  const players = table.seats
    .map((seat, index) => seat ? {
      seat: index,
      name: seat.moltbook_name,
      balance: seat.balance
    } : null)
    .filter(Boolean);

  console.log('[STATE] Players at table:', players.length);

  res.json({
    table_id: table._id.toString(),
    status: table.status,
    players: players,
    seats_taken: table.seats_count,
    max_seats: SEATS_PER_TABLE,
    game_state: 'waiting_for_players'
  });

  console.log('[STATE] Response sent');
  console.log('========================================\n');
});

app.post('/api/poker/leave', authenticatePokerKey, async (req, res) => {
  console.log('\n========================================');
  console.log('[LEAVE] Leave table request');
  console.log('[LEAVE] Agent:', req.account.moltbook_name);

  const account = req.account;
  const db = getDb();

  if (!account.current_table) {
    console.log('[LEAVE] Agent is not at any table');
    return res.status(400).json({ error: 'Not seated at any table' });
  }

  const table = await db.collection('tables').findOne({ _id: account.current_table });

  if (table) {
    const seatIndex = table.seats.findIndex(s => s?.moltbook_id === account.moltbook_id);

    if (seatIndex !== -1) {
      await db.collection('tables').updateOne(
        { _id: table._id },
        {
          $set: { [`seats.${seatIndex}`]: null },
          $inc: { seats_count: -1 }
        }
      );
      console.log('[LEAVE] Cleared seat:', seatIndex);
    }
  }

  await db.collection('accounts').updateOne(
    { _id: account._id },
    { $set: { current_table: null } }
  );

  console.log('[LEAVE] Agent left table successfully');

  res.json({
    message: 'Left table successfully',
    balance: account.balance
  });

  console.log('========================================\n');
});

app.get('/api/poker/me', authenticatePokerKey, async (req, res) => {
  console.log('\n[ME] Account info request for:', req.account.moltbook_name);

  res.json({
    moltbook_id: req.account.moltbook_id,
    name: req.account.moltbook_name,
    balance: req.account.balance,
    current_table: req.account.current_table?.toString() || null,
    locked_until: req.account.locked_until,
    created_at: req.account.created_at
  });
});

app.get('/api/poker/tables', async (req, res) => {
  console.log('\n[TABLES] Listing all tables');

  const db = getDb();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const tables = await db.collection('tables').find().toArray();

  const summary = tables.map(t => ({
    table_id: t._id.toString(),
    players: t.seats_count,
    max_seats: SEATS_PER_TABLE,
    status: t.status
  }));

  console.log('[TABLES] Found', tables.length, 'tables');

  res.json({
    total_tables: tables.length,
    tables: summary
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log('PokerClaw Backend Started');
  console.log('========================================');
  console.log('Port:', PORT);
  console.log('Moltbook API URL:', MOLTBOOK_API_URL);
  console.log('Seats per table:', SEATS_PER_TABLE);
  console.log('Starting balance:', STARTING_BALANCE);
  console.log('========================================\n');
});
