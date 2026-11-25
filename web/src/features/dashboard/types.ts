export interface DashboardItem {
  name: string;
  url: string;
  host: string;
  description?: string;
  iconUrl?: string;
  iconText?: string;
}

export interface DashboardGroup {
  name: string;
  items: DashboardItem[];
}

export interface DashboardData {
  groups: DashboardGroup[];
}

export interface CpuTelemetry {
  percent: number;
  usedCoresText?: string;
  totalCores: number;
  perCore?: number[];
  source: 'cgroup' | 'host';
}

export interface MemoryTelemetry {
  usedBytes: number;
  totalBytes: number;
  percent: number;
  source: 'cgroup' | 'host';
}

export interface DiskTelemetry {
  label: string;
  path: string;
  device?: string;
  fsType?: string;
  usedBytes: number;
  totalBytes: number;
  availableBytes?: number;
  percent: number;
  error?: string;
}

export interface SystemTelemetrySnapshot {
  refreshSeconds?: number;
  cpu?: CpuTelemetry;
  memory?: MemoryTelemetry;
  disks?: DiskTelemetry[];
}
