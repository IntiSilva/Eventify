import type { ZodFormattedError } from "zod";
import type { FieldValues, FieldPath, UseFormReturn } from "react-hook-form";

/**
 * Applies Zod (format()) errors to react-hook-form, supporting nested paths.
 * - By default it sets per-field errors.
 * - If you also want a "global" error, pass { setRoot: true }.
 */
export function applyZodErrorsToForm<T extends FieldValues>(
  form: UseFormReturn<T>,
  issues: ZodFormattedError<T>,
  options?: { setRoot?: boolean }
) {
  // Optional: global error on "root"
  if (issues._errors?.length && options?.setRoot) {
    form.setError("root", {
      type: "server",
      message: issues._errors.join(", "),
    });
  }

  const setPathError = (path: string, message: string) => {
    if (!path) return;
    form.setError(path as FieldPath<T>, {
      type: "server",
      message,
    });
  };

  // Walk the formatted Zod object and build dot paths like "a.b.c"
  const walk = (node: unknown, pathParts: string[] = []) => {
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;

    // If the node has _errors, it's an error for the current path
    const nodeErrors = (record._errors as string[] | undefined) ?? [];
    if (nodeErrors.length) {
      setPathError(pathParts.join("."), nodeErrors.join(", "));
    }

    // Traverse children (ignoring the special "_errors" key)
    for (const [k, v] of Object.entries(record)) {
      if (k === "_errors") continue;
      if (v && typeof v === "object") {
        walk(v, [...pathParts, k]);
      }
    }
  };

  walk(issues);
}

/** New: adapter from the “serialized form” errors (date as string) to the client form (date as Date) */
export type WithDateString<T> = Omit<T, "date"> & { date: string };

/**
 * Converts ZodFormattedError<TSerialized> into the shape of ZodFormattedError<TForm>,
 * copying only the structure and each node’s _errors (no runtime transforms).
 */
export function toFormError<
  TForm extends FieldValues,
  TSerialized = WithDateString<TForm>
>(errors: ZodFormattedError<TSerialized>): ZodFormattedError<TForm> {
  type ZodErrorNode = Record<string, unknown> & { _errors?: string[] };

  const out: ZodErrorNode = {};

  const copy = (src: unknown, dst: ZodErrorNode): void => {
    if (!src || typeof src !== "object") return;

    const node = src as ZodErrorNode;

    // Copy messages from the current node (if any)
    if (Array.isArray(node._errors)) {
      // Clone to avoid aliasing the original array
      dst._errors = [...node._errors];
    }

    // Traverse child entries, ignoring the special "_errors" key
    for (const [key, value] of Object.entries(node)) {
      if (key === "_errors") continue;
      if (value && typeof value === "object") {
        const child: ZodErrorNode = {};
        dst[key] = child;
        copy(value, child);
      }
    }
  };

  copy(errors, out);
  return out as ZodFormattedError<TForm>;
}
