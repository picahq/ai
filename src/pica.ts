import axios from "axios";
import { z } from "zod";
import FormData from 'form-data';

import { getDefaultSystemPrompt } from "./prompts/defaultSystem";
import { getDefaultSystemWithAuthkitPrompt } from "./prompts/defaultSystemWithAuthkit";
import { getKnowledgeAgentSystemPrompt } from "./prompts/knowledgeAgentSystem";
import { getKnowledgeAgentWithAuthkitSystemPrompt } from "./prompts/knowledgeAgentWithAuthkitSystem";
import { normalizeActionId, paginateResults, replacePathVariables } from "./utils";
import {
  AvailableActions,
  RequestConfig,
  ConnectionDefinition,
  Connection
} from "./types/connection";

interface PicaOptions {
  /**
   * The descriptor for the Pica client options.
   * @property connectors - Array of connector IDs to filter available actions
   * @property actions - Array of action IDs to filter available actions (default: all actions)
   * @property permissions - Permissions for the Pica client: "read" (GET only), "write" (POST/PUT/PATCH), "admin" (all methods) (default: "admin")
   * @property serverUrl - Custom server URL for Pica API (defaults to https://api.picaos.com)
   * @property identity - Identity value for AuthKit token generation
   * @property identityType - Type of identity for AuthKit ("user", "team", "organization", or "project")
   * @property authkit - Whether to enable AuthKit integration
   * @property knowledgeAgent - Whether to enable Knowledge Agent mode
   * @property knowledgeAgentConfig - Configuration options for Knowledge Agent
   * @property headers - Additional headers to send with requests
   */
  connectors?: string[];
  actions?: string[];
  permissions?: "read" | "write" | "admin";
  serverUrl?: string;
  identity?: string;
  identityType?: "user" | "team" | "organization" | "project";
  authkit?: boolean;
  knowledgeAgent?: boolean;
  knowledgeAgentConfig?: KnowledgeAgentConfig;
  headers?: Record<string, string>;
}

interface KnowledgeAgentConfig {
  includeEnvironmentVariables: boolean;
}

export class Pica {
  private secret: string;
  private connections: Connection[];
  private connectionDefinitions: ConnectionDefinition[];
  private systemPromptValue: string;
  private initialized: Promise<void>;
  private identity?: string;
  private identityType?: string;
  private useAuthkit: boolean;
  private useKnowledgeAgent: boolean;
  private knowledgeAgentConfig?: KnowledgeAgentConfig;
  private options?: PicaOptions;

  private baseUrl = "https://api.picaos.com";
  private getConnectionUrl;
  private availableActionsUrl;
  private getConnectionDefinitionsUrl;

