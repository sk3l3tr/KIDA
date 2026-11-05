/** Open responses mirror backend/backup/health_models.py, including future fields. */
interface CoreData {
  [key: string]: unknown;
}
export interface HealthQueued extends CoreData {
  run_id: string;
  state: string;
  execution_id: string;
}
export type HealthAction = 'start' | 'run' | 'stop' | 'delete';
export interface PendingHealth {
  readonly action: HealthAction;
  readonly label: string;
  readonly value: string;
  readonly target: string;
}
export type HealthMode = 'AUTOMATIC' | 'MANUAL';
export interface CreateHealth {
  definition_path: string;
  mode: HealthMode;
}
export interface HealthExecution extends CoreData {
  run_id: string;
  definition: CoreData & {
    id: string;
    name: string;
    backup: CoreData & { reference: string; version: string };
    docker: CoreData & { compose: string };
  };
  definition_path: string;
  mode: string;
  state: string;
  diagnosis: CoreData & {
    result: string;
    summary: string;
    complete: boolean;
    services: (CoreData & { service: string; result: string; reasons: string[] })[];
    anomalies: string[];
    evidence: (CoreData & {
      observed_at: string;
      service: string | null;
      container_id: string | null;
      description: string;
      logs: string | null;
    })[];
  };
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  artifact:
    | (CoreData & {
        artifact_id: string;
        job_id: string;
        artifact_name: string;
        created_at: string;
        path: string;
        checksum: string;
        size: number;
      })
    | null;
  compose_path: string;
  compose_checksum: string | null;
  restore_dir: string;
  project: (CoreData & { owner: string; project: string }) | null;
  services: (CoreData & { name: string; image: string; replicas: number })[];
  resources: (CoreData & { kind: string; identity: string })[];
  cleanup: CoreData & { state: string; errors: string[] };
  report_path: string | null;
}
export interface HealthHistoryRecord extends HealthExecution {
  record_version: number;
  restore_provenance:
    | (CoreData & {
        path: string;
        identity: (CoreData & { device: number; inode: number }) | null;
      })
    | null;
  report_status: string;
}
