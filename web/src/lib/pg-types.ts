// PostgreSQL type classification, and the colour each class is painted in.
//
// One source of truth: the grid colours cell values with it, the Info tab
// colours the type column with it, and the SQL editor's highlight style uses
// the same tokens — so a jsonb column looks like jsonb everywhere in the app.

export type PgTypeClass = "number" | "bool" | "date" | "uuid" | "json" | "text";

const NUMERIC =
  /^(numeric|money|int|int2|int4|int8|float|float4|float8|serial|bigserial|smallint|integer|bigint|real|double)/;
const DATE = /^(timestamptz|timestamp|date|time|interval)/;
const UUID = /^(uuid|bytea)/;
const JSONISH = /^(json|jsonb|xml)/;
const BOOLEAN = /^bool/;

/** Types rendered in the monospace face — anything read as a token rather than
 * as prose. */
export const MONO_TYPES =
  /^(json|jsonb|bytea|uuid|timestamptz|timestamp|date|time|numeric|money|interval|int|int2|int4|int8|float|float4|float8|serial|bigserial)/;

/** True for types whose values right-align, i.e. the ones you compare digit by
 * digit. */
export function isNumericType(type: string): boolean {
  return NUMERIC.test(type);
}

export function classifyType(type: string): PgTypeClass {
  if (NUMERIC.test(type)) return "number";
  if (BOOLEAN.test(type)) return "bool";
  if (DATE.test(type)) return "date";
  if (UUID.test(type)) return "uuid";
  if (JSONISH.test(type)) return "json";
  return "text";
}

const CLASS_COLOR: Record<PgTypeClass, string> = {
  number: "text-t-number",
  bool: "text-t-bool",
  date: "text-t-date",
  uuid: "text-t-uuid",
  json: "text-t-json",
  text: "",
};

/** Tailwind colour class for a type name alone (headers, the Info tab). */
export function typeColorClass(type: string): string {
  return CLASS_COLOR[classifyType(type)];
}

/** Colour + face for a rendered value. The column type decides first and the
 * runtime type second: the driver hands back bigint and timestamptz as
 * strings, so `typeof` alone would render half the catalog as plain text. */
export function valueClass(type: string, value: unknown): string {
  if (value === null) return "text-t-null italic";
  if (typeof value === "number") return "text-t-number font-mono";
  if (typeof value === "boolean") return "text-t-bool font-mono";
  const cls = classifyType(type);
  if (cls !== "text") return `${CLASS_COLOR[cls]} font-mono`;
  return MONO_TYPES.test(type) ? "font-mono" : "";
}
