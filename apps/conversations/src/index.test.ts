import { describe, test, expect } from "bun:test";
import * as index from "./index";

describe("public API exports", () => {
  test("exports message functions", () => {
    expect(typeof index.sendMessage).toBe("function");
    expect(typeof index.readMessages).toBe("function");
    expect(typeof index.markRead).toBe("function");
    expect(typeof index.markSessionRead).toBe("function");
    expect(typeof index.markChannelRead).toBe("function");
    expect(typeof index.markAllRead).toBe("function");
    expect(typeof index.getMessageById).toBe("function");
    expect(typeof index.searchMessages).toBe("function");
    expect(typeof index.exportMessages).toBe("function");
    expect(typeof index.deleteMessage).toBe("function");
    expect(typeof index.editMessage).toBe("function");
    expect(typeof index.pinMessage).toBe("function");
    expect(typeof index.unpinMessage).toBe("function");
    expect(typeof index.getPinnedMessages).toBe("function");
    expect(typeof index.getUnreadBlockers).toBe("function");
    expect(typeof index.getThreadReplies).toBe("function");
  });

  test("exports session functions", () => {
    expect(typeof index.listSessions).toBe("function");
    expect(typeof index.getSession).toBe("function");
    expect(typeof index.getSessionActivity).toBe("function");
  });

  test("exports channel functions", () => {
    expect(typeof index.createChannel).toBe("function");
    expect(typeof index.updateChannel).toBe("function");
    expect(typeof index.archiveChannel).toBe("function");
    expect(typeof index.unarchiveChannel).toBe("function");
    expect(typeof index.listChannels).toBe("function");
    expect(typeof index.getChannel).toBe("function");
    expect(typeof index.joinChannel).toBe("function");
    expect(typeof index.leaveChannel).toBe("function");
    expect(typeof index.getChannelMembers).toBe("function");
    expect(typeof index.isChannelMember).toBe("function");
  });

  test("exports channel notification functions", () => {
    expect(typeof index.buildMessagePreview).toBe("function");
    expect(typeof index.subscribeToChannelNotifications).toBe("function");
    expect(typeof index.unsubscribeFromChannelNotifications).toBe("function");
    expect(typeof index.listChannelNotificationSubscriptions).toBe("function");
    expect(typeof index.getSubscribedChannels).toBe("function");
    expect(typeof index.readChannelNotifications).toBe("function");
    expect(typeof index.markChannelNotificationsRead).toBe("function");
    expect(typeof index.markAllChannelNotificationsRead).toBe("function");
  });

  test("exports webhook functions", () => {
    expect(typeof index.listWebhooks).toBe("function");
    expect(typeof index.addWebhook).toBe("function");
    expect(typeof index.removeWebhook).toBe("function");
    expect(typeof index.fireWebhooks).toBe("function");
    expect(typeof index.fireTaskWebhooks).toBe("function");
  });

  test("exports project functions", () => {
    expect(typeof index.createProject).toBe("function");
    expect(typeof index.listProjects).toBe("function");
    expect(typeof index.getProject).toBe("function");
    expect(typeof index.getProjectByName).toBe("function");
    expect(typeof index.updateProject).toBe("function");
    expect(typeof index.deleteProject).toBe("function");
  });

  test("exports db functions", () => {
    expect(typeof index.getDb).toBe("function");
    expect(typeof index.getDbPath).toBe("function");
    expect(typeof index.closeDb).toBe("function");
  });

  test("exports polling functions", () => {
    expect(typeof index.startPolling).toBe("function");
    expect(typeof index.useMessages).toBe("function");
    expect(typeof index.useChannelMessages).toBe("function");
  });

  test("exports identity functions", () => {
    expect(typeof index.resolveIdentity).toBe("function");
    expect(typeof index.requireIdentity).toBe("function");
  });

  test("exports reaction functions", () => {
    expect(typeof index.addReaction).toBe("function");
    expect(typeof index.removeReaction).toBe("function");
    expect(typeof index.getReactions).toBe("function");
    expect(typeof index.getReactionSummary).toBe("function");
  });

  test("exports presence functions", () => {
    expect(typeof index.heartbeat).toBe("function");
    expect(typeof index.registerAgent).toBe("function");
    expect(typeof index.isAgentConflict).toBe("function");
    expect(typeof index.getPresence).toBe("function");
    expect(typeof index.listAgents).toBe("function");
    expect(typeof index.removePresence).toBe("function");
    expect(typeof index.renameAgent).toBe("function");
  });

  test("exports lock functions", () => {
    expect(typeof index.acquireLock).toBe("function");
    expect(typeof index.tryBulkAcquireLock).toBe("function");
    expect(typeof index.releaseLock).toBe("function");
    expect(typeof index.checkLock).toBe("function");
    expect(typeof index.cleanExpiredLocks).toBe("function");
    expect(typeof index.releaseStaleAgentLocks).toBe("function");
    expect(typeof index.listLocks).toBe("function");
    expect(typeof index.listLocksEnriched).toBe("function");
  });

  test("exports hot/session functions", () => {
    expect(typeof index.computeHotness).toBe("function");
    expect(typeof index.listHotSessions).toBe("function");
  });

  test("exports topic functions", () => {
    expect(typeof index.extractTopics).toBe("function");
    expect(typeof index.getChannelTopics).toBe("function");
    expect(typeof index.getSessionTopics).toBe("function");
    expect(typeof index.getTrendingTopics).toBe("function");
  });

  test("exports summary function", () => {
    expect(typeof index.getConversationSummary).toBe("function");
  });

  test("exports graph functions", () => {
    expect(typeof index.buildGraph).toBe("function");
    expect(typeof index.getRelated).toBe("function");
    expect(typeof index.getAgentNetwork).toBe("function");
    expect(typeof index.getGraphStats).toBe("function");
  });

  test("exports gatherer function", () => {
    expect(typeof index.gatherTrainingData).toBe("function");
  });

  test("exports model config functions", () => {
    expect(typeof index.getActiveModel).toBe("function");
    expect(typeof index.setActiveModel).toBe("function");
    expect(typeof index.clearActiveModel).toBe("function");
  });

  test("exports task functions", () => {
    expect(typeof index.createTask).toBe("function");
    expect(typeof index.getTask).toBe("function");
    expect(typeof index.listTasks).toBe("function");
    expect(typeof index.startTask).toBe("function");
    expect(typeof index.completeTask).toBe("function");
    expect(typeof index.cancelTask).toBe("function");
    expect(typeof index.blockTask).toBe("function");
    expect(typeof index.unblockTask).toBe("function");
    expect(typeof index.reopenTask).toBe("function");
    expect(typeof index.assignTask).toBe("function");
    expect(typeof index.setTaskPriority).toBe("function");
    expect(typeof index.addComment).toBe("function");
    expect(typeof index.getComments).toBe("function");
    expect(typeof index.getSubtasks).toBe("function");
    expect(typeof index.getTaskTree).toBe("function");
    expect(typeof index.addDependency).toBe("function");
    expect(typeof index.removeDependency).toBe("function");
    expect(typeof index.getDependencies).toBe("function");
    expect(typeof index.getDependents).toBe("function");
    expect(typeof index.getTaskActivity).toBe("function");
    expect(typeof index.deleteTask).toBe("function");
    expect(typeof index.getDueTasks).toBe("function");
    expect(typeof index.getTaskSummary).toBe("function");
    expect(typeof index.searchTasks).toBe("function");
  });
});
