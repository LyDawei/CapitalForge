"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentOutputSchema = exports.CycleStatusSchema = exports.AgentNameSchema = exports.DecisionSchema = exports.NewsDataSchema = exports.WebSearchResultSchema = exports.NewsArticleSchema = exports.SandboxContextSchema = exports.TechnicalDataSchema = void 0;
exports.calculateDrawdown = calculateDrawdown;
exports.updatePeakEquity = updatePeakEquity;
exports.formatDate = formatDate;
exports.getTodayDate = getTodayDate;
const zod_1 = require("zod");
// Re-export cross-boundary types from shared package
var shared_1 = require("@capitalforge/shared");
Object.defineProperty(exports, "TechnicalDataSchema", { enumerable: true, get: function () { return shared_1.TechnicalDataSchema; } });
Object.defineProperty(exports, "SandboxContextSchema", { enumerable: true, get: function () { return shared_1.SandboxContextSchema; } });
Object.defineProperty(exports, "NewsArticleSchema", { enumerable: true, get: function () { return shared_1.NewsArticleSchema; } });
Object.defineProperty(exports, "WebSearchResultSchema", { enumerable: true, get: function () { return shared_1.WebSearchResultSchema; } });
Object.defineProperty(exports, "NewsDataSchema", { enumerable: true, get: function () { return shared_1.NewsDataSchema; } });
Object.defineProperty(exports, "DecisionSchema", { enumerable: true, get: function () { return shared_1.DecisionSchema; } });
Object.defineProperty(exports, "AgentNameSchema", { enumerable: true, get: function () { return shared_1.AgentNameSchema; } });
Object.defineProperty(exports, "CycleStatusSchema", { enumerable: true, get: function () { return shared_1.CycleStatusSchema; } });
exports.AgentOutputSchema = zod_1.z.object({
    bullishScore: zod_1.z.number().min(-1).max(1),
    confidence: zod_1.z.number().min(0).max(1),
    rationale: zod_1.z.array(zod_1.z.string()),
});
// Drawdown calculation (deterministic)
function calculateDrawdown(currentEquity, peakEquity) {
    if (peakEquity === 0)
        return 0;
    return (peakEquity - currentEquity) / peakEquity;
}
// Peak equity update (monotonic increase)
function updatePeakEquity(currentEquity, previousPeak) {
    return Math.max(currentEquity, previousPeak);
}
// Format date as YYYY-MM-DD
function formatDate(date) {
    return date.toISOString().split('T')[0];
}
// Get today's date in YYYY-MM-DD format
function getTodayDate() {
    return formatDate(new Date());
}
//# sourceMappingURL=types.js.map