  constructor(secret: string, options?: PicaOptions) {
    this.secret = secret;
    this.connections = [];
    this.connectionDefinitions = [];
    this.systemPromptValue = "Loading connections...";
    this.identity = options?.identity;
    this.identityType = options?.identityType;
    this.useAuthkit = options?.authkit || false;
    this.useKnowledgeAgent = options?.knowledgeAgent || false;
    this.knowledgeAgentConfig = options?.knowledgeAgentConfig || {
      includeEnvironmentVariables: true
    };
    this.options = options;

    if (options?.serverUrl) {
      this.baseUrl = options.serverUrl;
    }

    this.getConnectionUrl = `${this.baseUrl}/v1/vault/connections`;
    this.availableActionsUrl = `${this.baseUrl}/v1/knowledge`;
    this.getConnectionDefinitionsUrl = `${this.baseUrl}/v1/available-connectors`;
    this.initialized = this.initialize()
      .then(() => {
        let filteredConnections = this.connections.filter((conn: any) => conn.active);

        if (!options?.connectors?.length) {
          filteredConnections = [];
        }

        const connectionsInfo = filteredConnections.length > 0
          ? '\t* ' + filteredConnections
            .map((conn: any) => `${conn.platform} - Key: ${conn.key}`)
            .join('\n\t* ')
          : 'No connections available';

        const availablePlatformsInfo = this.connectionDefinitions.map((def) =>
          `\n\t* ${def.platform} (${def.name})`
        ).join('');


        if (options?.knowledgeAgentConfig && !this.useKnowledgeAgent) {
          throw new Error("Cannot provide Knowledge Agent configuration when Knowledge Agent is disabled. Please set useKnowledgeAgent to true if you want to use the Knowledge Agent.");
        }

        // Choose the appropriate system prompt based on options
        if (this.useAuthkit && this.useKnowledgeAgent) {
          this.systemPromptValue = getKnowledgeAgentWithAuthkitSystemPrompt(connectionsInfo, availablePlatformsInfo, this.knowledgeAgentConfig?.includeEnvironmentVariables);
        } else if (this.useAuthkit) {
          this.systemPromptValue = getDefaultSystemWithAuthkitPrompt(connectionsInfo, availablePlatformsInfo);
        } else if (this.useKnowledgeAgent) {
          this.systemPromptValue = getKnowledgeAgentSystemPrompt(connectionsInfo, availablePlatformsInfo, this.knowledgeAgentConfig?.includeEnvironmentVariables);
        } else {
          this.systemPromptValue = getDefaultSystemPrompt(connectionsInfo, availablePlatformsInfo);
        }
      })
      .catch(error => {
        console.error('Error during initialization:', error);
        this.systemPromptValue = "Error loading connections";
      });
  }

  async generateSystemPrompt(userSystemPrompt?: string): Promise<string> {
    await this.waitForInitialization();

    const now = new Date();
    const prompt = `${userSystemPrompt ? userSystemPrompt + '\n\n' : ''}=== PICA: INTEGRATION ASSISTANT ===\n
Everything below is for Pica (picaos.com), your integration assistant that can instantly connect your AI agents to 100+ APIs.\n

Current Time: ${now.toLocaleString('en-US', { timeZone: 'GMT' })} (GMT)

--- Tools Information ---
${this.system.trim()}
        `;

    return prompt;
  }

  private async initialize() {
    await Promise.all([
      this.initializeConnections(undefined, this.options?.connectors),
      this.initializeConnectionDefinitions(),
    ]);
  }

  async waitForInitialization() {
    await this.initialized;
    return this.system;
  }

  private async initializeConnections(platform?: string, connectionKeys?: string[]) {
    try {
      if (!connectionKeys || connectionKeys.length === 0) {
        this.connections = [];
        return;
      }

      const headers = this.generateHeaders();

      let baseUrl = this.getConnectionUrl;
      let hasQueryParam = false;

      if (platform) {
        baseUrl += `?platform=${platform}`;
        hasQueryParam = true;
      }

      if (!connectionKeys.includes("*")) {
        baseUrl += hasQueryParam ? `&key=${connectionKeys.join(',')}` : `?key=${connectionKeys.join(',')}`;
        hasQueryParam = true;
      }

      if (this.identity) {
        baseUrl += hasQueryParam ? `&identity=${encodeURIComponent(this.identity)}` : `?identity=${encodeURIComponent(this.identity)}`;
        hasQueryParam = true;
      }

      if (this.identityType) {
        baseUrl += hasQueryParam ? `&identityType=${encodeURIComponent(this.identityType)}` : `?identityType=${encodeURIComponent(this.identityType)}`;
        hasQueryParam = true;
      }

      const fetchPage = (skip: number, limit: number) =>
        axios.get<{
          rows: Connection[],
          total: number,
          skip: number,
          limit: number
        }>(
          `${baseUrl}${hasQueryParam ? '&' : '?'}limit=${limit}&skip=${skip}`,
          { headers }
        ).then(response => response.data);

      this.connections = await paginateResults<Connection>(fetchPage);
    } catch (error) {
      console.error("Failed to initialize connections:", error);
      this.connections = [];
    }
  }

