import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// AdGrowly / platform — AI prompt template management (planning PDF). Global,
// SUPER_ADMIN-curated prompt templates consumed across AI features. The
// pure template engine (placeholder extraction / render / variable diff) is
// unit-tested; DB ops are platform-scoped (no tenant) and version-aware.
// =====================================================================

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Unique `{{placeholder}}` names found in a template, in first-seen order. */
export function extractPlaceholders(template: string): string[] {
  const out: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const name = match[1];
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export type PromptVars = Record<string, string | number | null | undefined>;

/**
 * Fill `{{placeholders}}` with provided values. Placeholders without a value
 * are left intact and reported in `missing` so the caller can refuse to send
 * an under-specified prompt.
 */
export function renderPrompt(template: string, vars: PromptVars = {}): {
  text: string;
  missing: string[];
} {
  const missing: string[] = [];
  const text = template.replace(PLACEHOLDER_RE, (_full, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null || value === "") {
      if (!missing.includes(name)) missing.push(name);
      return `{{${name}}}`;
    }
    return String(value);
  });
  return { text, missing };
}

/** Reconcile declared `variables` against the template's actual placeholders. */
export function diffVariables(template: string, declared: string[]) {
  const placeholders = extractPlaceholders(template);
  return {
    placeholders,
    undeclared: placeholders.filter((p) => !declared.includes(p)),
    unused: declared.filter((d) => !placeholders.includes(d)),
  };
}

interface TemplateRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  template: string;
  variables: string[];
  model: string | null;
  isActive: boolean;
  version: number;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe view — omits the internal updatedByUserId. */
export function toSafeTemplate(row: TemplateRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    template: row.template,
    variables: row.variables,
    model: row.model,
    isActive: row.isActive,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (platform-scoped — SUPER_ADMIN only)
// ---------------------------------------------------------------------

export interface ListTemplatesFilter {
  category?: string;
  activeOnly?: boolean;
}

export async function listTemplates(filter: ListTemplatesFilter = {}) {
  const rows = await prisma.aiPromptTemplate.findMany({
    where: {
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ category: "asc" }, { key: "asc" }],
  });
  return rows.map(toSafeTemplate);
}

async function findOrThrow(id: string) {
  const row = await prisma.aiPromptTemplate.findUnique({ where: { id } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Prompt template not found.");
  return row;
}

export interface CreateTemplateInput {
  key: string;
  name: string;
  description?: string;
  category?: string;
  template: string;
  variables?: string[];
  model?: string;
  isActive?: boolean;
  updatedByUserId?: string;
}

export async function createTemplate(input: CreateTemplateInput) {
  const key = input.key.trim().toLowerCase();
  const template = input.template;
  if (!key) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A template key is required.");
  if (!template.trim()) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Template body is required.");

  const existing = await prisma.aiPromptTemplate.findUnique({ where: { key }, select: { id: true } });
  if (existing) {
    throw new ApiError(ErrorCodes.CONFLICT, 409, `A template with key "${key}" already exists.`);
  }

  const variables =
    input.variables && input.variables.length ? input.variables : extractPlaceholders(template);

  const row = await prisma.aiPromptTemplate.create({
    data: {
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      template,
      variables,
      model: input.model?.trim() || null,
      isActive: input.isActive ?? true,
      updatedByUserId: input.updatedByUserId ?? null,
    },
  });
  return toSafeTemplate(row);
}

export async function getTemplate(id: string) {
  return toSafeTemplate(await findOrThrow(id));
}

export async function getTemplateByKey(key: string) {
  const row = await prisma.aiPromptTemplate.findUnique({ where: { key: key.trim().toLowerCase() } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Prompt template not found.");
  return toSafeTemplate(row);
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  template?: string;
  variables?: string[];
  model?: string | null;
  isActive?: boolean;
  updatedByUserId?: string;
}

export async function updateTemplate(id: string, input: UpdateTemplateInput) {
  const current = await findOrThrow(id);
  const templateChanged = input.template !== undefined && input.template !== current.template;

  // Re-derive variables when the body changes and the caller didn't supply them.
  let variables: string[] | undefined = input.variables;
  if (variables === undefined && templateChanged) {
    variables = extractPlaceholders(input.template!);
  }

  const row = await prisma.aiPromptTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.template !== undefined ? { template: input.template } : {}),
      ...(variables !== undefined ? { variables } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(templateChanged ? { version: current.version + 1 } : {}),
      updatedByUserId: input.updatedByUserId ?? current.updatedByUserId,
    },
  });
  return toSafeTemplate(row);
}

export async function deleteTemplate(id: string) {
  await findOrThrow(id);
  await prisma.aiPromptTemplate.delete({ where: { id } });
}

/** Render a stored template with supplied variables (preview, no mutation). */
export async function previewTemplate(id: string, vars: PromptVars) {
  const row = await findOrThrow(id);
  const rendered = renderPrompt(row.template, vars);
  return { id: row.id, key: row.key, version: row.version, ...rendered };
}
