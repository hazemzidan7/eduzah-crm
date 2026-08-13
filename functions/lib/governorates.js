/**
 * Must stay in sync with src/constants/crmOptions.js GOVERNORATE_OPTIONS.
 * "outside_egypt" is new — added for LEADS-01/02 because the Landing form
 * already offers "Outside Egypt" and the CRM had no matching code.
 */
export const GOVERNORATE_CODES = new Set([
  "cairo", "giza", "alexandria", "dakahlia", "red_sea", "beheira", "fayoum",
  "gharbia", "ismailia", "monufia", "minya", "qalyubia", "new_valley", "suez",
  "aswan", "asyut", "beni_suef", "port_said", "damietta", "sharqia",
  "south_sinai", "kafr_el_sheikh", "matrouh", "luxor", "qena", "north_sinai",
  "sohag", "outside_egypt",
]);
