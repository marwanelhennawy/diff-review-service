# SUBMISSION

## Architecture

The service is built as an Express-based HTTP API with four main components.

`diffParser.js` handles unified diff parsing, extracting only added lines from each file and splitting large diffs into chunks while preserving file boundaries.

The provider layer contains two implementations: `providers/mock.js` for deterministic rule-based reviews and `providers/llm.js` for real LLM-powered reviews. Both providers return findings using the same shared `Finding` structure so they can run through the same pipeline.

`jobStore.js` manages the asynchronous review lifecycle. It handles job creation, queue processing, bounded concurrency, content-based caching, idempotency handling, and event storage for SSE streaming.

`index.js` exposes the HTTP contract by handling authentication, request validation, rate limiting, error responses, and API routing.

The current implementation uses in-memory storage because the evaluation window is short-lived. For production usage, persistent storage would be the first improvement.

## Provider design

Both providers follow the same interface: they receive a parsed file containing its path and added lines, then return an array of structured findings.

The mock provider performs deterministic static checks using rule-based matching. It implements all required rules, including regex-based checks for security/style issues and a brace-depth scan for detecting multi-line empty catch blocks.

The LLM provider sends each file through a configurable AI model endpoint. The prompt explicitly instructs the model to treat diff contents as data only and never as instructions, preventing prompt injection from influencing the review process.

LLM responses are validated and converted into the same finding format used by the mock provider. Provider failures such as missing credentials, API failures, timeouts, or invalid model responses are converted into `ProviderError` instances. These are handled by the job runner and stored as failed jobs instead of crashing the service.

## How I verified the cross-cutting behaviors

* **Authentication:** Verified that all `/v1/*` endpoints require a valid bearer token and return `401 unauthorized` when missing or invalid. Public endpoints `/health` and `/spec` remain accessible without authentication.

* **Caching:** Submitted the same `{diff, options}` payload multiple times without an idempotency key. The second submission returned the cached result with `"cacheHit": true` and identical findings.

* **Idempotency:** Verified that submitting the same `Idempotency-Key` with the same request body returns the original job ID. Reusing the same key with a different body correctly returns `409 idempotency_conflict`.

* **Max findings:** Verified that `maxFindings` truncates returned findings while preserving ordering and that cached results still return the correct limited output.

* **SSE streaming:** Verified that active jobs stream status changes, findings, and completion events through `/stream`. Also verified that connecting to a completed job replays the stored event history.

* **Chunking:** Tested large diffs exceeding 64 KiB and confirmed that chunking happens only between files. Verified that findings remain complete, ordered, and deduplicated across chunks.

* **Rate limiting:** Tested bursts of POST submissions and confirmed that requests beyond the configured burst limit receive `429 rate_limited` responses with a `Retry-After` header. No server crashes or `5xx` responses occurred.

* **Prompt injection handling:** Submitted diff content containing prompt injection phrases such as "ignore previous instructions". The content was treated as normal code input and generated the expected security finding without affecting service behavior.

* **LLM failure handling:** Tested the LLM provider with invalid credentials and confirmed that jobs transition to `failed` status with a clear provider error message while the service remains available.

## Testing scripts

The repository includes PowerShell scripts used to manually verify:
- caching
- chunking
- concurrency
- rate limiting
- maxFindings validation

Before running them, set the BEARER_TOKEN environment variable.

## AI tools used

I used Claude (Anthropic) as a coding assistant during development. It was mainly used for generating initial implementation ideas, reviewing edge cases, improving error handling, and helping debug issues discovered during manual testing.

The final implementation decisions were reviewed manually and adjusted based on the requirements of the task.

## An AI suggestion I rejected

An AI suggestion was to introduce a database layer for storing jobs, findings, and cache entries permanently.

I decided not to implement this because the task evaluates a running service within a limited scoring window, and an in-memory design was sufficient for the required functionality. Instead, I focused on correctly implementing the required behaviors such as caching, idempotency, concurrency control, and SSE replay.

## What I would improve with more time

For a production deployment, I would replace in-memory storage with a persistent database or distributed cache so jobs survive restarts and multiple service instances can share state.

Other improvements would include:

* per-client rate limiting instead of a global limiter
* more comprehensive static analysis rules beyond the required mock rules
* improved observability with structured logging and metrics
* batching LLM requests where possible to reduce latency and API costs
* adding automated integration tests covering the complete API contract
