import { TickpayAgent } from './agent.js';
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
 * Creates an OpenClaw compatible tool for executing Tickpay payments
 */
export declare function createTickpaySkill(agent: TickpayAgent): AgentTool;
