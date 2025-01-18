import axios from "axios";
import { z } from "zod";
import { Pica as PicaUnified } from "@picahq/unified";

import { ConnectionData, ManageEntityParams } from "./types/connection";

export type EntityTypes = Exclude<keyof PicaUnified, 'axiosInstance' | 'passthrough'>;

// Map our tool operations to API supported actions
const OPERATION_TO_ACTION_MAP = {
  'create': 'create',
  'update': 'update',
  'delete': 'delete',
  'list': 'getMany',
  'get': 'getOne',
  'count': 'getCount'
} as const;

export class Pica {
  private secret: string;
  private integrate: PicaUnified;
  private connections: any;
  private systemPromptValue: string;
  private initialized: Promise<void>;
  private modelMappings: Array<{ platform: string; modelMappings: any[] }> = [];

  private baseUrl = "https://api.picaos.com";
  private requiredFieldsUrl = `${this.baseUrl}/required-platform-fields`;
  private connectionDataModelsUrl = `${this.baseUrl}/v1/public/connection-data/models`;
  private getConnectionUrl = `${this.baseUrl}/v1/vault/connections?limit=200`;
  private connectionDefinitionsUrl = `${this.baseUrl}/v1/public/connection-definitions?limit=100`;

  constructor(secret: string) {
    this.secret = secret;
    this.integrate = new PicaUnified(this.secret, {
      serverUrl: `${this.baseUrl}/v1`
    });
    this.connections = [];
    this.systemPromptValue = this.getDefaultSystemPrompt('Loading connections...', []);

    this.initialized = this.initialize()
      .then(() => {
        const connectionsInfo = this.connections.length > 0
          ? this.connections
            .map((conn: any) => `${conn.platform} - Key: ${conn.key}`)
            .join('\n\t\t\t* ')
          : 'No connections available';

        this.systemPromptValue = this.getDefaultSystemPrompt(connectionsInfo, this.modelMappings);
      })
      .catch(error => {
        console.error('Error during initialization:', error);
        this.systemPromptValue = this.getDefaultSystemPrompt('Error loading connections', []);
      });
  }

  async generateSystemPrompt(userSystemPrompt?: string): Promise<string> {
    await this.waitForInitialization();

    if (!userSystemPrompt) {
      return `You are Pica (picaos.com), a unified integration assistant. You can instantly connect AI agents to 100+ APIs.

--- Tools Information ---
${this.system.trim()}`;
    }

    return `${userSystemPrompt.trim()}

=== PICA: UNIFIED INTEGRATION ASSISTANT ===
Everything below is for Pica (picaos.com), your unified integration assistant that can instantly connect your AI agents to 100+ APIs.

--- Tools Information ---
${this.system.trim()}`;
  }

