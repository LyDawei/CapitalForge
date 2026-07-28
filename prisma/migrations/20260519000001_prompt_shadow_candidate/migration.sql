-- Add the shadow-candidate flag to PromptVersion.
-- Phase 1 of TODO.md item #2 (A/B testing prompt versions before rollout):
-- when isShadowCandidate=true, the cycle runner also renders this version each
-- cycle alongside the active one and persists its AgentRun with runKind='ab'.

ALTER TABLE "PromptVersion" ADD COLUMN "isShadowCandidate" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "PromptVersion_isShadowCandidate_idx" ON "PromptVersion"("isShadowCandidate");
