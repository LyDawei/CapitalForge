-- Split PromptVersion.template into directiveTemplate + outputContract.
-- Phase 2 of the prompt-output-contract work: the directive is user-editable;
-- the contract is auto-generated from the agent's Zod schema and not editable
-- by hand. Existing rows are backfilled by parsing the template on its contract
-- marker. Re-seeding (`npm run prisma:seed`) overwrites these with the canonical
-- code-derived contracts; this backfill keeps history readable in the meantime.

-- 1) Add the new columns with empty-string defaults so existing rows pass NOT NULL.
ALTER TABLE "PromptVersion" ADD COLUMN "directiveTemplate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PromptVersion" ADD COLUMN "outputContract" TEXT NOT NULL DEFAULT '';

-- 2) Backfill from the legacy `template` column. v0.2.0 uses the em-dash
--    marker "REQUIRED OUTPUT"; v0.1.0 uses "Respond JSON only:". Anything that
--    has no marker is treated as a pure directive (the contract becomes empty).
UPDATE "PromptVersion"
SET
  "directiveTemplate" = CASE
    WHEN POSITION('REQUIRED OUTPUT' IN "template") > 0
      THEN TRIM(BOTH FROM SUBSTRING("template" FROM 1 FOR POSITION('REQUIRED OUTPUT' IN "template") - 1))
    WHEN POSITION('Respond JSON only:' IN "template") > 0
      THEN TRIM(BOTH FROM SUBSTRING("template" FROM 1 FOR POSITION('Respond JSON only:' IN "template") - 1))
    ELSE "template"
  END,
  "outputContract" = CASE
    WHEN POSITION('REQUIRED OUTPUT' IN "template") > 0
      THEN SUBSTRING("template" FROM POSITION('REQUIRED OUTPUT' IN "template"))
    WHEN POSITION('Respond JSON only:' IN "template") > 0
      THEN SUBSTRING("template" FROM POSITION('Respond JSON only:' IN "template"))
    ELSE ''
  END;

-- 3) Drop the legacy `template` column. From here on the runner reads
--    directiveTemplate + outputContract.
ALTER TABLE "PromptVersion" DROP COLUMN "template";

-- 4) Remove the empty-string defaults — new rows must provide explicit values.
ALTER TABLE "PromptVersion" ALTER COLUMN "directiveTemplate" DROP DEFAULT;
ALTER TABLE "PromptVersion" ALTER COLUMN "outputContract" DROP DEFAULT;
