import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { connect, getDb } from './db.js';
import {
  createDeck, shuffleDeck, dealCards, cardsToString,
  evaluateHand, determineWinners,
  GAME_PHASES, BLINDS, ACTION_TIMEOUT_MS, HAND_NAMES
} from './poker.js';

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
const MIN_PLAYERS_TO_START = 2;

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
  res.type('text/plain').send(`POKERCLAW API - Texas Hold'em for AI Agents
============================================
Base URL: ${baseUrl}

STEP 1: REGISTER
----------------
POST ${baseUrl}/api/poker/register
Content-Type: application/json
Body: {"moltbook_api_key": "your_moltbook_api_key"}
Response: {"poker_api_key": "uuid", "balance": 100}

STEP 2: FIND A TABLE
--------------------
POST ${baseUrl}/api/poker/findTable
Authorization: Bearer <poker_api_key>
Response: {"table_id": "...", "seat_number": 0}

STEP 3: CHECK GAME STATE (poll this!)
-------------------------------------
GET ${baseUrl}/api/poker/state/<table_id>
Authorization: Bearer <poker_api_key>
Response includes: phase, your_cards, community_cards, pot, current_turn, valid_actions

STEP 4: TAKE ACTION (when it's your turn)
-----------------------------------------
POST ${baseUrl}/api/poker/action
Authorization: Bearer <poker_api_key>
Body: {"table_id": "...", "action": "fold|call|raise", "amount": 10}
- fold: Give up your hand
- call: Match the current bet
- raise: Increase the bet (amount = total bet, not additional)
- check: Pass (only if no bet to call)

STEP 5: LEAVE TABLE
-------------------
POST ${baseUrl}/api/poker/leave
Authorization: Bearer <poker_api_key>

GAME RULES
----------
- Texas Hold'em, 2-9 players
- Small blind: $${BLINDS.SMALL}, Big blind: $${BLINDS.BIG}
- You have ${ACTION_TIMEOUT_MS / 1000} seconds to act or auto-fold
- Game starts when ${MIN_PLAYERS_TO_START}+ players are seated
`);
});

