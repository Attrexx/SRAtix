/**
 * Shared condition evaluation engine for SRAtix form fields.
 *
 * Used by:
 *   - Server: form submission validation (skip required check for hidden fields)
 *   - Dashboard: live preview & builder condition UI
 *   - Client embed: dynamic field show/hide
 *
 * A condition rule describes when a field should be VISIBLE.
 * When multiple conditions are present, ALL must pass (AND logic).
 *
 * @module common/conditions
 */

// ─── Types ──────────────────────────────────────────────────────

export type ConditionOperator =
  | 'eq'        // value === expected
  | 'neq'       // value !== expected
  | 'not_empty' // value is truthy / not empty
  | 'empty'     // value is falsy / empty
  | 'contains'  // array includes expected, or string contains expected
  | 'in';       // value is one of the expected array values

export interface ConditionRule {
  /** The field ID whose answer to evaluate. */
  field: string;
  /** Comparison operator. */
  operator: ConditionOperator;
  /** Expected value to compare against. Ignored for 'empty'/'not_empty'. */
  value?: unknown;
}

// ─── Legacy format conversion ───────────────────────────────────

/**
 * Convert the legacy `conditionalOn` single-object format
 * (from FieldDefinition) to the array-based `conditions` format.
 *
 * Legacy: `{ field: "billing_details_differ", operator: "eq", value: true }`
 * New:    `[{ field: "billing_details_differ", operator: "eq", value: true }]`
 */
export function normalizeConditions(
  conditions?: ConditionRule[] | null,
  conditionalOn?: Record<string, unknown> | null,
): ConditionRule[] | undefined {
  if (conditions && conditions.length > 0) {
    return conditions;
  }
  if (conditionalOn && typeof conditionalOn === 'object' && conditionalOn.field) {
    return [
      {
        field: conditionalOn.field as string,
        operator: (conditionalOn.operator as ConditionOperator) || 'eq',
        value: conditionalOn.value,
      },
    ];
  }
  return undefined;
}

// ─── Evaluation ─────────────────────────────────────────────────

/**
 * Evaluate whether a field should be VISIBLE given the current form answers.
 *
 * Returns `true` if all conditions pass (field should be shown).
 * Returns `true` if no conditions are defined (always visible).
 *
 * @param conditions  Array of condition rules (AND logic).
 * @param answers     Current form answers keyed by field ID.
 */
export function evaluateConditions(
  conditions: ConditionRule[] | undefined | null,
  answers: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) {
    return true; // No conditions → always visible
  }

  return conditions.every((rule) => evaluateRule(rule, answers));
}

/**
 * Evaluate a single condition rule against form answers.
 */
function evaluateRule(
  rule: ConditionRule,
  answers: Record<string, unknown>,
): boolean {
  const actual = answers[rule.field];

  switch (rule.operator) {
    case 'eq':
      return looseEquals(actual, rule.value);

    case 'neq':
      return !looseEquals(actual, rule.value);

    case 'not_empty':
      return !isEmpty(actual);

    case 'empty':
      return isEmpty(actual);

    case 'contains': {
      if (Array.isArray(actual)) {
        return actual.includes(rule.value);
      }
      if (typeof actual === 'string' && typeof rule.value === 'string') {
        return actual.toLowerCase().includes(rule.value.toLowerCase());
      }
      return false;
    }

    case 'in': {
      if (!Array.isArray(rule.value)) return false;
      if (Array.isArray(actual)) {
        // Any overlap between actual and expected
        return actual.some((v) => (rule.value as unknown[]).includes(v));
      }
      return (rule.value as unknown[]).includes(actual);
    }

    default:
      // Unknown operator — treat as always visible (fail-open)
      return true;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/** Loose equality: handles boolean/string coercion (e.g. "true" == true, "yes" == true). */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  // yes-no string ↔ boolean
  if (typeof a === 'string' && typeof b === 'boolean') {
    if (a === 'yes') return b === true;
    if (a === 'no') return b === false;
  }
  if (typeof b === 'string' && typeof a === 'boolean') {
    if (b === 'yes') return a === true;
    if (b === 'no') return a === false;
  }
  // Boolean ↔ string coercion
  if (typeof a === 'boolean' && typeof b === 'string') {
    return a === (b === 'true');
  }
  if (typeof b === 'boolean' && typeof a === 'string') {
    return b === (a === 'true');
  }
  // Number ↔ string coercion
  if (typeof a === 'number' && typeof b === 'string') {
    return a === Number(b);
  }
  if (typeof b === 'number' && typeof a === 'string') {
    return b === Number(a);
  }

  return false;
}

/** Check if a value is "empty" (null, undefined, '', [], false). */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || value === false) {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
}
