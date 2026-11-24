import { useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { displayableSpecifications, fullSpecificationGroups, groupSpecifications, keySpecificationCards, keySpecifications, type SpecificationRow } from "./lib/specificationGroups";

type Card = { title: string; rows: { label: string; value: string; full?: string }[] };

/** White section cards with small label / value rows (the same look in the Top 7 and in the full list). */
function SpecCards({ cards }: { cards: Card[] }) {
  return (
    <>
      {cards.map((card) => (
        <section className="pdp-spec-group" key={card.title}>
          <h3>{card.title}</h3>
          <dl>
            {card.rows.map((row, index) => (
              <div key={`${card.title}-${row.label}-${index}`} title={row.full && row.full !== row.value ? row.full : undefined}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}

/**
 * PDP specifications, straight from the product's stored specifications (nothing hard-coded; stored values unchanged).
 * Empty / N/A values, exact repeats and commercial facts (PTA, price, warranty, stock, condition, delivery) are not shown.
 * `compact` (mobile phones): the Top 7 in total — Display Size, Display Type, Processor, Rear Camera, Front Camera,
 * Battery Capacity, Fast Charging (missing ones skipped) — in their section cards; "Show more specifications" shows up to
 * 25 useful ones (Display 4, Camera 3, Battery 3, …; minor details left out), "Show less" returns to the Top 7. Every
 * stored specification stays in the database.
 */
export function PdpSpecifications({ specifications, compact }: { specifications: SpecificationRow[]; compact: boolean }) {
  const groups = groupSpecifications(displayableSpecifications(specifications));
  const topSeven = compact ? keySpecifications(groups) : null;
  // Phones: "Show more" lists the useful specifications only (max 25, capped per section); other categories: all.
  const fullGroups = compact ? fullSpecificationGroups(groups, topSeven?.items ?? []) : groups;
  const moreCount = topSeven ? fullGroups.reduce((sum, group) => sum + group.rows.length, 0) - topSeven.items.length : 0;
  const key = topSeven && moreCount > 0 ? topSeven : null;
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  const root = useRef<HTMLDivElement>(null);
  const showAll = !key || expanded;
  const cards: Card[] = showAll
    ? fullGroups.map((group) => ({ title: group.title, rows: group.rows.map((row) => ({ label: row.label, value: row.value })) }))
    : keySpecificationCards(key.items).map((card) => ({ title: card.title, rows: card.items.map((item) => ({ label: item.label, value: item.value, full: item.row.value })) }));

  const collapse = () => {
    setExpanded(false);
    // Back to the Specifications heading when it has scrolled away (reading position kept otherwise).
    const target = root.current?.closest<HTMLElement>(".pdp-specifications") ?? root.current;
    if (target && target.getBoundingClientRect().top < 0) target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={root} className={key ? "pdp-spec-view pdp-spec-view--compactable" : "pdp-spec-view"}>
      <div id={regionId} className={showAll ? "pdp-spec-groups" : "pdp-spec-groups pdp-spec-groups--top"} style={{ "--spec-cols-3": Math.min(cards.length, 3), "--spec-cols-2": Math.min(cards.length, 2) } as React.CSSProperties}>
        <SpecCards cards={cards} />
      </div>
      {key && (
        <div className="pdp-spec-toggle">
          <button type="button" aria-expanded={expanded} aria-controls={regionId} onClick={() => (expanded ? collapse() : setExpanded(true))}>
            {expanded ? (
              <>Show less <ChevronUp aria-hidden="true" /></>
            ) : (
              <>Show more specifications <span className="pdp-spec-count">+{moreCount}</span> <ChevronDown aria-hidden="true" /></>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
