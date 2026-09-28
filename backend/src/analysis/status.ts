/** Process-wide engine status, served by `GET /api/insights/status`. */
export interface AnalysisStatus {
  enabled: boolean;
  /** Why the engine is off, when it is. */
  reason: string | null;
  provider: string | null;
  model: string | null;
  analyses: { name: string; description: string; schedule: string; enabled: boolean }[];
}

let status: AnalysisStatus = {
  enabled: false,
  reason: 'analysis engine not started',
  provider: null,
  model: null,
  analyses: []
};

export function getAnalysisStatus(): AnalysisStatus {
  return status;
}

export function setAnalysisStatus(next: AnalysisStatus): void {
  status = next;
}
