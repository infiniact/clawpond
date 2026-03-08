/**
 * Mention parsing utilities for @ mentions in chat messages.
 */

import type { GatewayInfo } from "./rpc-pool";

/**
 * Parse @GatewayName mentions from text and return matching gateway IDs.
 * Matches @Name where Name is a gateway name (case-insensitive).
 */
export function parseMentions(text: string, gateways: GatewayInfo[]): string[] {
  const mentionRegex = /@(\S+)/g;
  const mentionedIds: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    const mentionName = match[1].toLowerCase();
    const gateway = gateways.find(
      (g) => g.name.toLowerCase() === mentionName
    );
    if (gateway && !mentionedIds.includes(gateway.id)) {
      mentionedIds.push(gateway.id);
    }
  }

  return mentionedIds;
}

/**
 * Extract the message content to forward to a mentioned gateway.
 * Strips all @mentions from the text and returns the remaining content.
 */
export function extractMentionContent(text: string, gateways: GatewayInfo[]): string {
  // Remove all @GatewayName patterns that match known gateways
  let result = text;
  for (const gw of gateways) {
    const regex = new RegExp(`@${escapeRegex(gw.name)}\\b`, "gi");
    result = result.replace(regex, "");
  }
  return result.trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Render text with @mentions highlighted.
 * Returns segments: plain text and mention spans.
 */
export type MentionSegment =
  | { type: "text"; content: string }
  | { type: "mention"; name: string; gatewayId: string };

export function segmentMentions(text: string, gateways: GatewayInfo[]): MentionSegment[] {
  const segments: MentionSegment[] = [];
  const mentionRegex = /@(\S+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    const mentionName = match[1];
    const gateway = gateways.find(
      (g) => g.name.toLowerCase() === mentionName.toLowerCase()
    );

    if (gateway) {
      // Add text before this mention
      if (match.index > lastIndex) {
        segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
      }
      segments.push({ type: "mention", name: gateway.name, gatewayId: gateway.id });
      lastIndex = match.index + match[0].length;
    }
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments;
}
