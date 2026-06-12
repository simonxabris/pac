import { registerEventDefinition } from "../resources/registry.js";

export type EventMetadataJsonSchemaLike = {
  readonly type?: unknown;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: ReadonlyArray<string>;
};

export type EventMetadataValueType = "string" | "number" | "boolean" | "unknown";

export type EventMetadataRef<ValueType extends EventMetadataValueType = EventMetadataValueType> = {
  readonly eventName: string;
  readonly key: string;
  readonly meterPath: `metadata.${string}`;
  readonly valueType: ValueType;
  readonly optional: boolean;
  readonly __eventMetadataRefValueType?: (value: ValueType) => ValueType;
};

export type EventMetadataField = {
  readonly key: string;
  readonly valueType: EventMetadataValueType;
  readonly optional: boolean;
};

export type EventDefinition = {
  readonly key: string;
  readonly name: string;
  readonly metadataSchema: unknown;
  readonly fields: ReadonlyArray<EventMetadataField>;
};

export type EventConfig<MetadataSchema = EventMetadataJsonSchemaLike> = {
  readonly name: string;
  readonly metadata: MetadataSchema;
};

type JsonSchemaPropertyType<Property> = Property extends { readonly type: infer Type }
  ? Type extends "string"
    ? "string"
    : Type extends "number" | "integer"
      ? "number"
      : Type extends "boolean"
        ? "boolean"
        : "unknown"
  : "unknown";

export type EventMetadataRefs<MetadataSchema> = MetadataSchema extends {
  readonly properties: infer Properties extends Readonly<Record<string, unknown>>;
}
  ? {
      readonly [Key in keyof Properties & string]-?: EventMetadataRef<
        JsonSchemaPropertyType<Properties[Key]>
      >;
    }
  : Readonly<Record<string, EventMetadataRef>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const jsonSchemaValueType = (propertySchema: unknown): EventMetadataValueType => {
  if (!isRecord(propertySchema)) return "unknown";

  switch (propertySchema.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "unknown";
  }
};

export const interpretEventMetadataFields = (
  metadataSchema: unknown,
): ReadonlyArray<EventMetadataField> => {
  if (!isRecord(metadataSchema) || !isRecord(metadataSchema.properties)) {
    return [];
  }

  const required = new Set(
    Array.isArray(metadataSchema.required)
      ? metadataSchema.required.filter((key): key is string => typeof key === "string")
      : [],
  );

  return Object.entries(metadataSchema.properties).map(([key, propertySchema]) => ({
    key,
    valueType: jsonSchemaValueType(propertySchema),
    optional: !required.has(key),
  }));
};

const makeEventMetadataRef = (
  eventName: string,
  key: string,
  fieldByKey: ReadonlyMap<string, EventMetadataField>,
): EventMetadataRef => {
  const field = fieldByKey.get(key);
  return {
    eventName,
    key,
    meterPath: `metadata.${key}`,
    valueType: field?.valueType ?? "unknown",
    optional: field?.optional ?? true,
  };
};

const createEventMetadataRefs = <MetadataSchema>(
  eventName: string,
  fields: ReadonlyArray<EventMetadataField>,
): EventMetadataRefs<MetadataSchema> => {
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));

  return new Proxy(Object.create(null) as Record<string, EventMetadataRef>, {
    get(target, property) {
      if (typeof property !== "string") return undefined;

      target[property] ??= makeEventMetadataRef(eventName, property, fieldByKey);
      return target[property];
    },
  }) as EventMetadataRefs<MetadataSchema>;
};

export class Event<const MetadataSchema = EventMetadataJsonSchemaLike> {
  readonly key: string;
  readonly name: string;
  readonly metadataSchema: MetadataSchema;
  readonly metadata: EventMetadataRefs<MetadataSchema>;

  constructor(key: string, config: EventConfig<MetadataSchema>) {
    this.key = key;
    this.name = config.name;
    this.metadataSchema = config.metadata;

    const fields = interpretEventMetadataFields(config.metadata);
    this.metadata = createEventMetadataRefs(this.name, fields);

    registerEventDefinition(this.toEventDefinition());
  }

  toEventDefinition(): EventDefinition {
    return {
      key: this.key,
      name: this.name,
      metadataSchema: this.metadataSchema,
      fields: interpretEventMetadataFields(this.metadataSchema),
    };
  }
}
