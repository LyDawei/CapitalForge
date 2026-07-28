import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { outputContractFor, hasContract } from '../schemas/agent-outputs';
import { previewPromptVersion } from './_promptPreview';

// ---------------------------------------------------------------------------
// Helpers for the A/B compare endpoint. Computes per-version metrics from
// AgentRun rows and evaluates the three-gate promotion framework from TODO.md.
// ---------------------------------------------------------------------------

interface VersionSummary {
  promptVersionId: string;
  version: string;
  sampleSize: number;
  schemaValid: number;
  schemaFailRate: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgConfidence: number | null;
  avgBullishScore: number | null;
  actionBreakdown: Record<string, number>;
  firstRunAt: string | null;
  lastRunAt: string | null;
}

async function summarizeVersion(promptVersionId: string, version: string): Promise<VersionSummary> {
  const runs = await prisma.agentRun.findMany({
    where: { promptVersionId },
    select: {
      latencyMs: true,
      schemaValid: true,
      parsedOutput: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const sampleSize = runs.length;
  const schemaValid = runs.filter((r) => r.schemaValid).length;
  const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  const confidences: number[] = [];
  const bullishScores: number[] = [];
  const actionBreakdown: Record<string, number> = {};
  for (const r of runs) {
    const p = (r.parsedOutput ?? {}) as any;
    if (typeof p.confidence === 'number') confidences.push(p.confidence);
    if (typeof p.bullishScore === 'number') bullishScores.push(p.bullishScore);
    if (typeof p.action === 'string') {
      actionBreakdown[p.action] = (actionBreakdown[p.action] ?? 0) + 1;
    }
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const p95 = (xs: number[]) =>
    xs.length === 0 ? null : xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]!;

  return {
    promptVersionId,
    version,
    sampleSize,
    schemaValid,
    schemaFailRate: sampleSize > 0 ? 1 - schemaValid / sampleSize : 0,
    avgLatencyMs: avg(latencies),
    p95LatencyMs: p95(latencies),
    avgConfidence: avg(confidences),
    avgBullishScore: avg(bullishScores),
    actionBreakdown,
    firstRunAt: runs[0]?.createdAt.toISOString() ?? null,
    lastRunAt: runs[runs.length - 1]?.createdAt.toISOString() ?? null,
  };
}

interface GateResult {
  name: string;
  status: 'pass' | 'fail' | 'pending' | 'not_available';
  detail: string;
}

function evaluateGates(
  agentKind: string,
  active: VersionSummary,
  candidate: VersionSummary,
): { sanity: GateResult[]; timeFloor: GateResult; threshold: GateResult; verdict: 'ready' | 'pending' | 'failed' } {
  const sanity: GateResult[] = [];

  // Schema validity gate: candidate ≥ 95%
  const candValidPct = candidate.sampleSize > 0 ? 1 - candidate.schemaFailRate : 1;
  sanity.push({
    name: 'schema_validity_pct',
    status: candidate.sampleSize === 0 ? 'pending' : candValidPct >= 0.95 ? 'pass' : 'fail',
    detail: `${(candValidPct * 100).toFixed(1)}% (≥95% required)`,
  });

  // Latency gate: candidate avg ≤ 2× active avg
  if (active.avgLatencyMs && candidate.avgLatencyMs) {
    const ratio = candidate.avgLatencyMs / active.avgLatencyMs;
    sanity.push({
      name: 'latency_within_2x',
      status: ratio <= 2 ? 'pass' : 'fail',
      detail: `${ratio.toFixed(2)}× active avg (≤2× required)`,
    });
  } else {
    sanity.push({
      name: 'latency_within_2x',
      status: 'pending',
      detail: 'not enough samples',
    });
  }

  // Trade-rate gate (head trader only): candidate non-HOLD rate within ±15pp
  if (agentKind === 'head_trader') {
    const activeNonHold =
      active.sampleSize > 0
        ? (active.sampleSize - (active.actionBreakdown.HOLD ?? 0)) / active.sampleSize
        : 0;
    const candNonHold =
      candidate.sampleSize > 0
        ? (candidate.sampleSize - (candidate.actionBreakdown.HOLD ?? 0)) / candidate.sampleSize
        : 0;
    const delta = Math.abs(candNonHold - activeNonHold);
    sanity.push({
      name: 'trade_rate_within_15pp',
      status: candidate.sampleSize === 0 ? 'pending' : delta <= 0.15 ? 'pass' : 'fail',
      detail: `Δ = ${(delta * 100).toFixed(1)}pp (≤15pp required)`,
    });
  }

  // Gate 2 — time floor: candidate has been shadowing for ≥14 calendar days
  const REQUIRED_DAYS = agentKind === 'head_trader' ? 21 : 14;
  let timeFloor: GateResult;
  if (!candidate.firstRunAt) {
    timeFloor = { name: 'time_floor', status: 'pending', detail: 'no shadow runs yet' };
  } else {
    const days = (Date.now() - new Date(candidate.firstRunAt).getTime()) / 86400000;
    timeFloor = {
      name: 'time_floor',
      status: days >= REQUIRED_DAYS ? 'pass' : 'pending',
      detail: `${days.toFixed(1)} of ${REQUIRED_DAYS} required days`,
    };
  }

  // Gate 3 — sample threshold. Hit-rate sub-gate is not_available because the
  // shadow head trader doesn't get a TradePlan row yet (cycleId is @unique
  // on TradePlan in the current schema).
  const REQUIRED_SAMPLES =
    agentKind === 'head_trader' ? 100 : agentKind === 'critic' ? 30 : 60;
  const threshold: GateResult = {
    name: 'sample_threshold',
    status:
      candidate.sampleSize >= REQUIRED_SAMPLES ? 'pass' : 'pending',
    detail: `${candidate.sampleSize} of ${REQUIRED_SAMPLES} required samples (hit-rate sub-gate pending TradeOutcome support for shadow head trader)`,
  };

  const anyFail =
    sanity.some((g) => g.status === 'fail') ||
    timeFloor.status === 'fail' ||
    threshold.status === 'fail';
  const allPass =
    sanity.every((g) => g.status === 'pass') &&
    timeFloor.status === 'pass' &&
    threshold.status === 'pass';
  const verdict: 'ready' | 'pending' | 'failed' = anyFail ? 'failed' : allPass ? 'ready' : 'pending';

  return { sanity, timeFloor, threshold, verdict };
}

export async function registerPromptRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      schema: {
        tags: ['prompts'],
        querystring: z.object({ agentName: z.string().optional() }),
      },
    },
    async (req) => {
      const { agentName } = req.query as { agentName?: string };
      const versions = await prisma.promptVersion.findMany({
        where: agentName ? { agent: { name: agentName } } : undefined,
        orderBy: { createdAt: 'desc' },
        include: { agent: { select: { name: true, displayName: true } } },
      });
      return versions;
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['prompts'],
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const v = await prisma.promptVersion.findUnique({
        where: { id },
        include: { agent: { select: { name: true, displayName: true } } },
      });
      if (!v) return reply.notFound();
      return v;
    },
  );

  app.get(
    '/diff/:fromId/:toId',
    {
      schema: {
        tags: ['prompts'],
        params: z.object({ fromId: z.string().uuid(), toId: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { fromId, toId } = req.params as { fromId: string; toId: string };
      const [from, to] = await Promise.all([
        prisma.promptVersion.findUnique({ where: { id: fromId } }),
        prisma.promptVersion.findUnique({ where: { id: toId } }),
      ]);
      if (!from || !to) return reply.notFound();
      return { from, to };
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/prompts — create a new prompt version for an existing agent.
  //
  // Phase 1 preview-before-save: server appends the canonical outputContract
  // (from agent-outputs.ts), runs the combined prompt through the smart-mock
  // LLM, and validates the output against the agent's Zod schema. On parse
  // failure the version is NOT saved; `?force=true` overrides the gate.
  // -------------------------------------------------------------------------
  app.post(
    '/',
    {
      schema: {
        tags: ['prompts'],
        querystring: z.object({ force: z.coerce.boolean().default(false) }),
        body: z.object({
          agentName: z.string().min(1),
          version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/),
          directiveTemplate: z.string().min(20),
          changelog: z.string().optional(),
          activate: z.boolean().default(true),
        }),
      },
    },
    async (req, reply) => {
      const { force } = req.query as { force: boolean };
      const { agentName, version, directiveTemplate, changelog, activate } = req.body as {
        agentName: string;
        version: string;
        directiveTemplate: string;
        changelog?: string;
        activate: boolean;
      };

      if (!hasContract(agentName)) {
        return reply.badRequest(
          `Unknown agent: ${agentName}. Add a Zod schema + contract in backend/src/schemas/agent-outputs.ts first.`,
        );
      }

      const agent = await prisma.agent.findUnique({ where: { name: agentName } });
      if (!agent) return reply.notFound(`Agent ${agentName} not registered.`);

      const contract = outputContractFor(agentName);

      // Preview: render the prompt + base prompt the same way the cycle runner
      // does and validate the mock LLM's response. Surface the rendered prompt
      // + raw response so the UI can show the user exactly what failed.
      if (!force) {
        const baseRow = await prisma.basePromptVersion.findFirst({ where: { isActive: true } });
        const preview = await previewPromptVersion({
          agentName,
          directiveTemplate,
          outputContract: contract,
          systemPrompt: baseRow?.template,
        });
        if (!preview.ok) {
          reply.code(400);
          return {
            error: 'PromptPreviewFailed',
            message: 'Preview validation failed. Fix the directive or pass ?force=true to bypass.',
            agentName,
            parseError: preview.parseError,
            renderedPrompt: preview.rendered,
            rawResponse: preview.raw,
          };
        }
      }

      const pv = await prisma.promptVersion.upsert({
        where: { agentId_version: { agentId: agent.id, version } },
        update: {
          directiveTemplate,
          outputContract: contract,
          changelog: changelog ?? null,
          isActive: activate,
        },
        create: {
          agentId: agent.id,
          version,
          directiveTemplate,
          outputContract: contract,
          changelog: changelog ?? null,
          isActive: activate,
        },
      });

      if (activate) {
        await prisma.promptVersion.updateMany({
          where: { agentId: agent.id, NOT: { id: pv.id } },
          data: { isActive: false },
        });
        await prisma.agent.update({ where: { id: agent.id }, data: { activePromptVersionId: pv.id } });
      }

      reply.code(201);
      return pv;
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/prompts/:id/shadow — mark this version as the agent's shadow
  // A/B candidate. The cycle runner will dual-run it alongside the active
  // version every cycle. Only ONE candidate per agent at a time — promoting
  // a new candidate demotes any existing one.
  // -------------------------------------------------------------------------
  app.post(
    '/:id/shadow',
    {
      schema: { tags: ['prompts'], params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const pv = await prisma.promptVersion.findUnique({ where: { id } });
      if (!pv) return reply.notFound();
      if (pv.isActive) {
        return reply.badRequest(
          'Cannot shadow an already-active version. Pick a different version to shadow.',
        );
      }
      // Demote any other candidate for this agent, then promote this one.
      await prisma.$transaction([
        prisma.promptVersion.updateMany({
          where: { agentId: pv.agentId, isShadowCandidate: true, NOT: { id } },
          data: { isShadowCandidate: false },
        }),
        prisma.promptVersion.update({ where: { id }, data: { isShadowCandidate: true } }),
      ]);
      return { id, isShadowCandidate: true };
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/prompts/:id/shadow — cancel the shadow A/B. Historical
  // AgentRun rows with runKind='ab' are preserved.
  // -------------------------------------------------------------------------
  app.delete(
    '/:id/shadow',
    {
      schema: { tags: ['prompts'], params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const pv = await prisma.promptVersion.findUnique({ where: { id } });
      if (!pv) return reply.notFound();
      await prisma.promptVersion.update({ where: { id }, data: { isShadowCandidate: false } });
      return { id, isShadowCandidate: false };
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/prompts/:id/promote — promote this version to active. Any
  // currently-active version for this agent is demoted (isActive=false); if
  // the promoted version was a shadow candidate the flag is cleared.
  // -------------------------------------------------------------------------
  app.post(
    '/:id/promote',
    {
      schema: { tags: ['prompts'], params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const pv = await prisma.promptVersion.findUnique({ where: { id } });
      if (!pv) return reply.notFound();
      await prisma.$transaction([
        prisma.promptVersion.updateMany({
          where: { agentId: pv.agentId, NOT: { id } },
          data: { isActive: false },
        }),
        prisma.promptVersion.update({
          where: { id },
          data: { isActive: true, isShadowCandidate: false },
        }),
        prisma.agent.update({ where: { id: pv.agentId }, data: { activePromptVersionId: id } }),
      ]);
      return { id, isActive: true };
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/prompts/ab-compare/:agentName — side-by-side metrics for the
  // active version vs the shadow candidate. Implements the three-gate
  // promotion framework from TODO.md: sanity (schema + latency), time-floor,
  // sample-size threshold.
  //
  // MVP scope: gates that need TradeOutcome rows (hit rate, Brier) report
  // 'not_available' because shadow head-trader runs don't persist TradePlan
  // (cycleId is @unique). That's a follow-up. The sanity + time gates +
  // sample count are fully computable today and are what catches the
  // 90%-case regressions.
  // -------------------------------------------------------------------------
  app.get(
    '/ab-compare/:agentName',
    {
      schema: { tags: ['prompts'], params: z.object({ agentName: z.string() }) },
    },
    async (req, reply) => {
      const { agentName } = req.params as { agentName: string };
      const agent = await prisma.agent.findUnique({
        where: { name: agentName },
        include: { promptVersions: { orderBy: { createdAt: 'desc' } } },
      });
      if (!agent) return reply.notFound();

      const active = agent.promptVersions.find((p) => p.isActive);
      const candidate = agent.promptVersions.find((p) => p.isShadowCandidate && !p.isActive);

      if (!active) return reply.notFound('No active prompt for this agent.');
      if (!candidate) {
        return {
          agentName,
          agentKind: agent.kind,
          active: await summarizeVersion(active.id, active.version),
          candidate: null,
          gates: null,
        };
      }

      const [activeSummary, candidateSummary] = await Promise.all([
        summarizeVersion(active.id, active.version),
        summarizeVersion(candidate.id, candidate.version),
      ]);

      const gates = evaluateGates(agent.kind as string, activeSummary, candidateSummary);

      return {
        agentName,
        agentKind: agent.kind,
        active: activeSummary,
        candidate: candidateSummary,
        gates,
      };
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/prompts/preview — dry-run a directive without persisting.
  // Useful for the UI to show preview output before the user clicks Save.
  // -------------------------------------------------------------------------
  app.post(
    '/preview',
    {
      schema: {
        tags: ['prompts'],
        body: z.object({
          agentName: z.string().min(1),
          directiveTemplate: z.string().min(20),
        }),
      },
    },
    async (req, reply) => {
      const { agentName, directiveTemplate } = req.body as {
        agentName: string;
        directiveTemplate: string;
      };
      if (!hasContract(agentName)) return reply.badRequest(`Unknown agent: ${agentName}`);
      const baseRow = await prisma.basePromptVersion.findFirst({ where: { isActive: true } });
      const result = await previewPromptVersion({
        agentName,
        directiveTemplate,
        systemPrompt: baseRow?.template,
      });
      return {
        ok: result.ok,
        parseError: result.parseError ?? null,
        renderedPrompt: result.rendered,
        rawResponse: result.raw,
        parsed: result.parsed ?? null,
        latencyMs: result.latencyMs,
        outputContract: outputContractFor(agentName),
      };
    },
  );
}
