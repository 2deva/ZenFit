/**
 * Tool Middleware Service
 * 
 * Centralizes logic for intercepting and enhancing tool calls from Gemini.
 * Decouples specific feature logic (like Voice Options) from the main connection hook.
 */

import { enhanceWithVoiceOptions } from './voiceOptionsGenerator';
import { SelectionOption } from '../types';

export interface ToolProcessingResult {
    type: string;
    props: any;
    voiceOptions?: SelectionOption[];
    wasEnhanced: boolean;
}

/**
 * Process a tool call through registered interceptors.
 * Currently supports:
 * 1. Voice Option Injection (for renderUI)
 */
export function processToolInterceptors(toolName: string, args: any): ToolProcessingResult {
    const result: ToolProcessingResult = {
        type: args.type,
        props: args.props,
        wasEnhanced: false
    };

    try {
        // Interceptor: UI Voice Options
        if (toolName === 'renderUI' && args.type && args.props) {
            // Check if voice options are missing
            const existingOptions = args.props.voiceOptions;

            if (!existingOptions || existingOptions.length === 0) {
                const enhanced = enhanceWithVoiceOptions(args.type, args.props);

                // Only apply if enhancement actually occurred
                if (enhanced.voiceOptions && enhanced.voiceOptions.length > 0) {
                    result.props = enhanced.props;
                    result.voiceOptions = enhanced.voiceOptions;
                    result.wasEnhanced = true;
                }
            } else {
                // Pass through existing options if Gemini generated them
                result.voiceOptions = existingOptions;
            }
        }
    } catch (error) {
        console.warn('ToolMiddleware: Error in interceptor chain', error);
        // Return original result on error to prevent breaking the flow
    }

    return result;
}
