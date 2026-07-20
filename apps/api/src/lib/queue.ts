import { Queue, Worker, JobsOptions, ConnectionOptions } from "bullmq";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ requires `maxRetriesPerRequest: null` on the underlying ioredis
// client. We pass the URL + flag and let BullMQ own the connection lifecycle.
export function getQueueConnection(): ConnectionOptions {
  return { url: REDIS_URL, maxRetriesPerRequest: null };
}

export const QueueNames = {
  CAMPAIGN_DISPATCH: "campaign-dispatch",
  APPOINTMENT_DISPATCH: "appointment-dispatch",
  FLOW_DISPATCH: "flow-dispatch",
  SLA_DISPATCH: "sla-dispatch",
  WEBHOOK_DELIVERY: "webhook-delivery",
  LEAD_FOLLOWUP_DISPATCH: "lead-followup-dispatch",
  WABA_TOKEN_EXPIRY: "waba-token-expiry",
  KNOWLEDGE_BASE_EMBEDDING: "knowledge-base-embedding",
  WALLET_RECONCILIATION: "wallet-reconciliation",
  DRIP_DISPATCH: "drip-dispatch",
  LEAD_AUTOSCORE: "lead-autoscore",
  META_LEAD_SYNC: "meta-lead-sync",
  WALLET_RISK: "wallet-risk",
  PLATFORM_MONITOR: "platform-monitor",
  DOMAIN_HEALTH: "domain-health",
  ANALYTICS_REPORTS: "analytics-reports",
  GMB_POST_PUBLISHER: "gmb-post-publisher",
  GMB_REPORT_SCHEDULE: "gmb-report-schedule",
  GMB_AUTOPILOT: "gmb-autopilot",
  GMB_AUTO_SYNC: "gmb-auto-sync",
  TEMPLATE_STATUS_SYNC: "template-status-sync",
  SOCIAL_PUBLISH: "social-publish",
  SEARCH_INDEX: "search-index",
  DEMO_EXPIRY: "demo-expiry",
  AI_VISIBILITY: "ai-visibility",
  COMPLIANCE_ESCALATION: "compliance-escalation",
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

interface CampaignDispatchData {
  campaignId: string;
  /** "retry" re-sends only the failed recipients; absent = full dispatch. */
  kind?: "retry";
}
interface CampaignScanData {
  kind: "scan-scheduled";
}
export type CampaignJobData = CampaignDispatchData | CampaignScanData;

interface AppointmentScanData {
  kind: "scan";
}
export type AppointmentJobData = AppointmentScanData;

interface FlowScanData {
  kind: "scan";
}
export type FlowJobData = FlowScanData;

export type SlaJobData = { kind: "scan" };
export type LeadFollowUpJobData = { kind: "scan" };

interface WebhookDeliveryData {
  webhookLogId: string;
}
export type WebhookJobData = WebhookDeliveryData;

export type WabaTokenExpiryJobData = { kind: "scan" };
export type GmbPostPublisherJobData = { kind: "sweep" };
export type GmbReportScheduleJobData = { kind: "sweep" };
export type GmbAutopilotJobData = { kind: "sweep" };
export type GmbAutoSyncJobData = { kind: "sweep" };
export type TemplateStatusSyncJobData = { kind: "sweep" };
export type KnowledgeBaseEmbeddingJobData =
  | { tenantId: string; entryId: string }
  | { kind: "embed-stale"; tenantId: string; limit: number };
export type WalletReconciliationJobData = { kind: "scan" };
export type ComplianceEscalationJobData = { kind: "scan" };
export type SearchIndexJobData = { kind: "sweep" };
export type DemoExpiryJobData = { kind: "sweep" };
export type AiVisibilityJobData = { kind: "sweep" };
export type SocialPublishJobData = { kind: "scan" };
export type DripJobData = { kind: "scan" };
export type LeadAutoScoreJobData = { kind: "scan" };
export type MetaLeadSyncJobData = { kind: "scan" };
export type WalletRiskJobData = { kind: "scan" } | { kind: "assess"; tenantId: string };
export type PlatformMonitorJobData =
  | { kind: "scan" }
  | { kind: "summary" };
export type DomainHealthJobData = { kind: "scan" };
export type AnalyticsReportJobData =
  | { kind: "scan" }
  | { kind: "send"; scheduleId: string };

const queueSingletons = new Map<string, Queue>();

export function makeBullJobId(...parts: Array<string | number>): string {
  return parts.map((part) => String(part).replace(/:/g, "_")).join("-");
}

function makeQueue<T>(name: string): Queue<T> {
  const existing = queueSingletons.get(name);
  if (existing) return existing as Queue<T>;
  const q = new Queue<T>(name, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      // Keep last 1k completed for the /admin/queues view; drop older to
      // bound Redis memory.
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
    },
  });
  queueSingletons.set(name, q);
  return q;
}

export function getCampaignQueue(): Queue<CampaignJobData> {
  return makeQueue<CampaignJobData>(QueueNames.CAMPAIGN_DISPATCH);
}

export function getAppointmentQueue(): Queue<AppointmentJobData> {
  return makeQueue<AppointmentJobData>(QueueNames.APPOINTMENT_DISPATCH);
}

