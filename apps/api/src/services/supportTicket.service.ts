import { prisma, TicketStatus, TicketPriority, TicketAuthor } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Support tickets — a workspace raises a ticket, platform staff (SUPER_ADMIN)
// answer it. Both sides read the same thread; the difference is scope. Customer
// calls are tenant-scoped; admin calls span all tenants. Replies flip status and
// stamp lastReply* so the list can render "who spoke last" without the thread.

export interface SafeTicketMessage {
  id: string;
  author: TicketAuthor;
  body: string;
  createdAt: Date;
}

export interface SafeTicket {
  id: string;
  tenantId: string;
  tenantName?: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  lastReplyAt: Date;
  lastReplyBy: TicketAuthor;
  createdAt: Date;
  messageCount?: number;
  messages?: SafeTicketMessage[];
}

const LIST_LIMIT = 200;

export interface CreateTicketInput {
  tenantId: string;
  createdByUserId?: string;
  subject: string;
  body: string;
  priority?: TicketPriority;
}

export async function createTicket(input: CreateTicketInput): Promise<SafeTicket> {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A subject is required.");
  if (!body) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A message is required.");

  const ticket = await prisma.supportTicket.create({
    data: {
      tenantId: input.tenantId,
      createdByUserId: input.createdByUserId ?? null,
      subject,
      priority: input.priority ?? TicketPriority.NORMAL,
      lastReplyBy: TicketAuthor.CUSTOMER,
      messages: {
        create: {
          author: TicketAuthor.CUSTOMER,
          authorUserId: input.createdByUserId ?? null,
          body,
        },
      },
    },
  });
  return toSafe(ticket);
}

export interface ListTicketsFilter {
  tenantId?: string; // omit for admin (all tenants)
  status?: TicketStatus;
}

export async function listTickets(
  filter: ListTicketsFilter,
): Promise<SafeTicket[]> {
  const rows = await prisma.supportTicket.findMany({
    where: {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { lastReplyAt: "desc" },
    take: LIST_LIMIT,
    include: {
      _count: { select: { messages: true } },
      ...(filter.tenantId ? {} : { tenant: { select: { name: true } } }),
    },
  });
  return rows.map((r) => ({
    ...toSafe(r),
    tenantName: "tenant" in r && r.tenant ? r.tenant.name : undefined,
    messageCount: r._count.messages,
  }));
}

/**
 * Load a ticket with its full thread. `tenantId` scopes the lookup for customer
 * callers (a foreign id 404s); admin passes null to reach any ticket.
 */
export async function getTicket(
  id: string,
  tenantId: string | null,
): Promise<SafeTicket> {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id, ...(tenantId ? { tenantId } : {}) },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      tenant: { select: { name: true } },
    },
  });
  if (!ticket) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Ticket not found.");
  return {
    ...toSafe(ticket),
    tenantName: ticket.tenant.name,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      author: m.author,
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}

export interface ReplyInput {
  ticketId: string;
  tenantId: string | null; // customer scope; null for admin
  author: TicketAuthor;
  authorUserId?: string;
  body: string;
}

/**
 * Append a message. A customer reply reopens a ticket to PENDING (needs staff);
 * a staff reply moves it to PENDING (awaiting customer) unless already resolved.
 * The status change is deliberate and mirrors the design's queues.
 */
export async function replyToTicket(input: ReplyInput): Promise<SafeTicket> {
  const body = input.body.trim();
  if (!body) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A message is required.");

  // Ownership check within the reply's scope.
  const existing = await prisma.supportTicket.findFirst({
    where: { id: input.ticketId, ...(input.tenantId ? { tenantId: input.tenantId } : {}) },
    select: { id: true, status: true },
  });
  if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Ticket not found.");

  // A reply reopens the ticket and routes it to whoever must act next: a
  // customer reply needs staff (OPEN); a staff reply awaits the customer
  // (PENDING). (The previous ternary set PENDING either way — a no-op.)
  const nextStatus =
    input.author === TicketAuthor.CUSTOMER ? TicketStatus.OPEN : TicketStatus.PENDING;

  await prisma.$transaction([
    prisma.supportTicketMessage.create({
      data: {
        ticketId: input.ticketId,
        author: input.author,
        authorUserId: input.authorUserId ?? null,
        body,
      },
    }),
    prisma.supportTicket.update({
      where: { id: input.ticketId },
      data: { lastReplyAt: new Date(), lastReplyBy: input.author, status: nextStatus },
    }),
  ]);
  return getTicket(input.ticketId, input.tenantId);
}

/** Admin-only: set status/priority. */
export async function updateTicket(
  id: string,
  patch: { status?: TicketStatus; priority?: TicketPriority },
): Promise<SafeTicket> {
  const existing = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Ticket not found.");
  const ticket = await prisma.supportTicket.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.priority ? { priority: patch.priority } : {}),
    },
  });
  return toSafe(ticket);
}

function toSafe(t: {
  id: string;
  tenantId: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  lastReplyAt: Date;
  lastReplyBy: TicketAuthor;
  createdAt: Date;
}): SafeTicket {
  return {
    id: t.id,
    tenantId: t.tenantId,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    lastReplyAt: t.lastReplyAt,
    lastReplyBy: t.lastReplyBy,
    createdAt: t.createdAt,
  };
}
