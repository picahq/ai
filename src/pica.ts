import axios from "axios";
import { z } from "zod";
import FormData from 'form-data';

import {
  AvailableActions,
  RequestConfig,
  ConnectionDefinition,
  Connection
} from "./types/connection";
import { getDefaultSystemPrompt } from "./prompts/defaultSystem";
import { getDefaultSystemWithAuthkitPrompt } from "./prompts/defaultSystemWithAuthkit";
import { getKnowledgeAgentSystemPrompt } from "./prompts/knowledgeAgentSystem";
import { getKnowledgeAgentWithAuthkitSystemPrompt } from "./prompts/knowledgeAgentWithAuthkitSystem";

interface PicaOptions {
  connectors?: string[];
  serverUrl?: string;
  identity?: string;
  identityType?: "user" | "team" | "organization" | "project";
  authkit?: boolean;
  knowledgeAgent?: boolean;
  knowledgeAgentConfig?: KnowledgeAgentConfig;
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

    if (options?.serverUrl) {
      this.baseUrl = options.serverUrl;
    }

    this.getConnectionUrl = `${this.baseUrl}/v1/vault/connections`;
    this.availableActionsUrl = `${this.baseUrl}/v1/knowledge`;
    this.getConnectionDefinitionsUrl = `${this.baseUrl}/v1/available-connectors`;
    this.initialized = this.initialize()
      .then(() => {
        let filteredConnections = this.connections.filter((conn: any) => conn.active);

        if (options?.connectors?.length) {
          if (!options.connectors.includes("*")) {
            filteredConnections = filteredConnections.filter(conn =>
              options.connectors!.includes(conn.key)
            );
          }
        } else {
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
    const prompt = `${userSystemPrompt ? userSystemPrompt + '\n\n' : ''}=== PICA: INTEGRATION ASSISTANT ===
Everything below is for Pica (picaos.com), your integration assistant that can instantly connect your AI agents to 100+ APIs.

Current Time: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})

--- Tools Information ---
${this.system.trim()}
        `;

    return prompt;
  }

  private async initialize() {
    await Promise.all([
      this.initializeConnections(),
      this.initializeConnectionDefinitions(),
    ]);
  }

  async waitForInitialization() {
    await this.initialized;
    return this.system;
  }

  private async initializeConnections(platform?: string) {
    try {
      const headers = this.generateHeaders();

      let baseUrl = `${this.baseUrl}/v1/vault/connections`;

      if (platform) {
        baseUrl += `&platform=${platform}`;
      }

      if (this.identity) {
        baseUrl += `&identity=${encodeURIComponent(this.identity)}`;
      }

      if (this.identityType) {
        baseUrl += `&identityType=${encodeURIComponent(this.identityType)}`;
      }

      const fetchPage = (skip: number, limit: number) =>
        axios.get<{
          rows: Connection[],
          total: number,
          skip: number,
          limit: number
        }>(
          `${baseUrl}?limit=${limit}&skip=${skip}`,
          { headers }
        ).then(response => response.data);

      this.connections = await this.paginateResults<Connection>(fetchPage);
    } catch (error) {
      console.error("Failed to initialize connections:", error);
      this.connections = [];
    }
  }

  private async initializeConnectionDefinitions() {
    try {
      const headers = this.generateHeaders();

      const fetchPage = (skip: number, limit: number) =>
        axios.get<{
          rows: ConnectionDefinition[],
          total: number,
          skip: number,
          limit: number
        }>(
          `${this.baseUrl}/v1/available-connectors?limit=${limit}&skip=${skip}`,
          { headers }
        ).then(response => response.data);

      this.connectionDefinitions = await this.paginateResults<ConnectionDefinition>(fetchPage);
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
    };
  }

  private async paginateResults<T>(
    fetchFn: (skip: number, limit: number) => Promise<{
      rows: T[],
      total: number,
      skip: number,
      limit: number
    }>,
    limit = 100
  ): Promise<T[]> {
    let skip = 0;
    let allResults: T[] = [];
    let total = 0;

    try {
      do {
        const response = await fetchFn(skip, limit);
        const { rows, total: totalCount } = response;
        total = totalCount;
        allResults = [...allResults, ...rows];
        skip += limit;
      } while (allResults.length < total);

      return allResults;
    } catch (error) {
      console.error("Error in pagination:", error);
      throw error;
    }
  }

  private async getAllAvailableActions(platform: string): Promise<AvailableActions[]> {
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

      return await this.paginateResults<AvailableActions>(fetchPage);
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
    await this.initializeConnections(platform);
    return this.connections;
  }

  private async getSingleAction(actionId: string): Promise<AvailableActions> {
    try {
      const response = await axios.get<{
        rows: AvailableActions[],
        total: number,
        skip: number,
        limit: number
      }>(
        `${this.availableActionsUrl}?_id=${actionId}`,
        { headers: this.generateHeaders() }
      );

      if (!response.data.rows || response.data.rows.length === 0) {
        throw new Error(`Action with ID ${actionId} not found`);
      }

      return response.data.rows[0];
    } catch (error) {
      console.error("Error fetching single action:", error);
      throw new Error("Failed to fetch action");
    }
  }

  private async getAvailableActions(platform: string) {
    try {
      const allActions = await this.getAllAvailableActions(platform);
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
      const newHeaders = {
        ...this.generateHeaders(),
        'x-pica-connection-key': connectionKey,
        'x-pica-action-id': actionId,
        ...(isFormData ? { 'Content-Type': 'multipart/form-data' } : {}),
        ...(isFormUrlEncoded ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...headers
      };

      const url = `${this.baseUrl}/v1/passthrough${path.startsWith('/') ? path : '/' + path}`;

      const requestConfig: RequestConfig = {
        url,
        method,
        headers: newHeaders,
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
        requestConfig.headers['x-pica-secret'] = "YOUR_SECRET_KEY_HERE";

        return {
          executed: false,
          requestConfig
        };
      }

      const response = await axios(requestConfig);

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

  private replacePathVariables(path: string, variables: Record<string, string | number | boolean>): string {
    return path.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
      const value = variables[variable];
      if (!value) {
        throw new Error(`Missing value for path variable: ${variable}`);
      }
      return value.toString();
    });
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

              resolvedPath = this.replacePathVariables(params.action.path, params.pathVariables || {});
            }

            // Execute the passthrough request with all components
            const result = await this.executePassthrough(
              params.action._id,
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
            const action = await this.getSingleAction(params.actionId);

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

            const fullAction = await this.getSingleAction(params.action._id);

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

              resolvedPath = this.replacePathVariables(params.action.path, params.pathVariables || {});
            }

            // Execute the passthrough request with all components
            const result = await this.executePassthrough(
              params.action._id,
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
              knowledge: fullAction.knowledge,
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