  private async initialize() {
    await Promise.all([
      this.initializeConnections(),
      this.initializeModels()
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

  private async initializeModels() {
    try {
      const headers = this.generateHeaders();
      const response = await axios.get(this.connectionDefinitionsUrl, { headers });
      const platforms = response?.data?.rows?.map((conn: {
        platform: string;
      }) => conn?.platform?.split("::")[0]);

      const uniquePlatforms = [...new Set(platforms)] as string[];
      this.modelMappings = await Promise.all(
        uniquePlatforms.map(async (platform) => {
          try {
            const modelData = await axios.get(`${this.connectionDataModelsUrl}/${platform.toLowerCase()}`);
            return {
              platform,
              modelMappings: modelData.data
            };
          } catch (error) {
            console.error(`Error fetching models for ${platform}:`, error);
            return {
              platform,
              modelMappings: []
            };
          }
        })
      );
      this.modelMappings = this.modelMappings.filter(mapping => mapping.modelMappings.length > 0);
    } catch (error) {
      console.error("Failed to initialize models:", error);
      this.modelMappings = [];
    }
  }

  private getDefaultSystemPrompt(connectionsInfo: string, modelMappings: Array<{ platform: string; modelMappings: any[] }>) {
    const modelInfo = modelMappings.map(({ platform, modelMappings }) => {
      const mappingDetails = modelMappings
        .map(mapping => `\t\t\t\t- ${mapping.commonModel} (maps to third party model named ${mapping.platformModel})`)
        .join('\n');
      return `\t\t\t* ${platform}:\n${mappingDetails}`;
    }).join('\n');

    const prompt = `\
      - you are a powerful integration assistant that can help with various operations
      - your responses are concise and professional
      - you can handle both text and voice commands
      - you have access to the following capabilities:
        * Manage entities (list, get, create, update, delete, count)
        * Execute actions with models and connections
      - For entity operations, use "manageEntity" with:
        * operation: "list", "get", "create", "update", "delete", or "count"
        * For create/update operations, all fields must be passed in an object called "data"
        * Required fields can be fetched using "getRequiredFields"
      - When users ask about platform capabilities, ALWAYS use manageEntity to get real-time information:
        * For questions about supported actions
        * For questions about platform-specific caveats or considerations
        * For questions about filtering, sorting, or pagination capabilities
        * NEVER guess or assume platform capabilities - always fetch the actual data
      - Always use lowercase, plural form for entity types (e.g., "products", "customers", "orders")
      - Handle errors gracefully and provide clear feedback
      - Important notes:
        * Connections can only be deleted through the Pica dashboard
        * Available connections (only show the latest 5 connections and tell the user to ask for more for a platform if they need them):
        * ${connectionsInfo}
        \n\n
        * Available model mappings by platform (only show the platform name in proper case and number of models available and tell them to ask for more details if they need them):
${modelInfo}
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

  private async getRequiredFields(entityType: string, platform: string) {
    try {
      const response = await axios.get(this.requiredFieldsUrl);
      const requiredFieldsMap = response.data;

      const requiredFields = (requiredFieldsMap[entityType]?.[platform] || []) as string[];

      return requiredFields;
    } catch (error) {
      console.error("Error fetching required fields:", error);
      throw new Error("Failed to fetch required fields");
    }
  }

  private async getConnectionData(entityType: string, platform: string): Promise<ConnectionData | null> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v1/public/connection-data/${entityType}/${platform}`,
        { headers: this.generateHeaders() }
      );

      return response.data;
    } catch (error) {
      console.error("Error fetching connection data:", error);
      return null;
    }
  }

  get oneTool() {
    return {
      manageEntity: {
        description: "Unified tool for managing entities (list, get, create, update, delete, count)",
        parameters: z.object({
          operation: z.enum(['list', 'get', 'create', 'update', 'delete', 'count', 'capabilities']),
          entityType: z.string(),
          connectionKey: z.string(),
          id: z.string().optional(),
          data: z.record(z.any()).optional(),
          filters: z.object({
            limit: z.number().optional(),
            createdAfter: z.string().optional(),
            createdBefore: z.string().optional(),
            updatedAfter: z.string().optional(),
            updatedBefore: z.string().optional(),
          }).optional(),
        }),
        execute: async (params: ManageEntityParams) => {
          try {
            const { operation, entityType, connectionKey, id, data, filters } = params;

            // Get platform from connectionKey (format is test::platform::default::hash)
            const platform = connectionKey.split('::')[1];
            if (!platform) {
              throw new Error('Invalid connection key format');
            }

            const connectionData = await this.getConnectionData(entityType, platform);
            const isCapabilityInfoRequest = operation === 'capabilities';

            if (isCapabilityInfoRequest && connectionData) {
              return {
                data: connectionData,
                content: `Successfully fetched capabilities for ${entityType} in ${platform}.`
              };
            }

            const integrationInstance = this.integrate[entityType.toLowerCase() as EntityTypes](connectionKey);
            if (!integrationInstance) {
              throw new Error(`Invalid entity type: ${entityType}`);
            }

            if (connectionData) {
              // Only check operation support for actual operations (not capabilities)
              if (!isCapabilityInfoRequest) {
                const apiAction = OPERATION_TO_ACTION_MAP[operation as keyof typeof OPERATION_TO_ACTION_MAP];
                if (!apiAction || !connectionData.supportedActions.includes(apiAction)) {
                  throw new Error(`Operation ${operation} is not supported for ${entityType} in ${platform}`);
                }
              }

              // Add caveats to response if they exist
              const caveats = connectionData.caveats?.length > 0
                ? ` Note: ${connectionData.caveats.map(c => JSON.stringify(c)).join(', ')}`
                : '';

              // Store connection metadata to be included in responses
              params.connectionMetadata = { caveats };
            }

            let response;
            switch (operation) {
              case 'list':
                response = await integrationInstance.list(filters || {}, { responsePassthrough: true });
                if (!response?.unified) {
                  throw new Error('No unified response received from the integration');
                }
                return {
                  data: response.unified,
                  content: `Found ${response.unified.length} ${entityType}.`
                };

              case 'get':
                if (!id) throw new Error('ID is required for get operation');
                response = await integrationInstance.get(id, { responsePassthrough: true });
                if (!response?.unified) {
                  throw new Error('No unified response received from the integration');
                }
                return {
                  data: response.unified,
                  content: `Successfully retrieved ${entityType} with ID: ${id}`
                };

              case 'create':
                if (!data) throw new Error('Data is required for create operation');
                response = await integrationInstance.create(data, { responsePassthrough: true });
                if (!response?.unified) {
                  throw new Error('No unified response received from the integration');
                }
                return {
                  data: response.unified,
                  content: `Successfully created ${entityType} with ID: ${response.unified.id}`
                };

              case 'update':
                if (!id) throw new Error('ID is required for update operation');
                if (!data) throw new Error('Data is required for update operation');
                response = await integrationInstance.update(id, data, { responsePassthrough: true });
                if (!response?.meta) {
                  throw new Error('No meta response received from the integration');
                }
                return {
                  data: response.meta,
                  content: `Successfully updated ${entityType} with ID: ${id}`
                };

              case 'delete':
                if (!id) throw new Error('ID is required for delete operation');
                response = await integrationInstance.delete(id);
                if (!response?.meta) {
                  throw new Error('No unified response received from the integration');
                }
                return {
                  data: response.unified,
                  content: `Successfully deleted ${entityType} with ID: ${id}`
                };

              case 'count':
                response = await integrationInstance.count({ responsePassthrough: true });
                if (!response) {
                  throw new Error('No response received from the integration');
                }
                return {
                  data: response,
                  content: `Total ${entityType} count: ${response}`
                };

              default:
                throw new Error(`Unsupported operation: ${operation}`);
            }
          } catch (error: any) {
            console.error(`Error in ${params.operation} operation for ${params.entityType}:`, {
              message: error.message,
              stack: error.stack,
              params
            });
            return {
              error: `Failed to ${params.operation} ${params.entityType}: ${error.message}`,
              content: `Failed to ${params.operation} ${params.entityType}: ${error.message}`
            };
          }
        },
      },

      getRequiredFields: {
        description: "Get required fields for a specific entity type and platform",
        parameters: z.object({
          entityType: z.string(),
          platform: z.string(),
          data: z.record(z.any()).optional(),
        }),
        execute: async (params: { entityType: string; platform: string; data?: Record<string, any> }) => {
          try {
            const requiredFields = await this.getRequiredFields(params.entityType, params.platform);

            return {
              data: {
                requiredFields,
              },
              content: `Required fields for ${params.entityType} in ${params.platform}: ${requiredFields.join(', ')}`
            };
          } catch (error: any) {
            console.error("Error getting required fields:", error);
            return {
              error: `Failed to get required fields: ${error.message}`,
              content: `Failed to get required fields: ${error.message}`
            };
          }
        },
      },
    };
  }
}