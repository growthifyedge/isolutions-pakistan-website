import type { DeltaKind, RowCategory } from "./stockListDelta.ts";

// Every word the Owner reads on the Android Stock Update page lives here, in plain language.
// Internal names (delta, ambiguous, blocked, fingerprint, plan …) stay in code and never reach the screen.

export const PAGE_TITLE = "Android Stock Update";
export const PAGE_HELP = "Paste the latest Android stock list. We’ll check what changed before updating the website.";

export const STEP = {
  paste: "Paste List",
  check: "Check List",
  review: "Review Changes",
  update: "Update Website",
  clear: "Clear List",
} as const;

/** Owner-facing group names for each internal result kind. */
export const KIND_LABEL: Record<DeltaKind, string> = {
  unchanged: "Same",
  price_change: "Price Changed",
  new_variant: "New Variants",
  new_product: "New Phones",
  ambiguous: "Needs Attention",
  blocked: "Not Android Phones",
};

export const HIDE_LABEL = "Will Be Hidden";
export const SHOW_AGAIN_LABEL = "Back On Website";

/** What a non-Android line is, in plain words. */
export const CATEGORY_LABEL: Record<RowCategory, string> = {
  smartphone: "Android phone",
  iphone: "iPhone",
  tablet: "Tablet",
  accessory: "Accessory / gift box",
  feature_phone: "Feature phone",
  other: "Other product",
  unknown: "Not recognised as a phone",
};

const EXPLANATIONS: Array<[RegExp, string]> = [
  [/^(?:Colour ".*" not recognised|Multi-word colour value ".*")/, "We couldn't understand this color"],
  [/^RAM uses extended\/virtual notation/, "Please confirm the RAM (the list shows extended RAM)"],
  [/^Matches \d+ existing products/, "This phone matches more than one phone on the website"],
  [/^Matches \d+ existing variants/, "More than one existing variant matches this line — add PTA or condition to tell them apart"],
  [/^New price is not below the existing compare-at price/, "The new price is not below the “was” price shown on the website — fix the “was” price first"],
  [/^The same existing variant is listed more than once/, "This variant appears more than once in the list"],
  [/^Same variant is listed more than once with conflicting/, "This variant appears more than once in the list with different details"],
  [/^Same RAM\/Storage\/Color exists with different PTA\/Condition/, "The same RAM / storage / color exists with different PTA or condition details"],
  [/^Price or model missing|^Price missing|^Model missing|^Missing ';'/, "Please check this line — the price or phone name is missing"],
  [/^Ambiguous brand/, "We couldn't tell which brand this is"],
  [/^Brand not recognised/, "We couldn't recognise the brand"],
  [/^Gift Box/, "This is a gift box, not a phone"],
  [/^Unrecognised value/, "We couldn't understand part of this line"],
  [/^New phone is missing RAM/, "This new phone needs RAM, storage and color in the list"],
  [/^Price looks too low|^Price looks too high|^Price looks unusual|^Price appears unusually/, "Please check the price — it looks unusual"],
  [/^Multiple\/ambiguous prices/, "This line has more than one price — please check which price belongs to which color"],
  [/^Duplicate variant/, "This variant appears more than once in the list"],
  [/^Conflicting /, "This line gives two different values for the same thing"],
  [/^Battery Health out of range/, "Please check the battery health value"],
  [/^Mobile phones are Karachi-only/, "Mobile phones are delivered in Karachi only"],
];

/** Turns an internal review reason into a sentence the Owner can act on. Unknown reasons become a generic request to check the line. */
export function explainReason(reason: string): string {
  for (const [pattern, text] of EXPLANATIONS) if (pattern.test(reason)) return text;
  return "Please check this line";
}

export const TOKEN_EXPLANATION = (token: string) => `${token.toUpperCase()} looks like part of the phone name`;

export const ACTION = {
  keepColor: "Use this color",
  changeColor: "Change color",
  ramOption: (gb: number) => `Use ${gb}GB RAM`,
  addToken: (token: string) => `Add ${token.toUpperCase()} to phone name`,
  undo: "Undo",
} as const;

