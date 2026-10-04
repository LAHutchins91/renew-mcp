export type RenewRecord = {
  id: string;
  kind: string;
  title: string;
  status: "LOCKED" | "DEVELOPING" | "UNKNOWN" | "RETIRED";
  content: string;
  tags: string[];
};

const tokenize = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9']+/g) ?? []);

/** What a renewal assistant must not invent. Absence from the locked record means not approved. */
export const FORBIDDEN_TO_INVENT = [
  "An entitlement the customer does not already have",
  "A renewal offer the owner did not approve",
  "A concession, discount, or extra entitlement that is not approved",
  "Any extra concession when a locked rule says no extra concession is approved",
  "Anything a locked forbidden concession says must not be added or discounted"
] as const;

export const NO_CONCESSION_TEXT = "No extra concession is approved.";

export function rankApprovedTerms(query: string, entries: RenewRecord[], limit = 20): RenewRecord[] {
  const words = tokenize(query);
  return entries
    .filter((entry) => entry.status !== "RETIRED")
    .map((entry, index) => {
      const hay = tokenize(`${entry.title} ${entry.kind} ${entry.tags.join(" ")} ${entry.content}`);
      let score = entry.status === "LOCKED" ? 4 : entry.status === "DEVELOPING" ? 2 : 0;
      for (const token of words) if (hay.has(token)) score += 3;
      if (query.toLowerCase().includes(entry.title.toLowerCase())) score += 10;
      if (entry.kind === "NO_CONCESSION" && entry.status === "LOCKED") score += 4;
      if (entry.kind === "FORBIDDEN_CONCESSION" && entry.status === "LOCKED") score += 3;
      if (entry.kind === "ENTITLEMENT" && entry.status === "LOCKED") score += 3;
      if (entry.kind === "RENEWAL_OFFER" && entry.status === "LOCKED") score += 2;
      return { entry, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry);
}

/** Mark a stored term so a caller can see whether it is approved to say. */
export function presentFact(entry: RenewRecord) {
  const approved = entry.status === "LOCKED";
  const base = {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    status: entry.status,
    content: entry.content,
    tags: entry.tags,
    approved_to_say: approved,
    not_approved: approved ? null : "This fact is not approved."
  };
  if (entry.kind === "ENTITLEMENT") {
    return {
      ...base,
      entitlement_approved: approved,
      entitlement_notice: approved ? null : "This entitlement is not approved.",
      extra_entitlement_notice: "An extra entitlement is not approved."
    };
  }
  if (entry.kind === "RENEWAL_OFFER") {
    return {
      ...base,
      offer_approved: approved,
      offer_notice: approved ? null : "This renewal offer is not approved.",
      discount_notice: approved
        ? "Only this locked offer is approved. Any other discount is not approved."
        : "A discount is not approved."
    };
  }
  if (entry.kind === "NO_CONCESSION") {
    return {
      ...base,
      extra_concession_approved: false,
      concession_notice: approved ? "No extra concession is approved." : "This concession rule is not approved."
    };
  }
  return {
    ...base,
    concession_forbidden: approved,
    concession_notice: approved
      ? "This concession is not approved. Do not add or discount it."
      : "This concession rule is not approved."
  };
}

/** Say what is not approved, instead of leaving a gap the assistant might fill. */
export function approvalBoundary(entries: RenewRecord[]) {
  const active = entries.filter((entry) => entry.status !== "RETIRED");
  const locked = active.filter((entry) => entry.status === "LOCKED");
  const entitlements = locked.filter((entry) => entry.kind === "ENTITLEMENT");
  const offers = locked.filter((entry) => entry.kind === "RENEWAL_OFFER");
  const forbidden = locked.filter((entry) => entry.kind === "FORBIDDEN_CONCESSION");
  const noExtra = locked.find((entry) => entry.kind === "NO_CONCESSION");
  const statements: string[] = [];

  if (entitlements.length === 0) statements.push("No current entitlement is approved. Do not invent one.");
  else statements.push("An entitlement that is not a locked current entitlement is not approved.");

  if (offers.length === 0) statements.push("A renewal offer is not approved. Do not invent one.");
  else statements.push("Only a locked renewal offer may be offered. Any other offer is not approved.");

  let rule: string;
  if (noExtra) {
    statements.push("No extra concession is approved.");
    statements.push("A discount is not approved unless a locked renewal offer already records it.");
    statements.push("An extra entitlement is not approved.");
    rule = "No extra concession is approved.";
  } else if (offers.length === 0) {
    statements.push("An extra concession, discount, or entitlement is not approved.");
    statements.push("A discount is not approved.");
    rule = "An extra concession, discount, or entitlement is not approved.";
  } else {
    statements.push("Only the locked renewal offers may be offered. Any other concession, discount, or extra entitlement is not approved.");
    statements.push("A discount that is not recorded in a locked renewal offer is not approved.");
    rule = "Only the locked renewal offers may be offered. Any other concession, discount, or extra entitlement is not approved.";
  }

  if (forbidden.length) statements.push(`Do not add or discount: ${forbidden.map((entry) => entry.title).join(", ")}.`);
  else statements.push("A concession the owner did not approve is not approved.");

  if (active.some((entry) => entry.status !== "LOCKED")) statements.push("Facts that are not LOCKED are not approved to say.");

  const mustNotAdd = [
    entitlements.length === 0
      ? "Any current entitlement, because none is approved"
      : "An entitlement that is not a locked current entitlement",
    offers.length === 0 ? "Any renewal offer, because none is approved" : "A renewal offer that is not locked",
    ...forbidden.map((entry) => entry.title),
    noExtra ? "Any extra concession" : "Any concession that is not a locked renewal offer"
  ];
  const discountLine = offers.length === 0
    ? "A discount is not approved."
    : "A discount that is not recorded in a locked renewal offer is not approved.";
  const mustNotDiscount = [
    ...(noExtra ? ["No extra concession is approved."] : []),
    discountLine,
    ...forbidden.map((entry) => entry.content)
  ];

  return {
    forbidden_to_invent: [...FORBIDDEN_TO_INVENT],
    not_approved: statements,
    approved_entitlement_titles: entitlements.map((entry) => entry.title),
    approved_offer_titles: offers.map((entry) => entry.title),
    forbidden_concession_titles: forbidden.map((entry) => entry.title),
    must_not_add: mustNotAdd,
    must_not_discount: mustNotDiscount,
    concession: { extra_approved: false as const, rule }
  };
}

/** A forbidden concession is either owner-supplied wording or the rule that nothing extra is approved. */
export function resolveConcession(decision: "FORBIDDEN" | "NONE", terms: string) {
  const trimmed = terms.trim();
  if (decision === "FORBIDDEN" && !trimmed) {
    return {
      ok: false as const,
      approved: false as const,
      saved: false as const,
      not_approved: "A concession is not approved. Record the owner's forbidden concession, or record that no extra concession is approved."
    };
  }
  if (decision === "NONE" && trimmed) {
    return {
      ok: false as const,
      approved: false as const,
      saved: false as const,
      not_approved: "No extra concession is approved. Omit concession terms when recording that rule."
    };
  }
  if (decision === "NONE") {
    return { ok: true as const, kind: "NO_CONCESSION" as const, content: NO_CONCESSION_TEXT };
  }
  return { ok: true as const, kind: "FORBIDDEN_CONCESSION" as const, content: trimmed };
}