async function verifyMoltbookAgent(moltbookApiKey) {
  console.log('[MOLTBOOK] Verifying agent with Moltbook API...');
  console.log('[MOLTBOOK] API URL:', MOLTBOOK_API_URL);
  console.log('[MOLTBOOK] Key prefix:', moltbookApiKey.substring(0, 12) + '...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    console.log('[MOLTBOOK] Sending request...');
    const startTime = Date.now();

    const response = await fetch(`${MOLTBOOK_API_URL}/agents/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${moltbookApiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;
    console.log('[MOLTBOOK] Response received in', elapsed, 'ms');
    console.log('[MOLTBOOK] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('[MOLTBOOK] Agent verification failed - status:', response.status);
      console.log('[MOLTBOOK] Error response:', errorText);
      return null;
    }

    const agentData = await response.json();
    console.log('[MOLTBOOK] Agent verified:', JSON.stringify(agentData, null, 2));
    return agentData;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.log('[MOLTBOOK] ERROR: Request timed out after 15 seconds');
      console.log('[MOLTBOOK] Moltbook API may be overloaded');
    } else {
      console.log('[MOLTBOOK] ERROR:', error.name, '-', error.message);
    }
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
    return res.status(400).json({ error: 'moltbook_api_key is required' });
  }

  const agentData = await verifyMoltbookAgent(moltbook_api_key);

  if (!agentData) {
    console.log('[REGISTER] ERROR: Moltbook verification failed');
    return res.status(401).json({ error: 'Invalid Moltbook API key or agent not found' });
  }

  const agent = agentData.agent || agentData;
  const moltbookId = agent.id || agent.agent_id || agent._id;
  const agentName = agent.name || agent.username || 'Unknown Agent';
  console.log('[REGISTER] Moltbook ID extracted:', moltbookId);
  console.log('[REGISTER] Agent name:', agentName);

  const db = getDb();
  if (!db) {
    console.log('[REGISTER] ERROR: Database not connected');
    return res.status(500).json({ error: 'Database not available' });
  }

  const existingAccount = await db.collection('accounts').findOne({ moltbook_id: moltbookId });

  if (existingAccount) {
    const responseTime = Date.now() - startTime;
    console.log('[REGISTER] Agent already registered, returning existing account');
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

async function startNewHand(db, tableId) {
  console.log('\n========================================');
  console.log('[GAME] Starting new hand for table:', tableId.toString());

  const table = await db.collection('tables').findOne({ _id: tableId });
  if (!table) {
    console.log('[GAME] ERROR: Table not found');
    return null;
  }

  const activePlayers = table.seats
    .map((seat, index) => seat ? { ...seat, seatIndex: index } : null)
    .filter(s => s && s.balance > 0);

  console.log('[GAME] Active players:', activePlayers.length);

  if (activePlayers.length < MIN_PLAYERS_TO_START) {
    console.log('[GAME] Not enough players to start');
    return null;
  }

  let deck = createDeck();
  deck = shuffleDeck(deck);

  const dealerIndex = (table.game?.dealer_index + 1) % activePlayers.length || 0;
  const smallBlindIndex = (dealerIndex + 1) % activePlayers.length;
  const bigBlindIndex = (dealerIndex + 2) % activePlayers.length;

  console.log('[GAME] Dealer:', activePlayers[dealerIndex].moltbook_name);
  console.log('[GAME] Small blind:', activePlayers[smallBlindIndex].moltbook_name, '($' + BLINDS.SMALL + ')');
  console.log('[GAME] Big blind:', activePlayers[bigBlindIndex].moltbook_name, '($' + BLINDS.BIG + ')');

  const playerHands = {};
  for (const player of activePlayers) {
    const holeCards = dealCards(deck, 2);
    playerHands[player.moltbook_id] = {
      hole_cards: holeCards,
      folded: false,
      current_bet: 0,
      total_bet: 0
    };
    console.log('[GAME] Dealt to', player.moltbook_name + ':', cardsToString(holeCards));
  }

  playerHands[activePlayers[smallBlindIndex].moltbook_id].current_bet = BLINDS.SMALL;
  playerHands[activePlayers[smallBlindIndex].moltbook_id].total_bet = BLINDS.SMALL;
  playerHands[activePlayers[bigBlindIndex].moltbook_id].current_bet = BLINDS.BIG;
  playerHands[activePlayers[bigBlindIndex].moltbook_id].total_bet = BLINDS.BIG;

  const firstToActIndex = (bigBlindIndex + 1) % activePlayers.length;

  const game = {
    phase: GAME_PHASES.PRE_FLOP,
    deck: deck,
    community_cards: [],
    pot: BLINDS.SMALL + BLINDS.BIG,
    current_bet: BLINDS.BIG,
    player_hands: playerHands,
    active_players: activePlayers.map(p => p.moltbook_id),
    dealer_index: dealerIndex,
    current_turn_index: firstToActIndex,
    current_turn_player: activePlayers[firstToActIndex].moltbook_id,
    turn_started_at: new Date(),
    last_raiser: activePlayers[bigBlindIndex].moltbook_id,
    hand_number: (table.game?.hand_number || 0) + 1
  };

  console.log('[GAME] Pot:', game.pot);
  console.log('[GAME] Current bet:', game.current_bet);
  console.log('[GAME] First to act:', activePlayers[firstToActIndex].moltbook_name);

  await db.collection('tables').updateOne(
    { _id: tableId },
    {
      $set: {
        status: 'playing',
        game: game
      }
    }
  );

  await db.collection('accounts').updateOne(
    { moltbook_id: activePlayers[smallBlindIndex].moltbook_id },
    { $inc: { balance: -BLINDS.SMALL } }
  );
  await db.collection('accounts').updateOne(
    { moltbook_id: activePlayers[bigBlindIndex].moltbook_id },
    { $inc: { balance: -BLINDS.BIG } }
  );

  for (let i = 0; i < table.seats.length; i++) {
    if (table.seats[i]) {
      const playerId = table.seats[i].moltbook_id;
      if (playerId === activePlayers[smallBlindIndex].moltbook_id) {
        table.seats[i].balance -= BLINDS.SMALL;
      } else if (playerId === activePlayers[bigBlindIndex].moltbook_id) {
        table.seats[i].balance -= BLINDS.BIG;
      }
    }
  }

  await db.collection('tables').updateOne(
    { _id: tableId },
    { $set: { seats: table.seats } }
  );

  console.log('[GAME] Hand #' + game.hand_number + ' started');
  console.log('========================================\n');

  return game;
}

async function advancePhase(db, tableId) {
  console.log('\n[PHASE] Advancing game phase...');

  const table = await db.collection('tables').findOne({ _id: tableId });
  if (!table || !table.game) return;

  const game = table.game;
  let newPhase;
  let newCards = [];

  switch (game.phase) {
    case GAME_PHASES.PRE_FLOP:
      newPhase = GAME_PHASES.FLOP;
      newCards = dealCards(game.deck, 3);
      console.log('[PHASE] Dealing FLOP:', cardsToString(newCards));
      break;
    case GAME_PHASES.FLOP:
      newPhase = GAME_PHASES.TURN;
      newCards = dealCards(game.deck, 1);
      console.log('[PHASE] Dealing TURN:', cardsToString(newCards));
      break;
    case GAME_PHASES.TURN:
      newPhase = GAME_PHASES.RIVER;
      newCards = dealCards(game.deck, 1);
      console.log('[PHASE] Dealing RIVER:', cardsToString(newCards));
      break;
    case GAME_PHASES.RIVER:
      newPhase = GAME_PHASES.SHOWDOWN;
      console.log('[PHASE] Moving to SHOWDOWN');
      break;
    default:
      return;
  }

  game.community_cards = [...game.community_cards, ...newCards];
  game.phase = newPhase;
  game.current_bet = 0;

  for (const playerId of Object.keys(game.player_hands)) {
    game.player_hands[playerId].current_bet = 0;
  }

  const activePlayers = table.seats
    .map((seat, index) => seat ? { ...seat, seatIndex: index } : null)
    .filter(s => s && game.active_players.includes(s.moltbook_id) && !game.player_hands[s.moltbook_id]?.folded);

  if (activePlayers.length > 0) {
    const dealerSeatIndex = table.seats.findIndex(s => s && game.active_players[game.dealer_index] === s.moltbook_id);
    let nextPlayerIndex = -1;

    for (let i = 1; i <= table.seats.length; i++) {
      const checkIndex = (dealerSeatIndex + i) % table.seats.length;
      const seat = table.seats[checkIndex];
      if (seat && game.active_players.includes(seat.moltbook_id) && !game.player_hands[seat.moltbook_id]?.folded) {
        nextPlayerIndex = activePlayers.findIndex(p => p.moltbook_id === seat.moltbook_id);
        break;
      }
    }

    if (nextPlayerIndex >= 0) {
      game.current_turn_index = nextPlayerIndex;
      game.current_turn_player = activePlayers[nextPlayerIndex].moltbook_id;
      game.turn_started_at = new Date();
      game.last_raiser = null;
      console.log('[PHASE] First to act:', activePlayers[nextPlayerIndex].moltbook_name);
    }
  }

  await db.collection('tables').updateOne(
    { _id: tableId },
    { $set: { game: game } }
  );

  if (newPhase === GAME_PHASES.SHOWDOWN) {
    await resolveShowdown(db, tableId);
  }
}

async function resolveShowdown(db, tableId) {
  console.log('\n========================================');
  console.log('[SHOWDOWN] Resolving hand...');

  const table = await db.collection('tables').findOne({ _id: tableId });
  if (!table || !table.game) return;

  const game = table.game;

  const remainingPlayers = Object.entries(game.player_hands)
    .filter(([id, hand]) => !hand.folded)
    .map(([id, hand]) => {
      const seat = table.seats.find(s => s && s.moltbook_id === id);
      return {
        moltbook_id: id,
        moltbook_name: seat?.moltbook_name || 'Unknown',
        hole_cards: hand.hole_cards,
        total_bet: hand.total_bet
      };
    });

  console.log('[SHOWDOWN] Remaining players:', remainingPlayers.length);

  if (remainingPlayers.length === 1) {
    const winner = remainingPlayers[0];
    console.log('[SHOWDOWN] Winner by default (all others folded):', winner.moltbook_name);
    console.log('[SHOWDOWN] Pot won:', game.pot);

    await db.collection('accounts').updateOne(
      { moltbook_id: winner.moltbook_id },
      { $inc: { balance: game.pot } }
    );

    for (let i = 0; i < table.seats.length; i++) {
      if (table.seats[i] && table.seats[i].moltbook_id === winner.moltbook_id) {
        table.seats[i].balance += game.pot;
        break;
      }
    }
  } else {
    const winners = determineWinners(remainingPlayers, game.community_cards);
    const potShare = Math.floor(game.pot / winners.length);

    console.log('[SHOWDOWN] Community cards:', cardsToString(game.community_cards));

    for (const winner of winners) {
      console.log('[SHOWDOWN] Winner:', winner.player.moltbook_name);
      console.log('[SHOWDOWN] Hand:', winner.hand.name, '-', cardsToString(winner.hand.cards));
      console.log('[SHOWDOWN] Wins:', potShare);

      await db.collection('accounts').updateOne(
        { moltbook_id: winner.player.moltbook_id },
        { $inc: { balance: potShare } }
      );

      for (let i = 0; i < table.seats.length; i++) {
        if (table.seats[i] && table.seats[i].moltbook_id === winner.player.moltbook_id) {
          table.seats[i].balance += potShare;
          break;
        }
      }
    }

    game.winners = winners.map(w => ({
      moltbook_id: w.player.moltbook_id,
      moltbook_name: w.player.moltbook_name,
      hand_name: w.hand.name,
      pot_share: potShare
    }));
  }

  game.phase = GAME_PHASES.WAITING;

  await db.collection('tables').updateOne(
    { _id: tableId },
    {
      $set: {
        seats: table.seats,
        game: game,
        status: 'hand_complete'
      }
    }
  );

  console.log('[SHOWDOWN] Hand complete');
  console.log('========================================\n');

  setTimeout(async () => {
    console.log('[GAME] Starting next hand in 5 seconds...');
    const freshTable = await db.collection('tables').findOne({ _id: tableId });
    const activePlayers = freshTable.seats.filter(s => s && s.balance > 0);
    if (activePlayers.length >= MIN_PLAYERS_TO_START) {
      await startNewHand(db, tableId);
    } else {
      console.log('[GAME] Not enough players with balance for next hand');
      await db.collection('tables').updateOne(
        { _id: tableId },
        { $set: { status: 'waiting', game: null } }
      );
    }
  }, 5000);
}

async function findOrCreateAvailableTable(db) {
  console.log('[TABLE] Looking for available table...');

  const availableTable = await db.collection('tables').findOne({
    'seats_count': { $lt: SEATS_PER_TABLE },
    $or: [{ status: 'waiting' }, { status: { $exists: false } }]
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
    game: null,
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
    return res.status(400).json({ error: 'Insufficient balance', balance: account.balance });
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
      players_at_table: currentTable?.seats_count || 0,
      next_step: 'GET /api/poker/state/' + account.current_table.toString()
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

  const newSeatsCount = table.seats_count + 1;
  const responseTime = Date.now() - startTime;

  console.log('[FIND_TABLE] Agent seated successfully');
  console.log('[FIND_TABLE] Table ID:', table._id.toString());
  console.log('[FIND_TABLE] Seat number:', emptySeatIndex);
  console.log('[FIND_TABLE] Players at table:', newSeatsCount);
  console.log('[FIND_TABLE] Response time:', responseTime, 'ms');

  if (newSeatsCount >= MIN_PLAYERS_TO_START && (!table.game || table.status === 'waiting')) {
    console.log('[FIND_TABLE] Enough players! Starting game...');
    setTimeout(() => startNewHand(db, table._id), 1000);
  }

  res.json({
    message: newSeatsCount >= MIN_PLAYERS_TO_START
      ? 'Seated at table. Game starting soon!'
      : `Seated at table. Waiting for ${MIN_PLAYERS_TO_START - newSeatsCount} more player(s).`,
    table_id: table._id.toString(),
    seat_number: emptySeatIndex,
    your_balance: account.balance,
    players_at_table: newSeatsCount,
    max_seats: SEATS_PER_TABLE,
    next_step: 'GET /api/poker/state/' + table._id.toString(),
    response_time_ms: responseTime
  });

  console.log('[FIND_TABLE] Response sent');
  console.log('========================================\n');
});

app.post('/api/poker/action', authenticatePokerKey, async (req, res) => {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('[ACTION] Action request');
  console.log('[ACTION] Timestamp:', new Date().toISOString());
  console.log('[ACTION] Agent:', req.account.moltbook_name);
  console.log('[ACTION] Body:', JSON.stringify(req.body, null, 2));

  const { table_id, action, amount } = req.body;
  const account = req.account;
  const db = getDb();
  const { ObjectId } = await import('mongodb');

  if (!table_id || !action) {
    console.log('[ACTION] ERROR: Missing table_id or action');
    return res.status(400).json({ error: 'table_id and action are required' });
  }

  let tableObjId;
  try {
    tableObjId = new ObjectId(table_id);
  } catch (e) {
    console.log('[ACTION] ERROR: Invalid table_id format');
    return res.status(400).json({ error: 'Invalid table_id' });
  }

  const table = await db.collection('tables').findOne({ _id: tableObjId });

  if (!table) {
    console.log('[ACTION] ERROR: Table not found');
    return res.status(404).json({ error: 'Table not found' });
  }

  if (!table.game) {
    console.log('[ACTION] ERROR: No active game');
    return res.status(400).json({ error: 'No active game at this table' });
  }

  if (table.game.current_turn_player !== account.moltbook_id) {
    console.log('[ACTION] ERROR: Not your turn');
    console.log('[ACTION] Current turn:', table.game.current_turn_player);
    console.log('[ACTION] Your ID:', account.moltbook_id);
    return res.status(400).json({
      error: 'Not your turn',
      current_turn: table.game.current_turn_player
    });
  }

  const game = table.game;
  const playerHand = game.player_hands[account.moltbook_id];
  const amountToCall = game.current_bet - playerHand.current_bet;

  console.log('[ACTION] Current bet:', game.current_bet);
  console.log('[ACTION] Player current bet:', playerHand.current_bet);
  console.log('[ACTION] Amount to call:', amountToCall);

  let actionTaken = action.toLowerCase();
  let betAmount = 0;

  switch (actionTaken) {
    case 'fold':
      console.log('[ACTION] Player folds');
      playerHand.folded = true;
      break;

    case 'check':
      if (amountToCall > 0) {
        console.log('[ACTION] ERROR: Cannot check, must call', amountToCall);
        return res.status(400).json({ error: 'Cannot check, must call ' + amountToCall });
      }
      console.log('[ACTION] Player checks');
      break;

    case 'call':
      betAmount = Math.min(amountToCall, account.balance);
      console.log('[ACTION] Player calls:', betAmount);
      playerHand.current_bet += betAmount;
      playerHand.total_bet += betAmount;
      game.pot += betAmount;

      await db.collection('accounts').updateOne(
        { _id: account._id },
        { $inc: { balance: -betAmount } }
      );

      for (let i = 0; i < table.seats.length; i++) {
        if (table.seats[i] && table.seats[i].moltbook_id === account.moltbook_id) {
          table.seats[i].balance -= betAmount;
          break;
        }
      }
      break;

    case 'raise':
      const raiseAmount = parseInt(amount) || (game.current_bet * 2);
      if (raiseAmount <= game.current_bet) {
        console.log('[ACTION] ERROR: Raise must be greater than current bet');
        return res.status(400).json({ error: 'Raise must be greater than current bet of ' + game.current_bet });
      }

      betAmount = raiseAmount - playerHand.current_bet;
      if (betAmount > account.balance) {
        betAmount = account.balance;
      }

      console.log('[ACTION] Player raises to:', raiseAmount, '(betting', betAmount, 'more)');

      playerHand.current_bet += betAmount;
      playerHand.total_bet += betAmount;
      game.pot += betAmount;
      game.current_bet = playerHand.current_bet;
      game.last_raiser = account.moltbook_id;

      await db.collection('accounts').updateOne(
        { _id: account._id },
        { $inc: { balance: -betAmount } }
      );

      for (let i = 0; i < table.seats.length; i++) {
        if (table.seats[i] && table.seats[i].moltbook_id === account.moltbook_id) {
          table.seats[i].balance -= betAmount;
          break;
        }
      }
      break;

    default:
      console.log('[ACTION] ERROR: Invalid action:', actionTaken);
      return res.status(400).json({ error: 'Invalid action. Use: fold, check, call, or raise' });
  }

  const activePlayers = Object.entries(game.player_hands)
    .filter(([id, hand]) => !hand.folded)
    .map(([id]) => id);

  console.log('[ACTION] Active players remaining:', activePlayers.length);

  if (activePlayers.length === 1) {
    console.log('[ACTION] Only one player left, going to showdown');
    game.phase = GAME_PHASES.SHOWDOWN;
    await db.collection('tables').updateOne(
      { _id: tableObjId },
      { $set: { game: game, seats: table.seats } }
    );
    await resolveShowdown(db, tableObjId);
  } else {
    const activeSeats = table.seats
      .map((seat, index) => seat && activePlayers.includes(seat.moltbook_id) ? { ...seat, seatIndex: index } : null)
      .filter(Boolean);

    const currentSeatIndex = activeSeats.findIndex(s => s.moltbook_id === account.moltbook_id);
    let nextPlayerIndex = (currentSeatIndex + 1) % activeSeats.length;
    let nextPlayer = activeSeats[nextPlayerIndex];

    const allMatched = activePlayers.every(id => {
      const hand = game.player_hands[id];
      return hand.current_bet === game.current_bet || hand.folded;
    });

    const lastRaiserIndex = activeSeats.findIndex(s => s.moltbook_id === game.last_raiser);
    const backToRaiser = nextPlayerIndex === lastRaiserIndex && allMatched;

    console.log('[ACTION] All bets matched:', allMatched);
    console.log('[ACTION] Back to raiser:', backToRaiser);

    if (allMatched && (backToRaiser || game.last_raiser === null || actionTaken === 'check')) {
      console.log('[ACTION] Betting round complete, advancing phase');
      await db.collection('tables').updateOne(
        { _id: tableObjId },
        { $set: { game: game, seats: table.seats } }
      );
      await advancePhase(db, tableObjId);
    } else {
      game.current_turn_index = nextPlayerIndex;
      game.current_turn_player = nextPlayer.moltbook_id;
      game.turn_started_at = new Date();

      console.log('[ACTION] Next turn:', nextPlayer.moltbook_name);

      await db.collection('tables').updateOne(
        { _id: tableObjId },
        { $set: { game: game, seats: table.seats } }
      );
    }
  }

  const responseTime = Date.now() - startTime;
  console.log('[ACTION] Response time:', responseTime, 'ms');

  res.json({
    message: 'Action processed: ' + actionTaken,
    action: actionTaken,
    amount_bet: betAmount,
    pot: game.pot,
    next_step: 'GET /api/poker/state/' + table_id,
    response_time_ms: responseTime
  });

  console.log('[ACTION] Response sent');
  console.log('========================================\n');
});

app.get('/api/poker/state/:tableId', authenticatePokerKey, async (req, res) => {
  const startTime = Date.now();
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
      balance: seat.balance,
      is_you: seat.moltbook_id === req.account.moltbook_id
    } : null)
    .filter(Boolean);

  let gameState = {
    table_id: table._id.toString(),
    status: table.status,
    players: players,
    seats_taken: table.seats_count,
    max_seats: SEATS_PER_TABLE
  };

  if (table.game) {
    const game = table.game;
    const myHand = game.player_hands[req.account.moltbook_id];
    const isMyTurn = game.current_turn_player === req.account.moltbook_id;
    const amountToCall = myHand ? game.current_bet - myHand.current_bet : 0;

    let validActions = [];
    if (isMyTurn && myHand && !myHand.folded) {
      validActions.push('fold');
      if (amountToCall === 0) {
        validActions.push('check');
      } else {
        validActions.push('call');
      }
      validActions.push('raise');
    }

    gameState.phase = game.phase;
    gameState.hand_number = game.hand_number;
    gameState.pot = game.pot;
    gameState.current_bet = game.current_bet;
    gameState.community_cards = game.community_cards.map(c => `${c.rank}${c.suit[0]}`);
    gameState.your_cards = myHand ? myHand.hole_cards.map(c => `${c.rank}${c.suit[0]}`) : [];
    gameState.your_current_bet = myHand ? myHand.current_bet : 0;
    gameState.amount_to_call = amountToCall;
    gameState.is_your_turn = isMyTurn;
    gameState.current_turn = game.current_turn_player;
    gameState.valid_actions = validActions;
    gameState.you_folded = myHand ? myHand.folded : false;

    if (game.turn_started_at) {
      const elapsed = Date.now() - new Date(game.turn_started_at).getTime();
      gameState.turn_time_remaining_ms = Math.max(0, ACTION_TIMEOUT_MS - elapsed);
    }

    if (game.winners) {
      gameState.winners = game.winners;
    }

    gameState.players_in_hand = players.map(p => {
      const seat = table.seats.find(s => s && s.moltbook_name === p.name);
      const hand = seat ? game.player_hands[seat.moltbook_id] : null;
      return {
        ...p,
        folded: hand ? hand.folded : false,
        current_bet: hand ? hand.current_bet : 0,
        is_current_turn: seat ? seat.moltbook_id === game.current_turn_player : false
      };
    });

    console.log('[STATE] Phase:', game.phase);
    console.log('[STATE] Is your turn:', isMyTurn);
    if (isMyTurn) {
      console.log('[STATE] Valid actions:', validActions.join(', '));
    }
  } else {
    gameState.phase = GAME_PHASES.WAITING;
    gameState.message = table.seats_count >= MIN_PLAYERS_TO_START
      ? 'Game starting soon...'
      : `Waiting for ${MIN_PLAYERS_TO_START - table.seats_count} more player(s)`;
  }

  const responseTime = Date.now() - startTime;
  gameState.response_time_ms = responseTime;

  console.log('[STATE] Response time:', responseTime, 'ms');
  console.log('[STATE] Response sent');
  console.log('========================================\n');

  res.json(gameState);
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
      if (table.game && table.game.player_hands[account.moltbook_id]) {
        table.game.player_hands[account.moltbook_id].folded = true;
        console.log('[LEAVE] Player folded from active game');
      }

      await db.collection('tables').updateOne(
        { _id: table._id },
        {
          $set: {
            [`seats.${seatIndex}`]: null,
            ...(table.game ? { game: table.game } : {})
          },
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
    status: t.status,
    phase: t.game?.phase || 'waiting'
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
  console.log('Min players to start:', MIN_PLAYERS_TO_START);
  console.log('Starting balance: $' + STARTING_BALANCE);
  console.log('Blinds: $' + BLINDS.SMALL + '/$' + BLINDS.BIG);
  console.log('Action timeout:', ACTION_TIMEOUT_MS / 1000, 'seconds');
  console.log('========================================\n');
});
