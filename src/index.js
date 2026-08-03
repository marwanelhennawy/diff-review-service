import 'dotenv/config';
import express from 'express';
import { jobStore } from './jobStore.js';
import { tryConsume, RATE_LIMIT_PER_MINUTE } from './rateLimit.js';
import { parseUnifiedDiff } from './diffParser.js';

const PORT = process.env.PORT || 3000;
const BEARER_TOKEN = process.env.BEARER_TOKEN;
const VERSION = '1.0.0';
const MAX_PAYLOAD_BYTES = 1048576;
const CHUNK_BYTES = 65536;
const MAX_CONCURRENT_JOBS = 4;

if (!BEARER_TOKEN) {
  console.error('FATAL: BEARER_TOKEN env var is not set.');
  process.exit(1);
}

const startTime = Date.now();
const app = express();

app.use(express.json({
  limit: MAX_PAYLOAD_BYTES + 1024,
  verify: (req, _res, buf) => { req.rawBodyBytes = buf.length; }
}));

// JSON parse errors -> 400 invalid_json (handled below via error middleware).

function errorEnvelope(code, message) {
  return { error: { code, message } };
}

// --- Public routes ---

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000)
  });
});

app.get('/spec', (_req, res) => {
  res.status(200).json({
    specVersion: '1.0',
    providers: ['mock', 'llm'],
    limits: {
      maxPayloadBytes: MAX_PAYLOAD_BYTES,
      chunkBytes: CHUNK_BYTES,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
      rateLimitPerMinute: RATE_LIMIT_PER_MINUTE
    }
  });
});

// --- Auth for all /v1/* routes ---

app.use('/v1', (req, res, next) => {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match || match[1] !== BEARER_TOKEN) {
    return res.status(401).json(errorEnvelope('unauthorized', 'Missing or invalid bearer token.'));
  }
  next();
});

// --- POST /v1/reviews ---

app.post('/v1/reviews', (req, res) => {
  if (req.rawBodyBytes && req.rawBodyBytes > MAX_PAYLOAD_BYTES) {
    return res.status(413).json(errorEnvelope('payload_too_large', 'Request body exceeds 1 MiB.'));
  }

  const limited = tryConsume();
  if (!limited.allowed) {
    res.set('Retry-After', String(limited.retryAfterSec));
    return res.status(429).json(errorEnvelope('rate_limited', 'Too many submissions; slow down.'));
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json(errorEnvelope('invalid_json', 'Request body must be a JSON object.'));
  }

  const diff = body.diff;
  if (typeof diff !== 'string' || diff.trim() === '') {
    return res.status(422).json(errorEnvelope('invalid_diff', 'Field "diff" is required and must be a non-empty string.'));
  }
if (Buffer.byteLength(diff, "utf8") > MAX_PAYLOAD_BYTES) {
  return res.status(413).json(
    errorEnvelope(
      "payload_too_large",
      "Request body exceeds 1 MiB."
    )
  );
}

const parsed = parseUnifiedDiff(diff);

if (!parsed) {
    return res.status(422).json(errorEnvelope('invalid_diff', 'Field "diff" could not be parsed as a unified diff.'));
  }

const rawOptions =
  (body.options && typeof body.options === 'object')
    ? body.options
    : {};

if (
  rawOptions.maxFindings !== undefined &&
  (
    !Number.isInteger(rawOptions.maxFindings) ||
    rawOptions.maxFindings < 0
  )
) {
  return res.status(400).json(
    errorEnvelope(
      'invalid_json',
      'maxFindings must be a non-negative integer.'
    )
  );
}

const provider = rawOptions.provider === 'llm'
  ? 'llm'
  : 'mock';

const maxFindings =
  rawOptions.maxFindings === undefined
    ? 100
    : Math.min(rawOptions.maxFindings, 1000);

const options = {
  provider,
  maxFindings
};

  const idempotencyKey = req.headers['idempotency-key'] || null;
  const { job, conflict } = jobStore.createJob({ diff, options, idempotencyKey });

  if (conflict) {
    return res.status(409).json(errorEnvelope('idempotency_conflict', 'Idempotency-Key was reused with a different request body.'));
  }

  return res.status(202).json({
  jobId: job.jobId,
  status: 'queued'
});
});

// --- GET /v1/reviews/:jobId ---

app.get('/v1/reviews/:jobId', (req, res) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json(errorEnvelope('not_found', 'No job with that id.'));
  }
  const payload = {
    jobId: job.jobId,
    status: job.status,
    usage: job.usage
  };
  if (job.status === 'done') payload.findings = job.findings;
  if (job.status === 'failed') payload.error = job.error;
  return res.status(200).json(payload);
});

// --- GET /v1/reviews/:jobId/stream (SSE) ---

app.get('/v1/reviews/:jobId/stream', (req, res) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json(errorEnvelope('not_found', 'No job with that id.'));
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Replay everything recorded so far, in order.
  for (const { event, data } of job.events) {
    send(event, data);
  }

  const isTerminal = job.status === 'done' || job.status === 'failed';
  if (isTerminal) {
    return res.end();
  }

  const emitter = jobStore.getEmitter(job.jobId);
  const listener = ({ event, data }) => {
    send(event, data);
    if (event === 'done') {
      cleanup();
      res.end();
    }
  };
  const cleanup = () => {
    if (emitter) emitter.off('event', listener);
  };
  if (emitter) emitter.on('event', listener);
  req.on('close', cleanup);
});

// --- Error handling (invalid JSON bodies land here via body-parser) ---

app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json(errorEnvelope('payload_too_large', 'Request body exceeds 1 MiB.'));
  }
  if (err) {
    return res.status(400).json(errorEnvelope('invalid_json', 'Request body is not valid JSON.'));
  }
  return res.status(500).json(errorEnvelope('internal', 'Unexpected error.'));
});

// Catch-all for unmatched routes.
app.use((_req, res) => {
  res.status(404).json(errorEnvelope('not_found', 'No such route.'));
});

app.listen(PORT, () => {
  console.log(`AI diff review service listening on :${PORT}`);
});
