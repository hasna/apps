import type { AnnouncementCampaign, DeliveryChannel, RenderedMessage, ShortenedLink } from "../../types.js";
import { renderConversations } from "./conversations.js";
import { renderEmail } from "./email.js";
import { renderSms } from "./sms.js";
import { renderTelegram } from "./telegram.js";

export { renderConversations } from "./conversations.js";
export { renderEmail } from "./email.js";
export { renderSms } from "./sms.js";
export { renderTelegram } from "./telegram.js";

export type ChannelRenderer = (campaign: AnnouncementCampaign, links: ShortenedLink[]) => RenderedMessage;

export const CHANNEL_RENDERERS: Record<DeliveryChannel, ChannelRenderer> = {
  email: renderEmail,
  telegram: renderTelegram,
  conversations: renderConversations,
  sms: renderSms,
};

export function renderChannel(
  channel: DeliveryChannel,
  campaign: AnnouncementCampaign,
  links: ShortenedLink[],
): RenderedMessage {
  const renderer = CHANNEL_RENDERERS[channel];
  if (!renderer) throw new Error(`No renderer for channel: ${channel}`);
  return renderer(campaign, links);
}
