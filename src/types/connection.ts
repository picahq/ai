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