import type { Specialist } from './base';
import { trendRegimeSpecialist } from './trendRegime';
import { setupPatternSpecialist } from './setupPattern';
import { momentumSpecialist } from './momentum';
import { meanReversionSpecialist } from './meanReversion';
import { volumeFlowSpecialist } from './volumeFlow';
import { newsEventsSpecialist } from './newsEvents';

export const SPECIALIST_ROSTER: readonly Specialist[] = [
  trendRegimeSpecialist,
  setupPatternSpecialist,
  momentumSpecialist,
  meanReversionSpecialist,
  volumeFlowSpecialist,
  newsEventsSpecialist,
];

export {
  trendRegimeSpecialist,
  setupPatternSpecialist,
  momentumSpecialist,
  meanReversionSpecialist,
  volumeFlowSpecialist,
  newsEventsSpecialist,
};
export * from './base';
