/*
connection.ts

This file contains the types for the connection data and the supported filters.
*/

export interface SupportedFilter {
  key: string;
  operators: string[];
}

export interface ConnectionData {
  type: string;
  platform: string;
  status: string;
  supportedActions: string[];
  oauth: {
    enabled: boolean;
    scopes: string;
  };
  pagination: boolean;
  filtration: boolean;
  sorting: boolean;
  caveats: string[];
  supportedFilters: SupportedFilter[];
  supportedSortKeys: string[] | null;
  [key: string]: any;
}

export type ManageEntityParams = {
  operation: 'list' | 'get' | 'create' | 'update' | 'delete' | 'count' | 'capabilities';
  entityType: string;
  connectionKey: string;
  id?: string;
  data?: Record<string, any>;
  filters?: {
    limit?: number;
    createdAfter?: string;
    createdBefore?: string;
    updatedAfter?: string;
    updatedBefore?: string;
  };
  [key: string]: any;
};

export interface AvailableActions {
  _id: string;
  title: string;
  connectionPlatform: string;
  knowledge: string;
  path: string;
  baseUrl: string;
  tags: string[];
}

export interface RequestConfig {
  url: string;
  method?: string;
  headers: Record<string, string | number | boolean>;
  params?: Record<string, string | number | boolean>;
  data?: unknown;
}

export interface ConnectionDefinition {
  authMethod: object | null;
  _id: string;
  platformVersion: string;
  platform: string;
  type: string;
  name: string;
  authSecrets: any[];
  frontend: {
    spec: {
      title: string;
      description: string;
      platform: string;
      category: string;
      image: string;
      tags: string[];
    };
    connectionForm: {
      name: string;
      description: string;
      formData: any[];
    };
  };
  paths: {
    id: string;
    event: string;
    payload: unknown;
    timestamp: string;
    secret: string;
    signature: string;
    cursor: string;
  };
  settings: {
    parseWebhookBody: boolean;
    showSecret: boolean;
    allowCustomEvents: boolean;
    oauth: boolean;
  };
  hidden: boolean;
  testConnection: string | null;
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

export interface Connection {
  _id: string;
  platformVersion: string;
  connectionDefinitionId: string;
  name: string;
  key: string;
  environment: string;
  platform: string;
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
