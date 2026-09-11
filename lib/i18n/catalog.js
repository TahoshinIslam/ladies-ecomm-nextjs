// The attribute-definition and department documents that drive the shop's
// filters, variant pickers, and spec rows are admin-authored in the DB (see
// attributeDefinitionModel.js and categoryModel.js) and stored in English
// only — neither model has a bn field. Left alone, `def.label`/
// `option.label`/`department.name` render that raw English text no matter
// what locale the shopper has picked (see the 2026-09 localization
// follow-up: Bangla shoppers were seeing "Color"/"Opacity"/"Burqa" etc. even
// with বাংলা selected).
//
// Rather than a schema change, every *known* seeded key/value/department
// slug is mapped here to a static translation in
// lib/i18n/dictionaries/*.js's `catalog` namespace, and the customer-facing
// UI looks values up through these helpers instead of trusting the DB
// document's own label at face value. An admin-added custom attribute,
// option, or department not in the map below safely falls back to the DB's
// own (English) text — never blank, never a raw dictionary key.
import { translate } from "./translate.js";

const ATTR_LABEL_KEYS = {
  color: "product.color",
  size: "product.size",
  fabric: "product.fabric",
  closure: "catalog.labelClosure",
  opacity: "catalog.labelOpacity",
  occasion: "filters.occasion",
  lining: "catalog.labelLining",
  coverageLevel: "catalog.labelCoverageLevel",
  careInstructions: "product.careInstructions",
};

const ATTR_VALUE_KEYS = {
  color: {
    black: "catalog.colorBlack",
    navy: "catalog.colorNavy",
    charcoal: "catalog.colorCharcoal",
    beige: "catalog.colorBeige",
    olive: "catalog.colorOlive",
    maroon: "catalog.colorMaroon",
    "dusty-rose": "catalog.colorDustyRose",
    white: "catalog.colorWhite",
    blue: "catalog.colorBlue",
    red: "catalog.colorRed",
  },
  size: {
    "free-size": "product.freeSize",
    s: "catalog.sizeS",
    m: "catalog.sizeM",
    l: "catalog.sizeL",
    xl: "catalog.sizeXl",
    xxl: "catalog.sizeXxl",
    "3xl": "catalog.size3xl",
    short: "catalog.sizeShort",
    regular: "catalog.sizeRegular",
    long: "catalog.sizeLong",
    maxi: "catalog.sizeMaxi",
  },
  fabric: {
    nida: "catalog.fabricNida",
    crepe: "catalog.fabricCrepe",
    chiffon: "catalog.fabricChiffon",
    jersey: "catalog.fabricJersey",
    georgette: "catalog.fabricGeorgette",
    khaddar: "catalog.fabricKhaddar",
    cotton: "catalog.fabricCotton",
    "silk-blend": "catalog.fabricSilkBlend",
  },
  closure: {
    "open-front-zip": "catalog.closureOpenFrontZip",
    "open-front-snap": "catalog.closureOpenFrontSnap",
    "pull-over": "catalog.closurePullOver",
    "wrap-tie": "catalog.closureWrapTie",
  },
  opacity: {
    sheer: "catalog.opacitySheer",
    "semi-opaque": "catalog.opacitySemiOpaque",
    opaque: "catalog.opacityOpaque",
  },
  occasion: {
    everyday: "catalog.occasionEveryday",
    prayer: "catalog.occasionPrayer",
    eid: "catalog.occasionEid",
    bridal: "catalog.occasionBridal",
    formal: "catalog.occasionFormal",
  },
  lining: {
    full: "catalog.liningFull",
    half: "catalog.liningHalf",
    none: "catalog.liningNone",
  },
  coverageLevel: {
    full: "catalog.coverageFull",
    extended: "catalog.coverageExtended",
    standard: "catalog.coverageStandard",
  },
};

const DEPARTMENT_NAME_KEYS = {
  burqa: "catalog.deptBurqaName",
  abaya: "catalog.deptAbayaName",
  hijab: "catalog.deptHijabName",
  niqab: "catalog.deptNiqabName",
  khimar: "catalog.deptKhimarName",
  "modest-sets": "catalog.deptModestSetsName",
};

/** Locale-aware label for an attribute definition's `key` (e.g. "fabric"). */
export function attrLabel(locale, key, dbLabel) {
  const path = ATTR_LABEL_KEYS[key];
  return path ? translate(locale, path) : (dbLabel ?? key);
}

/** Locale-aware label for one option `value` of attribute `key`. */
export function attrValue(locale, key, value, dbLabel) {
  const path = ATTR_VALUE_KEYS[key]?.[value];
  return path ? translate(locale, path) : (dbLabel ?? value);
}

/** Locale-aware display name for a department's `slug`. */
export function departmentName(locale, slug, dbName) {
  const path = DEPARTMENT_NAME_KEYS[slug];
  return path ? translate(locale, path) : (dbName ?? slug);
}
