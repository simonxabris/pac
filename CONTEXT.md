# PAAC

PAAC provides a code-defined way to manage Polar payment infrastructure for a single Polar organization.

## Language

**Polar Organization**:
The ownership boundary for PAAC-managed Polar resources. PAAC reconciles resources within the Polar organization selected by provider configuration and active Polar credentials.
_Avoid_: PAAC project, project namespace

**Resource Address**:
The stable PAAC identity of a managed Polar resource within a Polar Organization, formed from the resource kind and a user-chosen key, such as `product.pro`. Renaming a Resource Address represents a different resource unless PAAC is given an explicit move/import.
_Avoid_: Polar ID, name, slug

**Managed Resource**:
A Polar resource that PAAC recognizes as belonging to it through PAAC ownership metadata. PAAC reconciles only the Managed Fields of a Managed Resource.
_Avoid_: Imported object, tracked object

**Managed Field**:
A part of a Managed Resource that PAAC owns and reconciles from code. Manual changes to Managed Fields are drift; fields outside PAAC's ownership are left alone unless they make reconciliation unsafe.
_Avoid_: Supported field, tracked property

**PAAC Metadata**:
A single Polar metadata key named `paac` containing versioned JSON that identifies PAAC ownership and the Resource Address. PAAC Metadata marks a Polar resource as a Managed Resource.
_Avoid_: Flat metadata keys, project metadata

**Product Price**:
A price option declared as part of a Product. Product Prices are not standalone resources in PAAC's language; users change them by changing the Product declaration. Supported Product Price forms are Polar's static prices (fixed, free, and custom) and recurring metered unit prices.
_Avoid_: Price resource, standalone price, detached price

**Metered Product Price**:
A recurring Product Price that charges a fixed unit amount for usage recorded by a PAAC-managed Meter. A Product with a Metered Product Price depends on the referenced Meter.
_Avoid_: Standalone meter price, usage resource

**Product Visibility**:
The Polar visibility state of a Product: `draft`, `private`, or `public`.
_Avoid_: Hidden

**Product Billing Cadence**:
Whether a Product is one-time or recurring, including the recurring interval and interval count. Product Billing Cadence is fixed once the Product exists.
_Avoid_: Billing period, subscription period

**Archived Product**:
A Product that still exists in Polar but is no longer available for new purchases. Existing customer access and subscriptions are not erased by archiving.
_Avoid_: Deleted product, removed product

**Meter**:
A standalone Polar usage counter declared as a PAAC resource, such as `meter.api-calls`. Meters define which events count and how those events are aggregated. Wiring Meters into metered Product Prices is a separate Product Price concern.
_Avoid_: Usage price, event, counter field

**Meter Filter**:
The event selection logic for a Meter, composed from filter clauses and `and`/`or` groups. PAAC uses explicit helpers for Polar event fields: `eventName(...)` filters the event name, `eventTimestamp(...)` filters the event timestamp, and `metadata(...)` filters event metadata properties.
_Avoid_: Query, selector

**Meter Aggregation**:
The calculation a Meter applies to filtered events: count, sum, avg, min, max, or unique.
_Avoid_: Formula, metric type

**Archived Meter**:
A Meter that still exists in Polar but is no longer used for billing. PAAC archives missing Meter declarations rather than deleting them.
_Avoid_: Deleted meter, removed meter

**Benefit**:
A standalone Polar entitlement declared as a PAAC resource and attached to one or more Products. A Benefit has a type-specific configuration and can be reused across Products.
_Avoid_: Product feature, embedded benefit

**Meter Credit Benefit**:
A Benefit that grants units to a customer's Meter balance. Subscription Products grant the units each subscription cycle; one-time Products grant them once at purchase.
_Avoid_: Credit balance, metered price, usage allowance

**Product Benefit Attachment**:
The authoritative set of Benefits granted by a Product. A Product depends on every attached Benefit.
_Avoid_: Embedded benefit, benefit copy
