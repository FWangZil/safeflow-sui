/**
 * Creates an OpenClaw compatible tool for executing SafeFlow payments
 */
export function createSafeFlowSkill(agent) {
    return {
        name: 'execute_safeflow_payment',
        description: 'Executes a streaming payment or recurring payment using a predefined SafeFlow SessionCap on the Sui network. Use this when the user asks to pay someone or transfer funds automatically via their authorized session.',
        parameters: {
            type: 'object',
            properties: {
                walletId: {
                    type: 'string',
                    description: 'The Object ID of the SafeFlow Wallet'
                },
                sessionCapId: {
                    type: 'string',
                    description: 'The Object ID of the SessionCap that authorizes this agent to spend'
                },
                recipient: {
                    type: 'string',
                    description: 'The Sui address of the recipient receiving the payment'
                },
                amount: {
                    type: 'number',
                    description: 'The amount to pay in MIST (1 SUI = 1,000,000,000 MIST)'
                },
                walrusBlobId: {
                    type: 'string',
                    description: 'The Walrus Blob ID containing the payment reason or metadata (optional, can be empty string)'
                }
            },
            required: ['walletId', 'sessionCapId', 'recipient', 'amount']
        },
        execute: async (args) => {
            console.log(`[SafeFlow Skill] Executing payment of ${args.amount} MIST to ${args.recipient}...`);
            try {
                const result = await agent.executePayment(args.walletId, args.sessionCapId, args.recipient, args.amount, args.walrusBlobId || '');
                return {
                    success: true,
                    digest: result.digest,
                    message: `Payment successful. Transaction digest: ${result.digest}`
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error.message,
                    message: 'Payment failed due to an error or rate limit.'
                };
            }
        }
    };
}
