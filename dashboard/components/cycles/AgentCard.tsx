import ScoreBar from '@/components/ui/ScoreBar';
import ConfidenceBar from '@/components/ui/ConfidenceBar';
import ExpandableSection from '@/components/ui/ExpandableSection';
import { agentDisplayName } from '@/lib/utils';

interface AgentEvaluation {
  agentName: string;
  bullishScore: number;
  confidence: number;
  rationale: string[];
  rawResponse: string;
  promptVersion: string;
}

export default function AgentCard({ evaluation }: { evaluation: AgentEvaluation }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">
          {agentDisplayName(evaluation.agentName)}
        </h4>
        <span className="text-xs text-gray-600 font-mono">{evaluation.promptVersion}</span>
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Bullish Score</label>
          <ScoreBar score={evaluation.bullishScore} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Confidence</label>
          <ConfidenceBar confidence={evaluation.confidence} />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Rationale</label>
        <ul className="space-y-1">
          {evaluation.rationale.map((reason, i) => (
            <li key={i} className="text-sm text-gray-300 flex gap-2">
              <span className="text-gray-600 select-none">•</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      </div>

      <ExpandableSection label="Raw LLM Response">
        {evaluation.rawResponse}
      </ExpandableSection>
    </div>
  );
}
