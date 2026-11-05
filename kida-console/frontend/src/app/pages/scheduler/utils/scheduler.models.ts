export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type OriginFilter = 'USER' | 'INTERNAL' | 'ALL';
export type ScheduleRule =
  | { type: 'once'; at: string }
  | { type: 'interval'; seconds: number }
  | { type: 'cron'; expression: string; timezone: string };
export interface CreateSchedule {
  command: string;
  params: JsonValue;
  schedule: ScheduleRule;
}
export interface Schedule extends Omit<CreateSchedule, 'schedule'> {
  id: string;
  origin: string;
  schedule: ScheduleRule & { [key: string]: unknown };
  [key: string]: unknown;
}
export interface ListedSchedule extends Schedule {
  next_enqueue_at: string;
}
export interface ScheduleForm {
  command: string;
  params: string;
  mode: ScheduleRule['type'];
  local: string;
  seconds: string;
  expression: string;
  timezone: string;
}
export type PendingSchedule =
  | { action: 'add'; body: CreateSchedule }
  | { action: 'delete'; body: { id: string }; entry: Schedule };
