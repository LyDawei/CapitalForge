-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "basePromptVersionId" TEXT;

-- CreateTable
CREATE TABLE "BasePromptVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "changelog" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BasePromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BasePromptVersion_version_key" ON "BasePromptVersion"("version");

-- CreateIndex
CREATE INDEX "BasePromptVersion_isActive_idx" ON "BasePromptVersion"("isActive");

-- CreateIndex
CREATE INDEX "BasePromptVersion_createdAt_idx" ON "BasePromptVersion"("createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_basePromptVersionId_idx" ON "AgentRun"("basePromptVersionId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_basePromptVersionId_fkey" FOREIGN KEY ("basePromptVersionId") REFERENCES "BasePromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