  private async initializeConnectionDefinitions() {
    try {
      const headers = this.generateHeaders();

      let url = this.getConnectionDefinitionsUrl;
      let hasQueryParam = false;

      if (this.useAuthkit) {
        url += `?authkit=true`;
        hasQueryParam = true;
      }

      const fetchPage = (skip: number, limit: number) =>
        axios.get<{
          rows: ConnectionDefinition[],
          total: number,
          skip: number,
          limit: number
        }>(
          `${url}${hasQueryParam ? '&' : '?'}limit=${limit}&skip=${skip}`,
          { headers }
        ).then(response => response.data);

      this.connectionDefinitions = await paginateResults<ConnectionDefinition>(fetchPage);
    } catch (error) {
      console.error("Failed to initialize connection definitions:", error);
      this.connectionDefinitions = [];
    }
  }

  get system() {
    return this.systemPromptValue;
  }

  private generateHeaders() {
    return {
      "Content-Type": "application/json",
      "x-pica-secret": this.secret,
      ...this.options?.headers
    };
  }

  private async getAllAvailableActions(platform: string, actions?: string[]): Promise<AvailableActions[]> {
    try {
      const fetchPage = (skip: number, limit: number) =>
        axios.get<{
          rows: AvailableActions[],
          total: number,
          skip: number,
          limit: number
        }>(
          `${this.availableActionsUrl}?supported=true&connectionPlatform=${platform}&skip=${skip}&limit=${limit}`,
          { headers: this.generateHeaders() }
        ).then(response => response.data);

      const results = await paginateResults<AvailableActions>(fetchPage);

      // Normalize action IDs in the results
      const normalizedResults = results.map(action => {
        if (action._id) {
          action._id = normalizeActionId(action._id);
        }
        return action;
      });

      // Filter actions by permissions
      let filteredByPermissions = normalizedResults;
      const permissions = this.options?.permissions;

      if (permissions === "read") {
        // Filter for GET methods only
        filteredByPermissions = normalizedResults.filter(action => {
          let method = action.method;
          return method?.toUpperCase() === "GET";
        });
      } else if (permissions === "write") {
        // Filter for POST, PUT, PATCH methods
        filteredByPermissions = normalizedResults.filter(action => {
          let method = action.method?.toUpperCase();
          return method === "POST" || method === "PUT" || method === "PATCH";
        });
      }
      // For "admin" or no permissions set, return all actions (no filtering)

      // Filter actions if actions array is provided
      if (actions?.length) {
        return filteredByPermissions.filter(action =>
          actions.includes(action._id)
        );
      }

      return filteredByPermissions;
    } catch (error) {
      console.error("Error fetching all available actions:", error);
      throw new Error("Failed to fetch all available actions");
    }
  }

  public async getAvailablePicaConnectors() {
    await this.initializeConnectionDefinitions();
    return this.connectionDefinitions;
  }

  public async getAvailableConnectors(platform?: string) {
    await this.initializeConnections(platform, this.options?.connectors);
    return this.connections;
  }

  private async getSingleAction(actionId: string): Promise<AvailableActions> {
    try {
      const normalizedActionId = normalizeActionId(actionId);
      const response = await axios.get<{
        rows: AvailableActions[],
        total: number,
        skip: number,
        limit: number
      }>(
        `${this.availableActionsUrl}?_id=${normalizedActionId}`,
        { headers: this.generateHeaders() }
      );

      if (!response.data.rows || response.data.rows.length === 0) {
        throw new Error(`Action with ID ${normalizedActionId} not found`);
      }

      return response.data.rows[0];
    } catch (error) {
      console.error("Error fetching single action:", error);
      throw new Error("Failed to fetch action");
    }
  }

  private async getAvailableActions(platform: string) {
    try {
      const allActions = await this.getAllAvailableActions(platform, this.options?.actions);
      return {
        total: allActions.length,
        actions: allActions
      };
    } catch (error) {
      console.error("Error fetching available actions:", error);
      throw new Error("Failed to fetch available actions");
    }
  }

