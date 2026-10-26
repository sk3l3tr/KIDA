/** Keep open CORE responses intact, including future fields and explicit nulls. */
export interface BackupTarget {
  path: string;
  required: boolean;
  filesystem_uuid?: string | null;
  [key: string]: unknown;
}
export interface LifecycleCommand {
  command: string;
  params: unknown;
  [key: string]: unknown;
}
export interface Retention {
  max_age?: string | null;
  keep_last?: number | null;
  protected_restore_points: string[];
  [key: string]: unknown;
}
export interface BackupJob {
  id: string;
  name: string;
  sources: string[];
  targets: BackupTarget[];
  compression: string;
  lifecycle: {
    pre_backup: LifecycleCommand[];
    post_backup: LifecycleCommand[];
    [key: string]: unknown;
  };
  schedule?: unknown;
  retention?: Retention | null;
  [key: string]: unknown;
}
export interface BackupsResponse {
  backups: BackupJob[];
  [key: string]: unknown;
}
export interface Queued {
  state: string;
  execution_id: string;
  [key: string]: unknown;
}
export interface CreateBackup {
  name: string;
  sources: string[];
  targets: { path: string; required: boolean; filesystem_uuid?: string | null }[];
  compression: 'tar_zstd';
  lifecycle?: {
    pre_backup: { command: string; params?: unknown }[];
    post_backup: { command: string; params?: unknown }[];
  };
  schedule?: unknown;
  retention?: {
    max_age?: string | null;
    keep_last?: number | null;
    protected_restore_points: string[];
  } | null;
}
export type OptionalMode = 'omit' | 'value' | 'null';
export interface OptionalField {
  mode: OptionalMode;
  value: string;
}
export interface CommandForm {
  command: string;
  params: OptionalField;
}
export interface BackupForm {
  name: string;
  sources: { path: string }[];
  targets: { path: string; required: boolean; filesystem_uuid: OptionalField }[];
  lifecycleEnabled: boolean;
  pre_backup: CommandForm[];
  post_backup: CommandForm[];
  schedule: OptionalField;
  retention: OptionalMode;
  max_age: OptionalField;
  keep_last: OptionalField;
  protected_restore_points: { path: string }[];
}
export interface PendingBackup {
  readonly action: 'delete' | 'run';
  readonly id: string;
  readonly name: string;
}
