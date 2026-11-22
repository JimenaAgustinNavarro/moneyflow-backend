export const CORE_PATTERNS = {
  HEALTH_CHECK: 'health.check',
} as const;

export interface CoreHealthResponse {
  status: 'ok' | 'error';
  service: 'core-service';
  database: 'up' | 'down';
  timestamp: string;
}

export interface GatewayHealthResponse {
  status: 'ok';
  gateway: 'up';
  coreService: 'up';
  database: 'up';
  timestamp: string;
}
