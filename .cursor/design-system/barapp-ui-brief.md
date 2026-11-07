# Barapp UI Design Brief

## Product
- Name: Barapp
- Category: Internal F&B operations platform
- Purpose: Run outlet operations in one workspace: attendance, inventory, stock opname, WIP production, menu/sales cost control, expenses, closing approvals, guest arrival, waiting list, reservations, and administration.
- Primary users: Service staff, outlet administrators, HR, and Developer.
- Main user outcome: Complete daily operational work accurately with minimal friction and clear status visibility.

## Product context
Barapp is an operational tool, not a marketing website. Users work quickly on phones during shifts and on desktop for administration, reporting, and reconciliation. The interface must prioritize legibility, predictable controls, clear validation, and reliable data states over decorative effects.

## Chosen visual direction
**Enterprise Control Plane with a warm F&B identity.**

Use a structured operational shell, quiet surfaces, restrained botanical/sage and warm-neutral brand character, clear semantic status colors, and data-first layouts. Keep the existing Barapp leaf mark and Developer-controlled theme settings.

## Existing visual assets and theme contract
- Keep the current logo/leaf mark.
- Respect the existing runtime theme variables controlled by the app: `--bg`, `--cd`, `--tx`, `--mu`, `--br`, `--ac`, `--ac2`, `--dg`, `--gd`, `--tt`, `--tt2`, `--lt`, `--dk`, `--in`, `--tint`, and `--onac`.
- Respect `--fn` and `--fh` as the app's theme typography inputs. Do not hardcode a new global font or color palette.
- Never replace the Developer's saved theme, preset choices, mode, logo, or theme data.

## Design principles
1. Operational hierarchy: emphasize current outlet, active page, date/period, primary action, status, and next required step.
2. Dense but readable: tables remain efficient on desktop; mobile uses existing responsive/card patterns and local horizontal scroll where the data is genuinely tabular.
3. Use surfaces intentionally: fewer heavy outlines, no repeated thick borders, and no fake depth. Distinguish primary work areas from secondary details through spacing, surface tone, and typography.
4. Clear states: loading, empty, error, disabled, confirmed, pending, warning, and destructive states must remain distinguishable.
5. Mobile first for shift workflows: preserve touch targets, prevent viewport overflow, keep essential actions accessible, and do not force desktop tables into unreadable miniature layouts.
6. Accessible interaction: visible keyboard focus, readable contrast, reduced-motion support, semantic controls, and clear labels.
7. Motion must communicate a state change or interaction. No decorative animation added just for visual activity.

## Component language
- App shell: stable outlet header, clear desktop sidebar, compact mobile navigation.
- Panels: subtle 1px theme-aware border, restrained radius, no heavy offset shadows.
- Buttons: one clear primary treatment, calm secondary actions, semantic destructive actions, stable states.
- Forms: calm border, clear label and focus ring, consistent control height.
- Tables: readable headings, restrained row separators, preserve sticky first columns and local scroll wrappers.
- Guest Arrival: theme-aware queue/reservation cards, clear reservation vs waiting states, prominent seating/table details.
- Closing: clear module status, confirmation state, audit/history detail, and reconciliation warning.
- Admin & Divisi: clear account list/detail hierarchy and readable permission controls.

## Anti-slop constraints
- No default shadcn/Tailwind starter appearance.
- No purple/indigo AI gradients or gradient headline treatment.
- No generic hero + three equal cards + CTA patterns in operational pages.
- No emoji as interface icons. Continue using the existing SVG icon language.
- No unnecessary glassmorphism, blur blobs, glow, neon, or ornamental bento grids.
- Do not over-round every element or make every panel visually equal.
- Do not add hover/scroll animations everywhere.
- Do not force new hardcoded palette values that override Developer theme settings.

## Strict scope boundaries
Allowed: CSS presentation, visual hierarchy, spacing, typography that respects theme variables, borders, shadows, responsive presentation, focus states, and visual consistency.

Not allowed in a UI polish pass: changes to Supabase queries/RPCs, auth, role/scope logic, permissions, data models, RLS, migrations, business calculations, workflow order, IDs, storage, API contracts, feature availability, or deleting existing functionality.

## Completion criteria
- Every module retains its existing controls, states, actions, and data behavior.
- Desktop and mobile remain usable.
- The UI looks like a purpose-built F&B operations system rather than a generic AI dashboard.
- AI Slop Score target: 0–4/10.
- Distinctiveness Score target: 7–10/10.