export function getFlowQueue(): Queue<FlowJobData> {
  return makeQueue<FlowJobData>(QueueNames.FLOW_DISPATCH);
}

export function getSlaQueue(): Queue<SlaJobData> {
  return makeQueue<SlaJobData>(QueueNames.SLA_DISPATCH);
}

export function getSocialPublishQueue(): Queue<SocialPublishJobData> {
  return makeQueue<SocialPublishJobData>(QueueNames.SOCIAL_PUBLISH);
}

export function getWebhookQueue(): Queue<WebhookJobData> {
  return makeQueue<WebhookJobData>(QueueNames.WEBHOOK_DELIVERY);
}

export function getWabaTokenExpiryQueue(): Queue<WabaTokenExpiryJobData> {
  return makeQueue<WabaTokenExpiryJobData>(QueueNames.WABA_TOKEN_EXPIRY);
}

export function getGmbPostPublisherQueue(): Queue<GmbPostPublisherJobData> {
  return makeQueue<GmbPostPublisherJobData>(QueueNames.GMB_POST_PUBLISHER);
}

export function getGmbAutopilotQueue(): Queue<GmbAutopilotJobData> {
  return makeQueue<GmbAutopilotJobData>(QueueNames.GMB_AUTOPILOT);
}

export function getGmbAutoSyncQueue(): Queue<GmbAutoSyncJobData> {
  return makeQueue<GmbAutoSyncJobData>(QueueNames.GMB_AUTO_SYNC);
}

export function getGmbReportScheduleQueue(): Queue<GmbReportScheduleJobData> {
  return makeQueue<GmbReportScheduleJobData>(QueueNames.GMB_REPORT_SCHEDULE);
}

export function getTemplateStatusSyncQueue(): Queue<TemplateStatusSyncJobData> {
  return makeQueue<TemplateStatusSyncJobData>(QueueNames.TEMPLATE_STATUS_SYNC);
}

export function getSearchIndexQueue(): Queue<SearchIndexJobData> {
  return makeQueue<SearchIndexJobData>(QueueNames.SEARCH_INDEX);
}

export function getDemoExpiryQueue(): Queue<DemoExpiryJobData> {
  return makeQueue<DemoExpiryJobData>(QueueNames.DEMO_EXPIRY);
}

export function getAiVisibilityQueue(): Queue<AiVisibilityJobData> {
  return makeQueue<AiVisibilityJobData>(QueueNames.AI_VISIBILITY);
}

export function getLeadFollowUpQueue(): Queue<LeadFollowUpJobData> {
  return makeQueue<LeadFollowUpJobData>(QueueNames.LEAD_FOLLOWUP_DISPATCH);
}

export function getKnowledgeBaseEmbeddingQueue(): Queue<KnowledgeBaseEmbeddingJobData> {
  return makeQueue<KnowledgeBaseEmbeddingJobData>(
    QueueNames.KNOWLEDGE_BASE_EMBEDDING,
  );
}

export function getWalletReconciliationQueue(): Queue<WalletReconciliationJobData> {
  return makeQueue<WalletReconciliationJobData>(
    QueueNames.WALLET_RECONCILIATION,
  );
}

export function getComplianceEscalationQueue(): Queue<ComplianceEscalationJobData> {
  return makeQueue<ComplianceEscalationJobData>(
    QueueNames.COMPLIANCE_ESCALATION,
  );
}

export function getDripQueue(): Queue<DripJobData> {
  return makeQueue<DripJobData>(QueueNames.DRIP_DISPATCH);
}

export function getLeadAutoScoreQueue(): Queue<LeadAutoScoreJobData> {
  return makeQueue<LeadAutoScoreJobData>(QueueNames.LEAD_AUTOSCORE);
}

export function getMetaLeadSyncQueue(): Queue<MetaLeadSyncJobData> {
  return makeQueue<MetaLeadSyncJobData>(QueueNames.META_LEAD_SYNC);
}

export function getWalletRiskQueue(): Queue<WalletRiskJobData> {
  return makeQueue<WalletRiskJobData>(QueueNames.WALLET_RISK);
}

export function getPlatformMonitorQueue(): Queue<PlatformMonitorJobData> {
  return makeQueue<PlatformMonitorJobData>(QueueNames.PLATFORM_MONITOR);
}

export function getDomainHealthQueue(): Queue<DomainHealthJobData> {
  return makeQueue<DomainHealthJobData>(QueueNames.DOMAIN_HEALTH);
}

export function getAnalyticsReportQueue(): Queue<AnalyticsReportJobData> {
  return makeQueue<AnalyticsReportJobData>(QueueNames.ANALYTICS_REPORTS);
}

// Test/shutdown helper. Closes the singleton + all registered workers.
const registeredWorkers = new Set<Worker>();

export function trackWorker(w: Worker): void {
  registeredWorkers.add(w);
}

export async function closeQueues(): Promise<void> {
  const workers = Array.from(registeredWorkers);
  registeredWorkers.clear();
  await Promise.allSettled(workers.map((w) => w.close()));
  const queues = Array.from(queueSingletons.values());
  queueSingletons.clear();
  await Promise.allSettled(queues.map((q) => q.close()));
}

export async function queueDepth(
  queue: Queue,
): Promise<{
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}> {
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "failed",
    "completed",
  );
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
  };
}

export type { JobsOptions };
