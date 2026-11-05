export interface HealthReport {
  run_id: string;
  markdown: string;
  [key: string]: unknown;
}

export interface DeletedHealthReport {
  run_id: string;
  deleted: boolean;
  [key: string]: unknown;
}

export interface PendingReport {
  readonly run_id: string;
}
