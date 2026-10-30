import type { ChecklistItem } from "../db/schema.js";

// Category presets (GET /categories). Lenders start from these and edit per
// listing; each booking freezes a snapshot, so later edits can't move the
// goalposts mid-rental. Skills have no checklist or photo slots (no handover
// inspection, deposit 0).

export type CategoryPreset = {
  key: string;
  label: string;
  kind: "item" | "skill";
  checklistTemplate: ChecklistItem[];
  requiredPhotoSlots: string[];
};

const CONDITION = ["none", "minor", "visible"];

export const CATEGORIES: CategoryPreset[] = [
  {
    key: "power_tools",
    label: "Power tools",
    kind: "item",
    checklistTemplate: [
      { id: "powers_on", label: "Powers on and runs", type: "bool" },
      { id: "charger", label: "Charger included", type: "bool" },
      { id: "battery_pct", label: "Battery level", type: "percent" },
      { id: "bit_count", label: "Bits/blades in case", type: "count" },
      { id: "chuck_ok", label: "Chuck/blade guard works", type: "bool" },
      { id: "case", label: "Carry case included", type: "bool" },
      { id: "scratches", label: "Scratches", type: "choice", options: CONDITION },
    ],
    requiredPhotoSlots: ["front", "back", "accessories", "serial"],
  },
  {
    key: "camera",
    label: "Cameras & lenses",
    kind: "item",
    checklistTemplate: [
      { id: "lens_caps", label: "Lens caps (front + rear)", type: "bool" },
      { id: "shutter_count", label: "Shutter count", type: "count" },
      { id: "battery", label: "Battery included", type: "bool" },
      { id: "battery_pct", label: "Battery level", type: "percent" },
      { id: "strap", label: "Strap included", type: "bool" },
      { id: "sd_removed", label: "Owner's SD card removed", type: "bool" },
      { id: "sensor_dust", label: "Sensor dust", type: "choice", options: CONDITION },
      { id: "scratches", label: "Body/lens scratches", type: "choice", options: CONDITION },
    ],
    requiredPhotoSlots: ["front", "back", "lens", "sensor", "accessories"],
  },
  {
    key: "camping",
    label: "Camping gear",
    kind: "item",
    checklistTemplate: [
      { id: "poles", label: "Poles", type: "count" },
      { id: "pegs", label: "Pegs", type: "count" },
      { id: "rainfly", label: "Rainfly included", type: "bool" },
      { id: "zips_ok", label: "Zips work", type: "bool" },
      { id: "tears", label: "Tears or holes", type: "choice", options: CONDITION },
      { id: "clean_dry", label: "Packed clean and dry", type: "bool" },
    ],
    requiredPhotoSlots: ["packed", "pitched_or_laid_out", "accessories"],
  },
  {
    key: "baby",
    label: "Baby gear",
    kind: "item",
    checklistTemplate: [
      { id: "folds", label: "Folds and unfolds", type: "bool" },
      { id: "brakes", label: "Brakes work", type: "bool" },
      { id: "canopy", label: "Canopy intact", type: "bool" },
      { id: "harness", label: "Harness buckles work", type: "bool" },
      { id: "stains", label: "Stains", type: "choice", options: CONDITION },
      { id: "accident_history", label: "Accident history (car seats)", type: "text" },
    ],
    requiredPhotoSlots: ["front", "side", "wheels_or_base", "fabric"],
  },
  {
    key: "party",
    label: "Party supplies",
    kind: "item",
    checklistTemplate: [
      { id: "item_count", label: "Pieces in set", type: "count" },
      { id: "works", label: "Lights/sound work", type: "bool" },
      { id: "cables", label: "Cables and adapters included", type: "bool" },
      { id: "damage", label: "Breakage or damage", type: "choice", options: CONDITION },
    ],
    requiredPhotoSlots: ["full_set", "accessories"],
  },
  {
    key: "kitchen",
    label: "Kitchen appliances",
    kind: "item",
    checklistTemplate: [
      { id: "powers_on", label: "Powers on", type: "bool" },
      { id: "attachments", label: "Attachments", type: "count" },
      { id: "clean", label: "Returned clean", type: "bool" },
      { id: "cord_ok", label: "Power cord undamaged", type: "bool" },
      { id: "scratches", label: "Scratches or dents", type: "choice", options: CONDITION },
    ],
    requiredPhotoSlots: ["front", "attachments", "inside"],
  },
  {
    key: "sports",
    label: "Sports & fitness",
    kind: "item",
    checklistTemplate: [
      { id: "item_count", label: "Pieces", type: "count" },
      { id: "inflated", label: "Inflated / tensioned correctly", type: "bool" },
      { id: "wear", label: "Wear", type: "choice", options: CONDITION },
      { id: "notes", label: "Other notes", type: "text" },
    ],
    requiredPhotoSlots: ["front", "detail"],
  },
  { key: "baking", label: "Home baking", kind: "skill", checklistTemplate: [], requiredPhotoSlots: [] },
  { key: "tutoring", label: "Tutoring", kind: "skill", checklistTemplate: [], requiredPhotoSlots: [] },
  { key: "pet_sitting", label: "Pet sitting", kind: "skill", checklistTemplate: [], requiredPhotoSlots: [] },
  { key: "home_assembly", label: "Home assembly & repairs", kind: "skill", checklistTemplate: [], requiredPhotoSlots: [] },
];

export const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));