export const WORDING = {
  checkingOnly: "Changes reach this website only after you click Update Website and confirm",
  listBack: "Your list is back",
  listBackDetail: (savedAt: string) => `Saved ${savedAt || "earlier"}. Your list, fixes and ticks are restored. Click Check List to compare it with the website again.`,
  autosave: "Saved in this browser as you work",
  autosaved: (time: string) => `Saved ${time} · kept only in this browser`,
  autosaveFailed: "Could not save in this browser — your list will not survive a refresh.",
  changedSinceCheck: "You changed something since the last check. Click Check List again before updating the website.",
  clearConfirm: "Clear the pasted list and all your fixes? The website is not touched.",
  clearYes: "Yes, clear list",
  clearNo: "Keep list",
  cleared: "List cleared. Nothing on the website was changed.",
  clearFailed: "Page reset, but the browser would not let the saved list be removed.",
  nothingHere: "Nothing in this group.",
  nothingHidden: "Every Android phone on the website is in this list — nothing will be hidden.",
  listIsTruth: "The latest list decides everything: every phone in it gets its new price, is shown on the website and gets stock 30; every Android phone not in it is hidden. Ticks only mark the rows you have looked at — they do not change what is updated.",
  attentionHelp: "Every line in the list must be fixed before the website can be updated — lines cannot be skipped. Use the buttons, or correct the line in your list above and click Check List again.",
  updateReady: "Ready. Clicking Update Website opens a confirmation first — nothing changes until you confirm.",
  wrongWebsite: "This page is connected to a different website than this build expects, so updating is switched off. Nothing was changed.",
  confirmTitle: (website: string) => `Update the ${website} website now?`,
  confirmBody: (count: number, website: string) =>
    `This makes ${count} change(s) on the ${website} website exactly as listed above. Just before saving, the website is read again; if anything changed since your check, nothing is saved and you are asked to check again. Nothing is ever deleted.`,
  confirmType: (phrase: string) => `Type ${phrase} to confirm`,
  confirmYes: "Yes, update the website",
  confirmCancel: "Cancel",
  updating: "Updating the website…",
  afterUpdate: "Click Check List again to confirm the website now matches the list.",
  updateDone: "Website updated and checked",
  updateStopped: "Nothing was changed",
  updateProblem: "Some changes need a look",
  progressChecking: "Checking the website again…",
  progressSaving: "Saving a before-copy of each phone…",
  progressVerifying: "Verifying changes…",
  progressFinished: "Finishing…",
  progressStep: {
    price: "Updating prices…",
    set_stock: "Setting stock to 30…",
    add_variant: "Creating new variants…",
    create_phone: "Creating new phones…",
    hide: "Hiding missing items…",
    show: "Showing returning items…",
  } as Record<string, string>,
  progressCount: (done: number, total: number, percent: number) => `${done} / ${total} completed — ${percent}%`,
  progressPhones: (checked: number, toCheck: number) => `${checked} / ${toCheck} phones`,
  progressFailed: (failed: number) => `${failed} change(s) failed so far — the rest continue`,
  progressKeepOpen: "Keep this page open until it finishes. Closing or refreshing it stops the remaining changes.",
  progressStopped: (done: number, total: number, step: string) => `Stopped after ${done} / ${total} changes, while: ${step}`,
  resultCompleted: (ok: number, total: number) => `${ok} of ${total} changes completed`,
  resultFailedStep: (title: string, step: string, message: string) => `Failed: ${title} — ${step} ${message}`,
  nothingDeleted: "Nothing is ever deleted. Hidden phones keep their images, specifications, links and SKUs and come back when they appear in a later list.",
  heldHide: "Fix the rows that need attention for this phone first",
  alreadyHidden: "Already hidden — stays hidden",
  notPublished: "Not on the website yet — it needs an image and publishing",
  wouldBe: (label: string) => `Once fixed, this would be: ${label}`,
} as const;
