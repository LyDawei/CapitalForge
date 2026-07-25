import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPrismaClient } from '../prisma';
import {
  settleProposedPlans,
  createMockAlpacaService,
  createAlpacaService,
  loadConfig,
} from '@capitalforge/engine';

const NoteCreateSchema = z.object({
  agentName: z.string().min(1),
  engineVersion: z.enum(['v1', 'v2']),
  body: z.string().min(1).max(8000),
  cycleId: z.string().uuid().optional(),
  author: z.string().optional(),
});

const NotesQuerySchema = z.object({
  agent: z.string().optional(),
  engineVersion: z.enum(['v1', 'v2']).optional(),
  cycleId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const NoteParamsSchema = z.object({ id: z.string().uuid() });

export const notesRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const prisma = getPrismaClient();

  app.get(
    '/notes',
    { schema: { querystring: NotesQuerySchema, tags: ['notes'], summary: 'List agent notes' } },
    async (req) => {
      const { agent, engineVersion, cycleId, limit } = req.query;
      const where: Record<string, unknown> = {};
      if (agent) where.agentName = agent;
      if (engineVersion) where.engineVersion = engineVersion;
      if (cycleId) where.cycleId = cycleId;
      return prisma.agentNote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }
  );

  app.post(
    '/notes',
    { schema: { body: NoteCreateSchema, tags: ['notes'], summary: 'Create a note for an agent' } },
    async (req, reply) => {
      if ((req as any).isGuest) {
        reply.code(403);
        return { error: { code: 'GUEST_FORBIDDEN', message: 'Guest users cannot create notes' } };
      }
      const note = await prisma.agentNote.create({ data: req.body });
      reply.code(201);
      return note;
    }
  );

  app.delete(
    '/notes/:id',
    { schema: { params: NoteParamsSchema, tags: ['notes'], summary: 'Delete a note' } },
    async (req, reply) => {
      if ((req as any).isGuest) {
        reply.code(403);
        return { error: { code: 'GUEST_FORBIDDEN', message: 'Guest users cannot delete notes' } };
      }
      try {
        await prisma.agentNote.delete({ where: { id: req.params.id } });
        reply.code(204);
        return null;
      } catch {
        reply.code(404);
        return { error: { code: 'NOTE_NOT_FOUND', message: `No note ${req.params.id}` } };
      }
    }
  );

  // Manual settler trigger — useful from the UI without dropping into the shell.
  app.post(
    '/admin/settle-plans',
    {
      schema: {
        tags: ['admin'],
        summary: 'Run the counterfactual settlement simulator over proposed BUY plans',
      },
    },
    async (req, reply) => {
      if ((req as any).isGuest) {
        reply.code(403);
        return { error: { code: 'GUEST_FORBIDDEN', message: 'Guest users cannot settle plans' } };
      }
      const config = loadConfig();
      const alpaca = config.mode === 'mock' ? createMockAlpacaService() : createAlpacaService(config);
      return settleProposedPlans(prisma, alpaca, { minDaysOld: 0, maxToSettle: 200 });
    }
  );
};