  private async executePassthrough(
    actionId: string,
    connectionKey: string,
    data: any,
    path: string,
    method?: string,
    queryParams?: Record<string, string | number | boolean>,
    headers?: Record<string, string | number | boolean>,
    isFormData?: boolean,
    isFormUrlEncoded?: boolean,
    returnRequestConfigWithoutExecution?: boolean
  ): Promise<{
    executed: boolean;
    responseData: unknown;
    requestConfig: RequestConfig;
  } | {
    executed: false;
    requestConfig: RequestConfig;
  }> {
    try {
      const allHeaders = {
        ...this.generateHeaders(),
        'x-pica-connection-key': connectionKey,
        'x-pica-action-id': actionId,
        ...(isFormData ? { 'Content-Type': 'multipart/form-data' } : {}),
        ...(isFormUrlEncoded ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...headers
      };

      // Remove Content-Type header if no data is being sent
      const finalHeaders = !data
        ? Object.entries(allHeaders)
          .filter(([key]) => key.toLowerCase() !== 'content-type')
          .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
        : allHeaders;

      const url = `${this.baseUrl}/v1/passthrough${path.startsWith('/') ? path : '/' + path}`;

      const requestConfig: RequestConfig = {
        url,
        method,
        headers: finalHeaders,
        params: queryParams
      };

      if (method?.toLowerCase() !== 'get') {
        if (isFormData) {
          const formData = new FormData();

          if (data && typeof data === 'object' && !Array.isArray(data)) {
            Object.entries(data).forEach(([key, value]) => {
              if (typeof value === 'object') {
                formData.append(key, JSON.stringify(value));
              } else {
                formData.append(key, value);
              }
            });
          }

          requestConfig.data = formData;

          Object.assign(requestConfig.headers, formData.getHeaders());
        } else if (isFormUrlEncoded) {
          const params = new URLSearchParams();

          if (data && typeof data === 'object' && !Array.isArray(data)) {
            Object.entries(data).forEach(([key, value]) => {
              if (typeof value === 'object') {
                params.append(key, JSON.stringify(value));
              } else {
                params.append(key, String(value));
              }
            });
          }

          requestConfig.data = params;
        } else {
          requestConfig.data = data;
        }
      }

      if (returnRequestConfigWithoutExecution) {
        requestConfig.headers['x-pica-secret'] = "YOUR_PICA_SECRET_KEY_HERE";

        return {
          executed: false,
          requestConfig
        };
      }

      const response = await axios(requestConfig);

      requestConfig.headers['x-pica-secret'] = "****REDACTED****";

      return {
        executed: true,
        responseData: response.data,
        requestConfig
      };
    } catch (error) {
      console.error("Error executing passthrough:", error);
      throw error;
    }
  }

  private getPromptToConnectPlatformTool() {
    return {
      promptToConnectPlatform: {
        description: "Prompt the user to connect to a platform that they do not currently have access to",
        parameters: z.object({
          platformName: z.string(),
        }),
        execute: async ({ platformName }: { platformName: string }) => {
          return {
            response: platformName
          };
        }
      }
    }
  }

  get intelligenceTool() {
    const baseTool = {
      getAvailableActions: this.oneTool.getAvailableActions,
      getActionKnowledge: this.oneTool.getActionKnowledge,
      execute: {
        description: "Return a request config to the Pica Passthrough API without executing the action. Show the user a typescript code block to make an HTTP request to the Pica Passthrough API using the request config.",
        parameters: z.object({
          platform: z.string(),
          action: z.object({
            _id: z.string(),
            path: z.string()
          }),
          method: z.string(),
          connectionKey: z.string(),
          data: z.any(),
          pathVariables: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
          queryParams: z.record(z.any()).optional(),
          headers: z.record(z.any()).optional(),
          isFormData: z.boolean().optional(),
          isFormUrlEncoded: z.boolean().optional(),
        }),
        execute: async (params: {
          platform: string;
          action: {
            _id: string;
            path: string;
          };
          method: string;
          connectionKey: string;
          data?: any;
          pathVariables?: Record<string, string | number | boolean>;
          queryParams?: Record<string, any>;
          headers?: Record<string, any>;
          isFormData?: boolean;
          isFormUrlEncoded?: boolean;
        }) => {
          try {
            if (!this.connections.some(conn => conn.key === params.connectionKey) && this.useAuthkit) {
              throw new Error(`Connection not found. Please add a ${params.platform} connection first.`);
            }

            // Handle path variables
            const templateVariables = params.action.path.match(/\{\{([^}]+)\}\}/g);
            let resolvedPath = params.action.path;

            if (templateVariables) {
              const requiredVariables = templateVariables.map(v => v.replace(/\{\{|\}\}/g, ''));
              const combinedVariables = {
                ...(Array.isArray(params.data) ? {} : (params.data || {})),
                ...(params.pathVariables || {})
              };

              const missingVariables = requiredVariables.filter(v => !combinedVariables[v]);

              if (missingVariables.length > 0) {
                throw new Error(
                  `Missing required path variables: ${missingVariables.join(', ')}. ` +
                  `Please provide values for these variables.`
                );
              }

              // Clean up data object and prepare path variables
              if (!Array.isArray(params.data)) {
                requiredVariables.forEach(v => {
                  if (params.data && params.data[v] && (!params.pathVariables || !params.pathVariables[v])) {
                    if (!params.pathVariables) params.pathVariables = {};
                    params.pathVariables[v] = params.data[v];
                    delete params.data[v];
                  }
                });
              }

              resolvedPath = replacePathVariables(params.action.path, params.pathVariables || {});
            }

            const normalizedActionId = normalizeActionId(params.action._id);
            // Execute the passthrough request with all components
            const result = await this.executePassthrough(
              normalizedActionId,
              params.connectionKey,
              params.data,
              resolvedPath,
              params.method,
              params.queryParams,
              params.headers,
              params.isFormData,
              params.isFormUrlEncoded,
              true
            );

            return {
              success: true,
              title: "Request config returned",
              message: "Request config returned without execution",
              raw: JSON.stringify(result.requestConfig)
            };
          } catch (error: any) {
            console.error("Error creating request config:", error);
            return {
              success: false,
              title: "Failed to create request config",
              message: error.message,
              raw: JSON.stringify(error?.response?.data || error)
            };
          }
        }
      }
    };

    // Add the promptToConnectPlatform tool if authkit is enabled
    if (this.useAuthkit) {
      return {
        ...baseTool,
        ...this.getPromptToConnectPlatformTool()
      };
    }

    return baseTool;
  }

