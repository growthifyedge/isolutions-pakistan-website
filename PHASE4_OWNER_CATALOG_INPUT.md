# Phase 4 Owner catalog input

Provide one explicit record per fact below. Unknown values may be omitted, but the product will remain draft until every publication requirement is resolved.

## Brand

- Name
- Slug
- Description/logo reference if approved
- Confirmation that the record is real and active

## Category

- Name
- Slug
- Parent category if any
- Description and sort order if approved
- Confirmation that the record is real and active

## Product identity

- Product title/model
- Slug
- Brand and category
- Short description
- Product content
- Default warranty, if shared by every variant
- SEO title and description, if approved

## Each explicit sellable variant

- SKU
- RAM display, if applicable
- Storage display, if applicable
- Color/finish, if applicable
- Current price in PKR
- Compare-at price only when genuine and greater than current price
- PTA status: approved, not approved, not applicable, or unresolved
- Condition: brand new, used, open box, refurbished, or unresolved
- Warranty override, if different from the product default
- JV/carrier status, if applicable
- Delivery scope: Karachi only or nationwide
- Initial numeric quantity on hand

List only combinations that actually exist. No Cartesian combinations will be generated.

## Specifications

For each approved fact: specification group, label, value, and display order.

## Media

Upload each original through Product → Media, then provide/confirm alt text, optional variant assignment, order, and primary selection. Do not send database binaries or base64.

## Publication

Confirm the product facts are Owner approved. Admin Studio validation will still block publication unless the record is classified real and has active real taxonomy, at least one resolved active variant, positive pricing, explicit PTA/condition/warranty/delivery, and a complete primary Cloudinary image.
