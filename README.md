# AI Diff Review Service

A small HTTP service that accepts a unified diff and returns structured code review findings.

The service supports two providers behind the same asynchronous job pipeline:

- `mock` — deterministic rule-based provider used for evaluation and testing.
- `llm` — real LLM-powered provider using the same finding output format.

The service includes async processing, caching, idempotency, SSE streaming, rate limiting, chunking, authentication, and graceful provider failure handling.

---

# Project Structure

```

DIFF-REVIEW-SERVICE

├── src
│   ├── providers
│   │   ├── llm.js
│   │   └── mock.js
│   │
│   ├── diffParser.js
│   ├── index.js
│   ├── jobStore.js
│   └── rateLimit.js
│
├── tests
│   ├── cache-test.ps1
│   ├── chunk-test.ps1
│   ├── concurrency-test.ps1
│   ├── maxfindings-negative-test.ps1
│   ├── maxfindings-test.ps1
│   ├── rate-header-test.ps1
│   ├── rate-test.ps1
│   ├── real-chunk-test.ps1
│   └── test-chunk.js
│
├── .env.example
├── package.json
├── package-lock.json
├── README.md
└── SUBMISSION.md

````

---

# Running Locally

Install dependencies:

```bash
npm install
````

Create a `.env` file:

```env
PORT=3000
BEARER_TOKEN=your-secret-token

LLM_API_KEY=
LLM_API_STYLE=openai
LLM_MODEL=
LLM_BASE_URL=
LLM_TIMEOUT_MS=20000
```

Start the service:

```bash
npm start
```

The service requires:

* Node.js 18+
* Global `fetch` support

---

# No Database

This service intentionally does not use a database.

All runtime state is stored in memory using JavaScript `Map` objects inside `jobStore.js`:

* jobs
* content-hash cache
* idempotency keys
* per-job SSE event logs

This is sufficient for the task because the evaluator communicates with one running instance during the scoring window.

The tradeoff is that restarting the process clears all jobs and cached results.

For a production deployment, the first improvement would be moving job storage and caching to a persistent store such as Redis or PostgreSQL.

---

# Environment Variables

| Variable         | Required | Default                         | Purpose                                              |
| ---------------- | -------- | ------------------------------- | ---------------------------------------------------- |
| `BEARER_TOKEN`   | Yes      | -                               | Authentication token required for all `/v1/*` routes |
| `PORT`           | No       | `3000`                          | HTTP server port                                     |
| `LLM_API_KEY`    | No*      | -                               | API key for the LLM provider                         |
| `LLM_API_STYLE`  | No       | `openai`                        | Provider format: `openai` or `anthropic`             |
| `LLM_BASE_URL`   | No       | Groq OpenAI-compatible endpoint | Custom LLM endpoint                                  |
| `LLM_MODEL`      | No       | `llama-3.3-70b-versatile`       | Model used by the LLM provider                       |
| `LLM_TIMEOUT_MS` | No       | `20000`                         | Maximum LLM request duration                         |

* `LLM_API_KEY` is only required when using:

```json
{
  "provider": "llm"
}
```

Without an API key, the job fails gracefully:

```json
{
  "status": "failed",
  "error": "LLM provider is not configured..."
}
```

The process continues running normally.

---

# LLM Provider Setup

The default LLM implementation uses the OpenAI-compatible chat completion format.

Supported providers include:

## Groq (Recommended)

Fast and simple setup.

Set:

```env
LLM_API_STYLE=openai
LLM_API_KEY=<your-key>
LLM_BASE_URL=https://api.groq.com/openai/v1/chat/completions
LLM_MODEL=llama-3.3-70b-versatile
```

---

## OpenRouter

Supports many OpenAI-compatible models.

Example:

```env
LLM_BASE_URL=https://openrouter.ai/api/v1/chat/completions
LLM_MODEL=<model-id>
```

---

## Google Gemini OpenAI-Compatible Endpoint

Example:

```env
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
LLM_MODEL=gemini-2.5-flash
```

---

## Anthropic

To use Anthropic's Messages API:

```env
LLM_API_STYLE=anthropic
```

The provider automatically switches request format.

---

Before submitting, verify the LLM path:

1. Submit a diff using:

```json
{
  "options":{
    "provider":"llm"
  }
}
```