  get oneTool() {
    const baseTool = {
      getAvailableActions: {
        description: "Get available actions for a specific platform",
        parameters: z.object({
          platform: z.string(),
        }),
        execute: async (params: {
          platform: string;
        }) => {
          try {
            const availableActions = await this.getAvailableActions(params.platform);

            const simplifiedActions = availableActions.actions.map(action => ({
              _id: action._id,
              title: action.title,
              tags: action.tags,
            }));

            return {
              success: true,
              actions: simplifiedActions,
              platform: params.platform,
              content: `Found ${simplifiedActions.length} available actions for ${params.platform}`
            };
          } catch (error: any) {
            console.error("Error getting available actions:", error);
            return {
              success: false,
              title: "Failed to get available actions",
              message: error.message,
              raw: JSON.stringify(error?.response?.data || error)
            };
          }
        },
      },
      getActionKnowledge: {
        description: "Get full action details including knowledge documentation for a specific action",
        parameters: z.object({
          platform: z.string(),
          actionId: z.string(),
        }),
        execute: async (params: {
          platform: string;
          actionId: string;
        }) => {
          try {
            const normalizedActionId = normalizeActionId(params.actionId);
            const action = await this.getSingleAction(normalizedActionId);

            return {
              success: true,
              action,
              platform: params.platform,
              content: `Found knowledge for action: ${action.title}`
            };
          } catch (error: any) {
            console.error("Error getting action knowledge:", error);
            return {
              success: false,
              title: "Failed to get action knowledge",
              message: error.message,
              raw: JSON.stringify(error?.response?.data || error)
            };
          }
        }
      },
      execute: {
        description: "Execute a specific action using the passthrough API",
        parameters: z.object({
          platform: z.string(),
          action: z.object({
            _id: z.string(),
            path: z.string()
          }),
          method: z.string(),
          connectionKey: z.string(),
          data: z.any(),
          pathVariables: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
          queryParams: z.record(z.any()).optional(),
          headers: z.record(z.any()).optional(),
          isFormData: z.boolean().optional(),
          isFormUrlEncoded: z.boolean().optional(),
        }),
        execute: async (params: {
          platform: string;
          action: {
            _id: string;
            path: string;
          };
          method: string;
          connectionKey: string;
          data?: any;
          pathVariables?: Record<string, string | number | boolean>;
          queryParams?: Record<string, any>;
          headers?: Record<string, any>;
          isFormData?: boolean;
          isFormUrlEncoded?: boolean;
        }) => {
          try {
            if (!this.connections.some(conn => conn.key === params.connectionKey)) {
              throw new Error(`Connection not found. Please add a ${params.platform} connection first.`);
            }

            const normalizedActionId = normalizeActionId(params.action._id);
            const fullAction = await this.getSingleAction(normalizedActionId);

            // Handle path variables
            const templateVariables = params.action.path.match(/\{\{([^}]+)\}\}/g);
            let resolvedPath = params.action.path;

            if (templateVariables) {
              const requiredVariables = templateVariables.map(v => v.replace(/\{\{|\}\}/g, ''));
              const combinedVariables = {
                ...(Array.isArray(params.data) ? {} : (params.data || {})),
                ...(params.pathVariables || {})
              };

              const missingVariables = requiredVariables.filter(v => !combinedVariables[v]);

              if (missingVariables.length > 0) {
                throw new Error(
                  `Missing required path variables: ${missingVariables.join(', ')}. ` +
                  `Please provide values for these variables.`
                );
              }

              // Clean up data object and prepare path variables
              if (!Array.isArray(params.data)) {
                requiredVariables.forEach(v => {
                  if (params.data && params.data[v] && (!params.pathVariables || !params.pathVariables[v])) {
                    if (!params.pathVariables) params.pathVariables = {};
                    params.pathVariables[v] = params.data[v];
                    delete params.data[v];
                  }
                });
              }

              resolvedPath = replacePathVariables(params.action.path, params.pathVariables || {});
            }

            // Execute the passthrough request with all components
            const result = await this.executePassthrough(
              normalizedActionId,
              params.connectionKey,
              params.data,
              resolvedPath,
              params.method,
              params.queryParams,
              params.headers,
              params.isFormData,
              params.isFormUrlEncoded,
              false
            );

            return {
              success: true,
              data: result.executed ? result.responseData : undefined,
              connectionKey: params.connectionKey,
              platform: params.platform,
              action: fullAction.title,
              requestConfig: result.requestConfig,
              content: `Executed ${fullAction.title} via ${params.platform}`,
            };
          } catch (error: any) {
            console.error("Error executing action:", error);
            return {
              success: false,
              title: "Failed to execute action",
              message: error.message,
              raw: JSON.stringify(error?.response?.data || error)
            };
          }
        }
      }
    };

    // Add the promptToConnectPlatform tool if authkit is enabled
    if (this.useAuthkit) {
      return {
        ...baseTool,
        ...this.getPromptToConnectPlatformTool()
      };
    }

    return baseTool;
  }
}
