import axios from "axios";
import { z } from "zod";
import FormData from 'form-data';

import {
  AvailableActions,
  RequestConfig,
  ConnectionDefinition,
  Connection
} from "./types/connection";

interface PicaOptions {
  connectors?: string[];
  serverUrl?: string;
}

export class Pica {
  private secret: string;
  private connections: Connection[];
  private connectionDefinitions: ConnectionDefinition[];
  private systemPromptValue: string;
  private initialized: Promise<void>;

  private baseUrl = "https://api.picaos.com";
  private getConnectionUrl;
  private availableActionsUrl;
  private getConnectionDefinitionsUrl;

  constructor(secret: string, options?: PicaOptions) {
    this.secret = secret;
    this.connections = [];
    this.connectionDefinitions = [];
    this.systemPromptValue = this.getDefaultSystemPrompt('Loading connections...');

    if (options?.serverUrl) {
      this.baseUrl = options.serverUrl;
    }

    this.getConnectionUrl = `${this.baseUrl}/v1/vault/connections?limit=300`;
    this.availableActionsUrl = `${this.baseUrl}/v1/knowledge`;
    this.getConnectionDefinitionsUrl = `${this.baseUrl}/v1/public/connection-definitions?limit=500`;
    this.initialized = this.initialize()
      .then(() => {
        let filteredConnections = this.connections.filter((conn: any) => conn.active);

        if (options?.connectors) {
          filteredConnections = filteredConnections.filter((conn: any) =>
            options.connectors!.includes(conn.key)
          );
        }

        const connectionsInfo = filteredConnections.length > 0
          ? '\t* ' + filteredConnections
            .map((conn: any) => `${conn.platform} - Key: ${conn.key}`)
            .join('\n\t* ')
          : 'No connections available';

        const availablePlatformsInfo = this.connectionDefinitions.map((def) =>
          `\n\t* ${def.platform} (${def.frontend.spec.title})`
        ).join('');

        this.systemPromptValue = this.getDefaultSystemPrompt(connectionsInfo, availablePlatformsInfo);
      })
      .catch(error => {
        console.error('Error during initialization:', error);
        this.systemPromptValue = this.getDefaultSystemPrompt('Error loading connections');
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

  private async initializeConnections() {
    try {
      const headers = this.generateHeaders();

      const response = await axios.get(this.getConnectionUrl, { headers });
      this.connections = response.data?.rows || [];
    } catch (error) {
      console.error("Failed to initialize connections:", error);
      this.connections = [];
    }
  }

  private async initializeConnectionDefinitions() {
    try {
      const headers = this.generateHeaders();
      const response = await axios.get(this.getConnectionDefinitionsUrl, { headers });
      this.connectionDefinitions = response.data?.rows || [];
    } catch (error) {
      console.error("Failed to initialize connection definitions:", error);
      this.connectionDefinitions = [];
    }
  }

  private getDefaultSystemPrompt(connectionsInfo: string, availablePlatformsInfo?: string) {
    const prompt = `\
IMPORTANT: ALWAYS START BY LISTING AVAILABLE ACTIONS FOR THE PLATFORM!
Before attempting any operation, you must first discover what actions are available.

PLATFORM COMMITMENT:
- You can freely list and explore actions across ANY platform
- If a platform has no connection:
  * You can still list and describe its available actions
  * But you must inform the user they need to add a connection from the Pica Dashboard (https://app.picaos.com/connections)
  * Example: "I can tell you about Gmail's actions, but you'll need to add a Gmail connection from the Pica Dashboard to execute them"
- However, once you START EXECUTING an action:
  1. The platform MUST have an active connection
  2. You MUST complete the entire workflow with that platform
  3. Only consider other platforms after completing the current execution
- If you need multiple platforms to complete a task:
  1. First complete the entire execution workflow with the primary platform
  2. Then explain to the user that you'll need another platform
  3. Start a new execution workflow with the second platform
- Example: For "Send an email with a joke":
  * CORRECT: List Gmail actions -> Get email action knowledge -> Execute email action (with static joke)
  * INCORRECT: List Gmail actions -> Start email execution -> Switch to OpenAI mid-flow
- Example: For "What actions are available in Gmail and Slack?":
  * CORRECT: List Gmail actions -> List Slack actions -> Discuss both
  * No commitment needed because we're just exploring

Your capabilities must be used in this exact sequence FOR EACH EXECUTION:

1. LIST AVAILABLE ACTIONS (ALWAYS FIRST)
  - Command: getAvailableActions
  - Purpose: Get a simple list of available actions for a platform
  - Usage: This must be your first step for ANY user request
  - When to use: BEFORE attempting any other operation
  - Note: Can be used for ANY platform, even without a connection
  - Output: Returns a clean list of action titles and IDs
  - Presentation: Present actions naturally and efficiently:
    * Group related actions together and present them concisely
    * Example: Instead of listing separately, group as "Manage workflow permissions (add/remove/view)"
    * Remove redundant words and technical jargon
    * Keep responses concise and group similar functionality
    * Use natural, conversational language that feels fluid
    * If no connection exists, explain how to add one
    * When listing actions, always order them by the actions with the featured tag first

2. GET ACTION DETAILS (ALWAYS SECOND)
  - Command: getActionKnowledge
  - Purpose: Fetch full details and knowledge documentation for a specific action
  - When to use: After finding the appropriate action ID from step 1
  - Required: Must have action ID from getAvailableActions first
  - Note: Can be used to explore actions even without a connection
  - Output: Returns complete action object with:
    * Knowledge documentation
    * Required fields and their types
    * Path information
    * HTTP method
    * Constraints and validation rules

3. EXECUTE ACTIONS (ALWAYS LAST)
  - Command: execute
  - Purpose: Execute specific platform actions through the passthrough API
  - When to use: Only after completing steps 1 and 2
  - Required: MUST have an active connection from the Pica Dashboard (Verify in the IMPORTANT GUIDELINES section)
  - Required Parameters:
    * platform: The target platform
    * action: The action object with { _id, path }
    * connectionKey: The connection key for authentication
    * data: The request payload (optional)
    * pathVariables: Values for path variables (if needed)
    * queryParams: Query parameters (if needed)
    * isFormData: Set to true to send data as multipart/form-data
    * isFormUrlEncoded: Set to true to send data as application/x-www-form-urlencoded

WORKFLOW (MUST FOLLOW THIS ORDER FOR EACH PLATFORM):
1. For ANY user request:
  a. FIRST: Call getAvailableActions to list what's possible
  b. THEN: Identify the appropriate action from the list
  c. NEXT: Call getActionKnowledge to get full details
  d. NEXT: Verify that the connection exists in the available connections list below in the IMPORTANT GUIDELINES section
  e. FINALLY: Execute with proper parameters
  f. Only after completing all steps, consider if another platform is needed

2. Knowledge Parsing:
  - After getting knowledge, analyze it to understand:
    * Required data fields and their format
    * Required path variables
    * Required query parameters
    * Any constraints and validation rules
  - Only ask the user for information that:
    * Is not in the knowledge documentation
    * Requires user choice or input
    * Cannot be determined automatically
  - Important: Do not read the knowledge documentation to the user, just use it to guide your actions

3. Error Prevention:
  - Never try to execute without first listing actions
  - Never assume action IDs - they must come from getAvailableActions
  - Never switch platforms mid-flow - complete the current platform first
  - Validate all input against knowledge documentation
  - Provide clear, actionable error messages

Best Practices:
- Always start with getAvailableActions - no exceptions
- Complete all steps with one platform before moving to another
- Parse knowledge documentation before asking users for input
- Use examples from knowledge documentation to guide users
- Maintain a professional and efficient communication style
- After every invocation of the execute tool, you must follow it up with a consise summary of the action that was executed and the result
- Important: Always load the knowledge needed to provide the best user experience.
- If you need to execute an action for a platform that has no connection, you must first prompt the user to add a connection from the Pica Dashboard (https://app.picaos.com/connections)
- Speak in the second person, as if you are directly addressing the user.
- Avoid using technical jargon and explain in simple terms using natural language.
- Do not read the knowledge documentation to the user, just use it to guide your actions.
- Do not confirm with the user to proceed with the action if you already have all the information you need.

Remember:
- Before executing an action, you MUST first verify that the connection exists in the access list below in the IMPORTANT GUIDELINES section
- You can explore ANY platform's actions, even without a connection
- Connections must be added through the Pica Dashboard (https://app.picaos.com/connections)
- Security is paramount - never expose or request sensitive credentials
- Handle all {{variables}} in paths before execution
- Complete one platform's workflow before starting another

IMPORTANT GUIDELINES:
- You have access to execute actions only for the following connections (only show the latest 5 connections and tell the user to ask for more for a platform if they need them):
${connectionsInfo}

- Here are the proper platform names (according to Pica) to use for tools:
${availablePlatformsInfo}
`;

    return prompt;
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
    isFormUrlEncoded?: boolean
  ): Promise<{
    responseData: unknown;
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

      const response = await axios(requestConfig);

      return {
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

  get oneTool() {
    return {
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
              params.isFormUrlEncoded
            );

            return {
              success: true,
              data: result.responseData,
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
  }
}