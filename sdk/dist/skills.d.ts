import { SafeFlowAgent } from './agent.js';
/**
 * Interface for an OpenClaw or generic agent tool
 */
export interface AgentTool {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, any>;
        required: string[];
    };
    execute: (args: any) => Promise<any>;
}
/**
 * Creates an OpenClaw compatible tool for executing SafeFlow payments
 */
export declare function createSafeFlowSkill(agent: SafeFlowAgent): AgentTool;
