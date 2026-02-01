import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connect, getDb, testConnection } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (origin.includes('.up.railway.app')) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

await connect();

// #PLACEHOLDER - Remove this endpoint when user starts to work on his project
app.get('/api/health', async (req, res) => {
  const db = getDb();
  const mongoEnvMissing = !process.env.MONGODB_URI;

  res.json({
    status: 'ok',
    message: 'Backend API is running',
    mongodb: db ? 'connected' : 'not connected',
    mongoEnvMissing
  });
});

// #PLACEHOLDER - Remove this endpoint when user starts to work on his project
app.get('/api/test-backend', async (req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend is live',
    timestamp: new Date().toISOString()
  });
});

// #PLACEHOLDER - Remove this endpoint when user starts to work on his project
app.get('/api/test-mongodb', async (req, res) => {
  const result = await testConnection();
  res.json({
    connected: result.connected,
    message: result.message,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0');
