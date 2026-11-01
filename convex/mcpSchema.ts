import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { GenericValidator, Infer } from "convex/values";
import { z } from "zod";

function transportSchema(validator: GenericValidator): z.ZodType {
  let schema: z.ZodType;
  switch (validator.kind) {
    case "string": schema = z.string(); break;
    case "id": throw new Error("MCP IDs must be strings normalized by the database operation");
    case "float64": schema = z.number(); break;
    case "boolean": schema = z.boolean(); break;
    case "null": schema = z.null(); break;
    case "literal": {
      const value: unknown = validator.value;
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error("Unsupported MCP literal validator");
      }
      schema = z.literal(value);
      break;
    }
    case "array": schema = z.array(transportSchema(validator.element)); break;
    case "object": {
      const fields: Record<string, z.ZodType> = {};
      for (const [name, field] of Object.entries<GenericValidator>(validator.fields)) {
        fields[name] = transportSchema(field);
      }
      schema = z.strictObject(fields);
      break;
    }
    case "union": {
      const members: z.ZodType[] = validator.members.map(transportSchema);
      const [first, ...rest] = members;
      if (!first) throw new Error("Empty MCP union validator");
      schema = z.union([first, ...rest]);
      break;
    }
    default: throw new Error(`Unsupported MCP validator: ${validator.kind}`);
  }
  return validator.isOptional === "optional" ? schema.optional() : schema;
}

export function convexMcpSchema<V extends GenericValidator>(validator: V): StandardSchemaWithJSON<unknown, Infer<V>> {
  const schema = transportSchema(validator);
  const jsonSchema = z.toJSONSchema(schema);
  return {
    "~standard": {
      version: 1,
      vendor: "demo-queue-convex",
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
      validate(value) {
        const parsed = schema.safeParse(value);
        if (!parsed.success) return { issues: parsed.error.issues };
        return { value: parsed.data as Infer<V> };
      },
    },
  };
}

const organizationSelection = z.object({ organizationId: z.string().regex(/^org_[A-Za-z0-9]+$/) }).passthrough();

export function adminToolSchema<V extends GenericValidator>(validator: V): StandardSchemaWithJSON<unknown, { organizationId: string; input: Infer<V> }> {
  const operation = convexMcpSchema(validator);
  const fields = operation["~standard"].jsonSchema.input({ target: "draft-2020-12" });
  const objectSchema = z.object({ properties: z.record(z.string(), z.unknown()), required: z.array(z.string()).optional() }).parse(fields);
  const jsonSchema = {
    ...fields,
    properties: { organizationId: { type: "string", pattern: "^org_[A-Za-z0-9]+$" }, ...objectSchema.properties },
    required: ["organizationId", ...(objectSchema.required ?? [])],
  };
  return {
    "~standard": {
      version: 1,
      vendor: "demo-queue-admin",
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
      async validate(value) {
        const selected = organizationSelection.safeParse(value);
        if (!selected.success) return { issues: selected.error.issues };
        const { organizationId, ...input } = selected.data;
        const parsed = await operation["~standard"].validate(input);
        return parsed.issues ? parsed : { value: { organizationId, input: parsed.value } };
      },
    },
  };
}

/** The optional agent intent argument every MCP tool accepts, in PostHog's recommended wording. */
export const CONTEXT_SCHEMA = {
  type: "string", maxLength: 300,
  description: "Why are you calling this tool? Describe the goal in general terms, and refer to people by role (\"an organiser\", \"a judge\", \"a team\") rather than by name. Leave out names, emails and other personal and identifying details.",
};

/**
 * Adds `context` to a tool's schema. It is taken out before the tool's own
 * validation, so no tool sees it; `onInvalid` runs when validation fails.
 */
export function withContext<Output>(schema: StandardSchemaWithJSON<unknown, Output>, onInvalid?: (context: string | undefined) => Promise<void>): StandardSchemaWithJSON<unknown, { args: Output; context?: string }> {
  const json: typeof schema["~standard"]["jsonSchema"]["input"] = (options) => {
    const fields = schema["~standard"].jsonSchema.input(options);
    return { ...fields, properties: { ...z.record(z.string(), z.unknown()).optional().parse(fields.properties), context: CONTEXT_SCHEMA } };
  };
  return {
    "~standard": {
      version: 1,
      vendor: "demo-queue-context",
      jsonSchema: { input: json, output: json },
      async validate(value) {
        const fields = z.record(z.string(), z.unknown()).safeParse(value);
        const { context, ...args } = fields.success ? fields.data : {};
        const intent = typeof context === "string" ? context : undefined;
        const parsed = context === undefined || intent !== undefined
          ? await schema["~standard"].validate(fields.success ? args : value)
          : { issues: [{ message: "context must be a string", path: ["context"] }] };
        if (parsed.issues) { await onInvalid?.(intent); return { issues: parsed.issues }; }
        return { value: { args: parsed.value, context: intent } };
      },
    },
  };
}
