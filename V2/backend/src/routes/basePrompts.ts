import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { previewPromptVersion } from './_promptPreview';

/// Agent used as the canary for base-prompt previews. The base prompt is sent
/// as a system prompt above this agent's role-specific prompt to confirm that
/// changing the base discipline framework doesn't break the downstream output
/// contract. Momentum was picked because it has rich agent-specific extras —
/// if the base prompt poisons output structure, this is where it surfaces.
const PREVIEW_CANARY_AGENT = 'momentum';

export async function registerBasePromptRoutes(app: FastifyInstance) {
  // List all versions (newest first)
  app.get('/', { schema: { tags: ['base-prompts'] } }, async () =>
    prisma.basePromptVersion.findMany({ orderBy: { createdAt: 'desc' } }),
  );

  // Currently active
  app.get('/active', { schema: { tags: ['base-prompts'] } }, async (_req, reply) => {
    const active = await prisma.basePromptVersion.findFirst({ where: { isActive: true } });
    if (!active) return reply.notFound('no active base prompt');
    return active;
  });

  // Detail
  app.get(
    '/:id',
    {
      schema: { tags: ['base-prompts'], params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await prisma.basePromptVersion.findUnique({ where: { id } });
      if (!row) return reply.notFound();
      return row;
    },
  );

  // Create a new version (and optionally activate it)
  //
  // Phase 1 preview-before-save: the candidate base prompt is used as the
  // system prompt for the canary agent's active directive+contract. If the
  // canary's output stops validating, the base prompt is interfering with the
  // output contract and we refuse the save. `?force=true` bypasses this gate.
  app.post(
    '/',
    {
      schema: {
        tags: ['base-prompts'],
        querystring: z.object({ force: z.coerce.boolean().default(false) }),
        body: z.object({
          version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/),
          template: z.string().min(20),
          changelog: z.string().optional(),
          activate: z.boolean().default(true),
        }),
      },
    },
    async (req, reply) => {
      const { force } = req.query as { force: boolean };
      const { version, template, changelog, activate } = req.body as {
        version: string;
        template: string;
        changelog?: string;
        activate: boolean;
      };

      if (!force) {
        // Load the canary agent's active directive (the contract comes from
        // code via outputContractFor()).
        const canary = await prisma.agent.findUnique({
          where: { name: PREVIEW_CANARY_AGENT },
          include: { promptVersions: { where: { isActive: true }, take: 1 } },
        });
        const canaryPv = canary?.promptVersions[0];
        if (!canaryPv) {
          // No canary available — skip the preview rather than fail loudly.
          // This only matters before the first seed; production always has one.
          app.log.warn(
            `Base prompt preview skipped: canary agent ${PREVIEW_CANARY_AGENT} has no active prompt version yet.`,
          );
        } else {
          const preview = await previewPromptVersion({
            agentName: PREVIEW_CANARY_AGENT,
            directiveTemplate: canaryPv.directiveTemplate,
            outputContract: canaryPv.outputContract,
            systemPrompt: template,
          });
          if (!preview.ok) {
            reply.code(400);
            return {
              error: 'BasePromptPreviewFailed',
              message:
                `New base prompt broke ${PREVIEW_CANARY_AGENT}'s output contract. ` +
                `Adjust the discipline framework or pass ?force=true to bypass.`,
              canaryAgent: PREVIEW_CANARY_AGENT,
              parseError: preview.parseError,
              renderedPrompt: preview.rendered,
              rawResponse: preview.raw,
            };
          }
        }
      }

      const created = await prisma.basePromptVersion.create({
        data: { version, template, changelog: changelog ?? null, isActive: activate },
      });
      if (activate) {
        await prisma.basePromptVersion.updateMany({
          where: { NOT: { id: created.id } },
          data: { isActive: false },
        });
      }
      reply.code(201);
      return created;
    },
  );

  // Activate an existing version (deactivate all others)
  app.post(
    '/:id/activate',
    {
      schema: { tags: ['base-prompts'], params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await prisma.basePromptVersion.findUnique({ where: { id } });
      if (!row) return reply.notFound();
      await prisma.basePromptVersion.updateMany({
        where: { NOT: { id } },
        data: { isActive: false },
      });
      return prisma.basePromptVersion.update({ where: { id }, data: { isActive: true } });
    },
  );
}
