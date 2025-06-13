export interface AvailableActions {
  _id: string;
  title: string;
  connectionPlatform: string;
  knowledge: string;
  path: string;
  baseUrl: string;
  tags: string[];
  method?: string;
}

export interface RequestConfig {
  url: string;
  method?: string;
  headers: Record<string, string | number | boolean>;
  params?: Record<string, string | number | boolean>;
  data?: unknown;
}

export interface ConnectionDefinition {
  name: string;
  key: string;
  platform: string;
  platformVersion: string;
  description: string;
  category: string;
  image: string;
  tags: string[];
  oauth: boolean;
  createdAt: number;
  updatedAt: number;
  updated: boolean;
  version: string;
  lastModifiedBy: string;
  deleted: boolean;
  active: boolean;
  deprecated: boolean;
}

export interface Connection {
  _id: string;
  platformVersion: string;
  connectionDefinitionId: string;
  name: string;
  key: string;
  environment: string;
  platform: string;
  description: string;
  secretsServiceId: string;
  settings: {
    parseWebhookBody: boolean;
    showSecret: boolean;
    allowCustomEvents: boolean;
    oauth: boolean;
  };
  throughput: {
    key: string;
    limit: number;
  };
  createdAt: number;
  updatedAt: number;
  updated: boolean;
  version: string;
  lastModifiedBy: string;
  deleted: boolean;
  changeLog: Record<string, any>;
  tags: string[];
  active: boolean;
  deprecated: boolean;
}
