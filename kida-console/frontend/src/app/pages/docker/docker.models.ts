/** CORE data is extensible; retain additional fields in every object. */
export interface DockerPort {
  container_port: number | null;
  protocol: string;
  host_ip: string | null;
  host_port: string | null;
  [key: string]: unknown;
}
export interface DockerNetwork {
  name: string;
  ip_address: string | null;
  gateway: string | null;
  mac_address: string | null;
  [key: string]: unknown;
}
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  online: boolean;
  status: string;
  health: string | null;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  restart_count: number;
  restart_policy: string | null;
  ports: DockerPort[];
  networks: DockerNetwork[];
  [key: string]: unknown;
}
export interface DockerContainers {
  total: number;
  running: number;
  containers: DockerContainer[];
  [key: string]: unknown;
}
export interface ComposeVersion {
  version: string;
  [key: string]: unknown;
}
export interface ComposeService {
  name: string | null;
  containers: DockerContainer[];
  [key: string]: unknown;
}
export interface ComposeProject {
  name: string;
  services: ComposeService[];
  [key: string]: unknown;
}
export interface ContainerResult {
  container: string;
  status: string;
  [key: string]: unknown;
}
export type ContainerAction = 'start' | 'stop' | 'restart' | 'delete';
export interface PendingContainer {
  readonly action: ContainerAction;
  readonly id: string;
  readonly name: string;
}
