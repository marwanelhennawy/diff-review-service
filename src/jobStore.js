import crypto from 'crypto';
import { EventEmitter } from 'events';
import { parseUnifiedDiff, chunkFiles } from './diffParser.js';
import { reviewFileMock } from './providers/mock.js';
import { reviewFileLlm, ProviderError } from './providers/llm.js';

const MAX_CONCURRENT_JOBS = 4;

export function contentHash(diff, options) {
  const norm = JSON.stringify({ diff, options });
  return crypto.createHash('sha256').update(norm).digest('hex');
}

class JobStore {
  constructor() {
    this.jobs = new Map(); // jobId -> job
    this.idempotencyKeys = new Map(); // key -> { bodyHash, jobId }
    this.contentCache = new Map(); // contentHash -> { findings, usage }
    this.emitters = new Map(); // jobId -> EventEmitter
    this.queue = [];
    this.running = 0;
  }

  createJob({ diff, options, idempotencyKey }) {
    const hash = contentHash(diff, options);
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify({ diff, idempotencyBody: true, options })).digest('hex');

    if (idempotencyKey) {
      const existing = this.idempotencyKeys.get(idempotencyKey);
      if (existing) {
        if (existing.bodyHash === bodyHash) {
          return { job: this.jobs.get(existing.jobId), conflict: false };
        }
        return { job: null, conflict: true };
      }
    }

    const cached = this.contentCache.get(hash);
    const jobId = crypto.randomUUID();
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    this.emitters.set(jobId, emitter);

    const job = {
      jobId,
      status: 'queued',
      diff,
      options,
      findings: [],
      usage: { inputBytes: Buffer.byteLength(diff, 'utf8'), chunks: 0, cacheHit: false },
      events: [],
      error: null,
      contentHash: hash
    };
    this.jobs.set(jobId, job);
    if (idempotencyKey) {
      this.idempotencyKeys.set(idempotencyKey, { bodyHash, jobId });
    }

    if (cached) {
      job.usage = { ...cached.usage, cacheHit: true };

      const maxFindings = Number.isInteger(job.options.maxFindings)
      ? Math.min(job.options.maxFindings, 1000)
      : 100;

      
      job.findings = cached.findings.slice(0, maxFindings);
      job.status = 'done';
      this._recordEvent(job, 'status', { status: 'done' });
      this._recordEvent(job, 'done', {
        total: cached.findings.length,
        usage: job.usage
      });
      return { job, conflict: false };
    }

    this.queue.push(jobId);
    this._pump();
    return { job, conflict: false };
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  getEmitter(jobId) {
    return this.emitters.get(jobId) || null;
  }

  _recordEvent(job, event, data) {
    job.events.push({ event, data });
    const emitter = this.emitters.get(job.jobId);
    if (emitter) emitter.emit('event', { event, data });
  }

  _pump() {
    while (this.running < MAX_CONCURRENT_JOBS && this.queue.length > 0) {
      const jobId = this.queue.shift();
      const job = this.jobs.get(jobId);
      if (!job || job.status !== 'queued') continue;
      this.running++;
      this._process(job).finally(() => {
        this.running--;
        this._pump();
      });
    }
  }

  async _process(job) {
    job.status = 'running';
    this._recordEvent(job, 'status', { status: 'running' });

    try {
      const parsed = parseUnifiedDiff(job.diff);
      if (!parsed) throw new ProviderError('diff did not parse into any files');

      const chunks = chunkFiles(parsed.files);
      job.usage.chunks = chunks.length;

      const provider = job.options.provider === 'llm' ? 'llm' : 'mock';
      const allFindings = [];

      for (const chunk of chunks) {
        for (const file of chunk) {
          let fileFindings;
          if (provider === 'mock') {
            fileFindings = reviewFileMock(file);
          } else {
            fileFindings = await reviewFileLlm(file);
          }
          for (const f of fileFindings) {
            allFindings.push(f);
          }
        }
      }

      // Dedupe by id, then sort by path, line, ruleId.
      const seen = new Map();
      for (const f of allFindings) {
        if (!seen.has(f.id)) seen.set(f.id, f);
      }
      const ordered = [...seen.values()].sort((a, b) => {
        if (a.path !== b.path) return a.path < b.path ? -1 : 1;
        if (a.line !== b.line) return a.line - b.line;
        if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
        return 0;
      });

      const fullCount = ordered.length;
      const maxFindings = Number.isInteger(job.options.maxFindings) ? job.options.maxFindings : 100;
      const truncated = ordered.slice(0, maxFindings);

      job.findings = truncated;
      job.status = 'done';
      job.usage.cacheHit = false;

      this.contentCache.set(job.contentHash, {
      findings: ordered,
      usage: { 
        inputBytes: job.usage.inputBytes,
        chunks: job.usage.chunks,
        cacheHit: false
      }
    });

      for (const f of truncated) {
        this._recordEvent(job, 'finding', f);
      }
      this._recordEvent(job, 'status', { status: 'done' });
      this._recordEvent(job, 'done', { total: fullCount, usage: job.usage });
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof ProviderError
      ? err.message
      : "Internal server error.";
      this._recordEvent(job, 'status', { status: 'failed' });
      this._recordEvent(job, 'done', { total: 0, usage: job.usage, error: job.error });
    }
  }
}

export const jobStore = new JobStore();
export { MAX_CONCURRENT_JOBS };