2. Poll the job.
3. Confirm the job reaches `done` and returns findings.

---

# Authentication

Every `/v1/*` route requires:

```
Authorization: Bearer <token>
```

Example:

```
Authorization: Bearer my-secret-token
```

Missing or incorrect tokens return:

```json
{
  "error":{
    "code":"unauthorized",
    "message":"Missing or invalid bearer token."
  }
}
```

The following routes are public:

```
GET /health
GET /spec
```

---

# Quick Smoke Test

Health check:

```bash
curl http://localhost:3000/health
```

Expected:

```json
{
  "status":"ok",
  "version":"1.0.0"
}
```

Service specification:

```bash
curl http://localhost:3000/spec
```

Create a review job:

```bash
curl -X POST http://localhost:3000/v1/reviews \
-H "Authorization: Bearer your-secret-token" \
-H "Content-Type: application/json" \
-d '{
"diff":"diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1 +1 @@
+eval(userInput);"
}'
```

Example response:

```json
{
  "jobId":"...",
  "status":"queued"
}
```

Retrieve the result:

```bash
curl http://localhost:3000/v1/reviews/<jobId> \
-H "Authorization: Bearer your-secret-token"
```

---

# Deployment

Any deployment method is supported.

## Option 1: Cloud Hosting

Example:

1. Push repository to GitHub.
2. Create a web service using Render, Railway, Fly.io, or similar.
3. Build command:

```bash
npm install
```

4. Start command:

```bash
npm start
```

5. Configure:

```
BEARER_TOKEN
LLM_API_KEY (optional)
```

6. Use the generated public URL as the service base URL.

---

## Option 2: Local Tunnel

Run:

```bash
npm start
```

Expose port 3000:

```bash
ngrok http 3000
```

or:

```bash
cloudflared tunnel --url http://localhost:3000
```

Keep both the service and tunnel running during the evaluation window.

---

# Architecture

## `src/diffParser.js`

Responsible for:

* parsing unified diffs
* extracting added lines only
* tracking new-file line numbers
* splitting large diffs into chunks ≤64 KiB on file boundaries

---

## `src/providers/mock.js`

Implements deterministic review rules:

* MOCK-001 eval usage
* MOCK-002 hardcoded credentials
* MOCK-003 SQL string concatenation
* MOCK-004 empty catch blocks
* MOCK-005 loose null comparison
* MOCK-006 JSON deep cloning
* MOCK-007 console.log detection
* MOCK-008 TODO/FIXME markers
* MOCK-INJ prompt injection detection

Returns findings using the shared finding format.

---

## `src/providers/llm.js`

Provides real LLM-based review.

Features:

* OpenAI-compatible API support
* Anthropic API support
* JSON-only structured output
* timeout handling
* API failure handling
* invalid response handling

All failures throw `ProviderError`, allowing the job pipeline to mark the job as:

```json
{
  "status":"failed"
}
```

without crashing the server.

---

## `src/jobStore.js`

Core asynchronous processing pipeline.

Handles:

* job lifecycle management
* content hash caching
* idempotency keys
* bounded worker queue
* maximum 4 concurrent jobs
* SSE event history
* result ordering and deduplication

---

## `src/rateLimit.js`

Implements token bucket rate limiting:

* 30 requests/minute sustained rate
* burst capacity above the sustained rate
* applies only to:

```
POST /v1/reviews
```

GET requests are not rate limited.

---

## `src/index.js`

Express API layer.

Handles:

* authentication middleware
* request validation
* error envelopes
* POST review submission
* job retrieval
* SSE streaming
* health/spec endpoints

---

# Testing

The repository includes PowerShell test scripts covering:

* caching
* chunking
* concurrency
* maxFindings validation
* rate limiting
* rate limit headers

Additional manual testing was performed for:

* SSE streaming and replay
* idempotency
* LLM failure handling
* authentication
* invalid payload handling

---

# Future Improvements

Possible improvements for a production version:

* Replace in-memory storage with Redis/PostgreSQL.
* Add persistent job recovery after restart.
* Add per-user rate limiting instead of global limiting.
* Expand heuristic rules with a larger real-world diff dataset.
* Batch LLM requests across multiple files to reduce latency and cost.
* Add automated integration tests in CI.

```

This version is safer to submit because it now matches your actual implementation instead of the original template assumptions.
```
