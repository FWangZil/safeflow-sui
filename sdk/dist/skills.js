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
                },
                reasoning: {
                    type: 'string',
                    description: 'Human-readable reasoning text that will be uploaded to Walrus when walrusBlobId is omitted'
                },
                context: {
                    type: 'object',
                    description: 'Optional structured context attached to the Walrus reasoning payload'
                },
                walrusConfig: {
                    type: 'object',
                    description: 'Optional Walrus endpoint overrides (publisherUrl, aggregatorUrl, epochs, timeoutMs, apiKey)'
                }
            },
            required: ['walletId', 'sessionCapId', 'recipient', 'amount']
        },
        execute: async (args) => {
            console.log(`[SafeFlow Skill] Executing payment of ${args.amount} MIST to ${args.recipient}...`);
            try {
                const hasExplicitBlob = typeof args.walrusBlobId === 'string' && args.walrusBlobId.length > 0;
                const hasReasoningInput = typeof args.reasoning === 'string' || args.context !== undefined || args.walrusConfig !== undefined;
                const result = hasExplicitBlob
                    ? await agent.executePayment(args.walletId, args.sessionCapId, args.recipient, args.amount, args.walrusBlobId)
                    : hasReasoningInput
                        ? await agent.executePaymentWithEvidence({
                            walletId: args.walletId,
                            sessionCapId: args.sessionCapId,
                            recipient: args.recipient,
                            amount: args.amount,
                            reasoning: args.reasoning,
                            context: args.context,
                            walrusConfig: args.walrusConfig,
                        })
                        : await agent.executePayment(args.walletId, args.sessionCapId, args.recipient, args.amount, '');
                return {
                    success: true,
                    digest: result.digest,
                    walrusBlobId: hasExplicitBlob ? args.walrusBlobId : result.walrusBlobId,
                    uploadStatus: hasReasoningInput ? result.uploadStatus : 'provided',
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
