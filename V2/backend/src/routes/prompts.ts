import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { outputContractFor, hasContract } from '../schemas/agent-outputs';
import { previewPromptVersion } from './_promptPreview';

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
