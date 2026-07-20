import { prisma, GmbPostStatus } from "@nexaflow/db";
import { createGoogleLocalPost } from "./gmbGoogle.service";
import { ensureBrandedPostMedia } from "./gmbBrandedImage.service";

// =====================================================================
// AdGrowly GMB — Scheduled-post publisher (planning PDF §3 Post Scheduler).
// Selects due SCHEDULED posts and publishes them. Posts whose locationLabel
// matches a Google-connected GmbLocation go live via the Business Profile
// API (FAILED + error on trouble so a later run can retry); posts without a
// connected location are marked PUBLISHED as local-only records, preserving
// the pre-OAuth behavior. The selection helper is pure and unit-tested.
// =====================================================================

export interface SchedulablePost {
  id: string;
  status: GmbPostStatus;
  scheduledAt: Date | string | null;
}

/** Posts that are SCHEDULED and whose scheduledAt is at/before `now`. */
export function selectDuePosts<T extends SchedulablePost>(posts: T[], now: Date): T[] {
  return posts.filter(
    (p) =>
      p.status === GmbPostStatus.SCHEDULED &&
      p.scheduledAt != null &&
      new Date(p.scheduledAt).getTime() <= now.getTime(),
  );
}

export interface PublishResult {
  published: number;
  /** Created live on Google Business Profile. */
  live: number;
  /** Marked published without a connected Google location. */
  localOnly: number;
  /** Live publish attempts that errored (now FAILED, retryable). */
  failed: number;
  ids: string[];
}

/**
 * Publish all of a tenant's due scheduled posts. Each post whose
 * locationLabel resolves to a Google-connected location (resource name +
 * credential) is created live on the Business Profile; failures land in
 * FAILED with the reason so the next run (or a manual retry) can pick them
 * up. Posts without a connected location keep the local-only behavior.
 */
export async function publishDuePosts(tenantId: string, now: Date = new Date()): Promise<PublishResult> {
  const due = await prisma.gmbPost.findMany({
    where: { tenantId, status: GmbPostStatus.SCHEDULED, scheduledAt: { lte: now } },
    select: {
      id: true,
      summary: true,
      mediaUrl: true,
      callToActionType: true,
      callToActionUrl: true,
      locationLabel: true,
    },
  });
  if (due.length === 0) return { published: 0, live: 0, localOnly: 0, failed: 0, ids: [] };

  let live = 0;
  let localOnly = 0;
  let failed = 0;
  const ids: string[] = [];

  for (const post of due) {
    const location = post.locationLabel
      ? await prisma.gmbLocation.findFirst({
          where: { tenantId, name: post.locationLabel },
          select: { id: true, placeId: true, secretId: true },
        })
      : null;

    if (location?.placeId && location.secretId) {
      try {
        // Preserve a user-supplied image. Otherwise snapshot the current
        // tenant BrandKit into one hosted PNG and persist it before calling
        // Google, so retries reuse the same stable URL.
        const mediaUrl =
          post.mediaUrl ?? (await ensureBrandedPostMedia(tenantId, post.id));
        await createGoogleLocalPost({
          tenantId,
          locationId: location.id,
          locationResourceName: location.placeId,
          secretId: location.secretId,
          summary: post.summary,
          mediaUrl,
          callToActionType: post.callToActionType,
          callToActionUrl: post.callToActionUrl,
        });
        await prisma.gmbPost.updateMany({
          where: { id: post.id, tenantId },
          data: { status: GmbPostStatus.PUBLISHED, publishedAt: now, error: null },
        });
        live += 1;
        ids.push(post.id);
      } catch (e) {
        await prisma.gmbPost.updateMany({
          where: { id: post.id, tenantId },
          data: {
            status: GmbPostStatus.FAILED,
            error: (e instanceof Error ? e.message : "Google publish failed.").slice(0, 500),
          },
        });
        failed += 1;
      }
      continue;
    }

    // No connected location — record the post as published locally.
    await prisma.gmbPost.updateMany({
      where: { id: post.id, tenantId },
      data: { status: GmbPostStatus.PUBLISHED, publishedAt: now, error: null },
    });
    localOnly += 1;
    ids.push(post.id);
  }

  return { published: live + localOnly, live, localOnly, failed, ids };
}
